// The picture of every line a folder holds, and the places it is also kept:
// the folder in memory, a second one it reaches by an address, and the app's
// own port in front of both.

import 'fake-indexeddb/auto';
import {
	credentialFor,
	type Credential,
	type HeldCredential,
	type History,
	LocalApi,
	MemoryFiles,
	MemoryHistory,
	MemoryRemotes
} from '@sloppy/local';
import type { BlockDocument } from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, resetApi } from '../api.js';
import { initRuntime } from '../runtime.js';
import { graphHistory } from './history.svelte.js';
import { nodes } from './nodes.svelte.js';
import { outlineSections } from './outline-sections.svelte.js';

const HERE = '/Users/me/garden';
const THERE = '/Users/them/garden';
const AT = 'https://github.test/me/garden.git';

let store: Map<string, Uint8Array>;
let theirStore: Map<string, Uint8Array>;
let places: MemoryRemotes;
let held: HeldCredential[];
let kept: MemoryHistory;
let theirs: MemoryHistory;

function folder(): MemoryFiles {
	return new MemoryFiles({ root: HERE, store, data: '/data' });
}

function theirFolder(): MemoryFiles {
	return new MemoryFiles({ root: THERE, store: theirStore, data: '/their-data' });
}

function words(said: string): BlockDocument {
	return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: said }] }] };
}

/** The shell a surface sees, with whatever this device was given to reach the
 *  hosts a person keeps their folders on. */
function shellKeeping(over: History | undefined): void {
	initRuntime({
		apiHost: () => '',
		mode: () => 'local',
		createApi: () => new LocalApi(folder()),
		vault: {
			folder: () => HERE,
			graph: () => new LocalApi(folder()).graphHere(),
			asks: true,
			open: async () => HERE
		},
		history: () => over,
		credentials: {
			list: async () => held,
			forUrl: async (url) => credentialFor(held, url),
			hold: async () => {},
			forget: async () => {}
		}
	});
	resetApi();
}

/** The folder somewhere else, laid out as what was put there has it. A place
 *  commits are kept is nobody's working folder until somebody works in it. */
async function workingOverThere(): Promise<void> {
	await theirs.switch('main');
}

/** What somebody else put where this folder is also kept. */
async function writtenOverThere(said: string): Promise<void> {
	await workingOverThere();
	await theirFolder().write('theirs.md', new TextEncoder().encode(`${said}\n`));
	await theirs.commit(said);
}

beforeEach(async () => {
	store = new Map();
	theirStore = new Map();
	held = [];
	places = new MemoryRemotes();
	kept = new MemoryHistory(folder(), { author: 'Ada', remotes: places });
	theirs = new MemoryHistory(theirFolder(), { author: 'Bo', branch: 'holding', remotes: places });
	places.keep(AT, theirs);
	graphHistory.clear();
	nodes.clear();
	outlineSections.clear();
	shellKeeping(kept);
	await api.createNode({ title: 'Origins' });
});

afterEach(() => {
	graphHistory.clear();
	nodes.clear();
	outlineSections.clear();
	initRuntime({ apiHost: () => '', mode: () => 'hosted', history: () => undefined });
	resetApi();
});

describe('the picture of every line', () => {
	it('draws every line, with the branches at each version', async () => {
		await graphHistory.keep('A first version');
		await graphHistory.startLine('an-argument');
		await graphHistory.workOn('an-argument');
		await api.createNode({ title: 'Written over there' });
		await graphHistory.keep('Over there');
		await graphHistory.workOn('main');
		await api.createNode({ title: 'Written over here' });
		await graphHistory.keep('Over here');

		await graphHistory.read();

		expect(graphHistory.draws).toBe(true);
		expect(graphHistory.picture.map((one) => [one.message, one.refs])).toEqual([
			['Over here', ['main']],
			['Over there', ['an-argument']],
			['A first version', []]
		]);
		expect(graphHistory.versions.map((one) => one.message)).toEqual([
			'Over here',
			'A first version'
		]);
	});

	it('offers none of it where the history cannot draw one', async () => {
		shellKeeping({
			status: () => kept.status(),
			log: (limit, cursor) => kept.log(limit, cursor),
			commit: (message) => kept.commit(message),
			branches: () => kept.branches(),
			branch: (name) => kept.branch(name),
			switch: (name) => kept.switch(name),
			merge: (name) => kept.merge(name),
			resolve: (path, side) => kept.resolve(path, side),
			readAt: (commit) => kept.readAt(commit),
			currentCommit: () => kept.currentCommit()
		});
		await graphHistory.keep('A first version');

		await graphHistory.read();

		expect(graphHistory.draws).toBe(false);
		expect(graphHistory.picture).toEqual([]);
		expect(graphHistory.places).toEqual([]);
		expect(graphHistory.versions.map((one) => one.message)).toEqual(['A first version']);
	});

	it('reads the versions older than the first page of it', async () => {
		const files = folder();
		for (let at = 0; at < 31; at += 1) {
			await files.write(`note-${at}.md`, new TextEncoder().encode(`${at}\n`));
			await kept.commit(`Version ${at}`);
		}

		await graphHistory.read();

		expect(graphHistory.picture).toHaveLength(30);
		expect(graphHistory.morePicture).toBe(true);

		await graphHistory.readOlderPicture();

		expect(graphHistory.picture).toHaveLength(31);
		expect(graphHistory.picture.at(-1)?.message).toBe('Version 0');
		expect(graphHistory.morePicture).toBe(false);
	});

	it('starts a line at a version further back, and lets one go', async () => {
		await graphHistory.keep('A first version');
		const first = graphHistory.at as string;
		await api.createNode({ title: 'A second thought' });
		await graphHistory.keep('And the second');

		expect(await graphHistory.startLineAt('back-then', first)).toBe(true);
		expect(graphHistory.lines.find((one) => one.name === 'back-then')?.head).toBe(first);
		expect(graphHistory.line).toBe('main');

		expect(await graphHistory.dropLine('back-then')).toBe(true);
		expect(graphHistory.lines.map((one) => one.name)).toEqual(['main']);

		expect(await graphHistory.dropLine('main')).toBe(false);
		expect(graphHistory.says).toBe('That is the one you are working on.');
		expect(graphHistory.lines.map((one) => one.name)).toEqual(['main']);
	});
});

describe('the places a folder is also kept', () => {
	it('names each one by the host it is at, and by its own name where there is none', async () => {
		const backup = new MemoryHistory(
			new MemoryFiles({ root: '/Users/me/backup', store: new Map(), data: '/backup-data' }),
			{ remotes: places }
		);
		places.keep('/Users/me/backup', backup);
		await kept.addRemote('origin', AT);
		await kept.addRemote('backup', '/Users/me/backup');

		await graphHistory.read();

		expect(graphHistory.places).toEqual([
			{ name: 'origin', at: 'github.test' },
			{ name: 'backup', at: 'backup' }
		]);
	});

	it('counts what is waiting at whichever place it is asked about', async () => {
		held = [{ host: 'github.test', credential: { kind: 'token', token: 'a-token' } }];
		const store = new Map<string, Uint8Array>();
		const elsewhere = new MemoryFiles({
			root: '/Users/me/backup',
			store,
			data: '/backup-data'
		});
		const backup = new MemoryHistory(elsewhere, { author: 'Cy', remotes: places });
		places.keep('/Users/me/backup', backup);
		await kept.addRemote('backup', '/Users/me/backup');
		await kept.addRemote('origin', AT);
		await graphHistory.keep('A first version');
		await graphHistory.putElsewhere('origin');
		await graphHistory.putElsewhere('backup');
		await writtenOverThere('Written over there');

		expect(graphHistory.followsPlace).toBe('origin');
		expect(await graphHistory.lookElsewhere('origin')).toBe(true);
		expect(graphHistory.elsewhereSaid).toEqual({
			words: 'One newer version to take in.',
			refused: false
		});
		expect(graphHistory.standingAt('origin')).toEqual({ ahead: 0, behind: 1 });

		expect(await graphHistory.lookElsewhere('backup')).toBe(true);
		expect(graphHistory.elsewhereSaid).toEqual({ words: 'Nothing to take.', refused: false });
		expect(graphHistory.standingAt('backup')).toEqual({ ahead: 0, behind: 0 });

		await elsewhere.write('theirs.md', new TextEncoder().encode('Kept on the other disk\n'));
		await backup.commit('Kept on the other disk');

		expect(await graphHistory.lookElsewhere('backup')).toBe(true);
		expect(graphHistory.elsewhereSaid).toEqual({
			words: 'One newer version to take in.',
			refused: false
		});
		expect(graphHistory.standingAt('backup')).toEqual({ ahead: 0, behind: 1 });
		expect(graphHistory.standingAt('origin')).toEqual({ ahead: 0, behind: 1 });
	});

	it('says nothing of the distance to a place it has not heard from', async () => {
		const backup = new MemoryHistory(
			new MemoryFiles({ root: '/Users/me/backup', store: new Map(), data: '/backup-data' }),
			{ remotes: places }
		);
		places.keep('/Users/me/backup', backup);
		await kept.addRemote('backup', '/Users/me/backup');
		await graphHistory.keep('A first version');

		await graphHistory.read();

		expect(graphHistory.standingAt('backup')).toBeUndefined();
	});

	it('puts a folder where it is also kept, and has nothing to take back', async () => {
		held = [{ host: 'github.test', credential: { kind: 'token', token: 'a-token' } }];
		await kept.addRemote('origin', AT);
		await graphHistory.keep('A first version');

		expect(await graphHistory.putElsewhere('origin')).toBe(true);
		expect(graphHistory.elsewhereSaid).toEqual({
			words: 'Your notes are on github.test.',
			refused: false
		});
		await workingOverThere();
		expect((await theirs.log(10)).commits.map((one) => one.message)).toEqual(['A first version']);

		expect(await graphHistory.lookElsewhere('origin')).toBe(true);
		expect(graphHistory.elsewhereSaid).toEqual({ words: 'Nothing to take.', refused: false });
		expect(await graphHistory.takeIn('origin')).toBe(true);
		expect(graphHistory.elsewhereSaid).toEqual({ words: 'Nothing to take.', refused: false });
	});

	it('says how much is waiting, and takes it in', async () => {
		held = [{ host: 'github.test', credential: { kind: 'token', token: 'a-token' } }];
		await kept.addRemote('origin', AT);
		await graphHistory.keep('A first version');
		await graphHistory.putElsewhere('origin');
		await writtenOverThere('Written over there');

		expect(await graphHistory.lookElsewhere('origin')).toBe(true);
		expect(graphHistory.elsewhereSaid).toEqual({
			words: 'One newer version to take in.',
			refused: false
		});
		expect(graphHistory.behind).toBe(1);
		expect(graphHistory.follows).toBe('origin/main');

		expect(await graphHistory.takeIn('origin')).toBe(true);
		expect(graphHistory.elsewhereSaid).toEqual({
			words: 'What is on github.test is here too.',
			refused: false
		});
		expect(graphHistory.behind).toBe(0);
		expect(graphHistory.picture.map((one) => one.message)).toContain('Written over there');
	});

	it('will not write over what is already there, and says what to do first', async () => {
		held = [{ host: 'github.test', credential: { kind: 'token', token: 'a-token' } }];
		await kept.addRemote('origin', AT);
		await graphHistory.keep('A first version');
		await graphHistory.putElsewhere('origin');
		await writtenOverThere('Written over there');

		expect(await graphHistory.putElsewhere('origin')).toBe(false);
		expect(graphHistory.elsewhereSaid).toEqual({
			words: 'Pull first, then push again.',
			refused: true
		});
		expect(graphHistory.says).toBe(null);
	});

	it('hands a host what this device holds for it, and asks for one where it holds nothing', async () => {
		const handed: (Credential | undefined)[] = [];
		const push = kept.push.bind(kept);
		kept.push = async (remote, credential) => {
			handed.push(credential);
			return push(remote, credential);
		};
		await kept.addRemote('origin', AT);
		await graphHistory.keep('A first version');

		expect(await graphHistory.putElsewhere('origin')).toBe(false);
		expect(graphHistory.elsewhereSaid).toEqual({
			words: 'Add a way in for github.test in Settings, then try again.',
			refused: true
		});
		expect(handed).toEqual([]);

		held = [{ host: 'github.test', credential: { kind: 'token', token: 'a-token' } }];
		expect(await graphHistory.putElsewhere('origin')).toBe(true);
		expect(handed).toEqual([{ kind: 'token', token: 'a-token' }]);
	});

	it('asks for nothing to reach a folder on this same device', async () => {
		const backup = new MemoryHistory(
			new MemoryFiles({ root: '/Users/me/backup', store: new Map(), data: '/backup-data' }),
			{ remotes: places }
		);
		places.keep('/Users/me/backup', backup);
		await kept.addRemote('backup', '/Users/me/backup');
		await graphHistory.keep('A first version');

		expect(await graphHistory.putElsewhere('backup')).toBe(true);
		expect(graphHistory.elsewhereSaid).toEqual({
			words: 'Your notes are on backup.',
			refused: false
		});
	});

	it('hands what a pull left in two versions to the surface a local merge uses', async () => {
		held = [{ host: 'github.test', credential: { kind: 'token', token: 'a-token' } }];
		await kept.addRemote('origin', AT);
		const note = await api.createNode({ title: 'Origins' });
		const section = await api.createBlock({ node: note.ref, content: words('The seed') });
		await graphHistory.keep('A first version');
		await graphHistory.putElsewhere('origin');
		await workingOverThere();
		const away = new LocalApi(theirFolder());
		const same = (await away.listBlocks(note.ref))[0];
		await away.updateBlock(same.ref, { content: words('The seed of theirs') });
		await theirs.commit('Written over there');
		await api.updateBlock(section.ref, { content: words('The seed of mine') });
		await graphHistory.keep('Written over here');

		expect(await graphHistory.takeIn('origin')).toBe(false);
		expect(graphHistory.inTwoVersions).toHaveLength(1);
		expect(graphHistory.taking).toBe('origin/main');
		expect(graphHistory.elsewhereSaid).toBe(null);
	});

	it('says where to say a place is, where the folder is kept nowhere else', async () => {
		await graphHistory.keep('A first version');

		expect(await graphHistory.putElsewhere()).toBe(false);
		expect(graphHistory.elsewhereSaid).toEqual({
			words: 'Say where else your notes are kept, in Settings, then try again.',
			refused: true
		});
		expect(await graphHistory.lookElsewhere()).toBe(false);
	});

	it('lets go of what an act said once the surface comes up again', async () => {
		held = [{ host: 'github.test', credential: { kind: 'token', token: 'a-token' } }];
		await kept.addRemote('origin', AT);
		await graphHistory.keep('A first version');
		await graphHistory.putElsewhere('origin');
		expect(graphHistory.elsewhereSaid?.words).toBe('Your notes are on github.test.');

		await graphHistory.opened();

		expect(graphHistory.elsewhereSaid).toBe(null);
	});
});
