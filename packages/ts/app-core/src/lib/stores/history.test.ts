// The states a graph on this device has been in, driven the way a surface
// drives them: a folder in memory, the history over it, and the app's own port
// in front of both.

import 'fake-indexeddb/auto';
import { LocalApi, MemoryFiles, MemoryHistory } from '@sloppy/local';
import type { BlockDocument, OwnedRef } from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, resetApi } from '../api.js';
import { initRuntime } from '../runtime.js';
import { graphHistory } from './history.svelte.js';
import { nodes } from './nodes.svelte.js';
import { outlineSections } from './outline-sections.svelte.js';

const ROOT = '/Users/me/garden';

let store: Map<string, Uint8Array>;
let kept: MemoryHistory;

function folder(): MemoryFiles {
	return new MemoryFiles({ root: ROOT, store, data: '/data' });
}

function words(said: string): BlockDocument {
	return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: said }] }] };
}

function text(content: BlockDocument): string {
	return JSON.stringify(content).replace(/.*"text":"([^"]*)".*/, '$1');
}

/** The shell a surface sees: the folder is the graph, its history is over the
 *  same folder, and the graph is served out of the folder as it stands. */
function shellKeeping(over: MemoryHistory | undefined): void {
	initRuntime({
		apiHost: () => '',
		mode: () => 'local',
		createApi: () => new LocalApi(folder()),
		vault: {
			folder: () => ROOT,
			graph: () => new LocalApi(folder()).graphHere(),
			asks: true,
			open: async () => ROOT
		},
		history: () => over
	});
	resetApi();
}

beforeEach(async () => {
	store = new Map();
	kept = new MemoryHistory(folder(), { author: 'Ada' });
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

describe('a graph a platform keeps no history of', () => {
	it('offers nothing about one', async () => {
		shellKeeping(undefined);

		expect(graphHistory.keeps).toBe(false);
		await graphHistory.read();
		expect(graphHistory.versions).toEqual([]);
		expect(graphHistory.changed).toBe(null);
	});
});

describe('what has changed since the last version kept', () => {
	it('names the notes written since it, and nothing once one is kept', async () => {
		await graphHistory.keep('A first version');
		const second = await api.createNode({ title: 'A second thought' });

		await graphHistory.read();

		expect(graphHistory.unkept).toBe(true);
		expect(graphHistory.changed?.notes.map((one) => [one.became, one.title])).toEqual([
			['added', 'A second thought']
		]);

		expect(await graphHistory.keep('And the second')).toBe(true);
		expect(graphHistory.unkept).toBe(false);
		expect(graphHistory.versions.map((one) => one.message)).toEqual([
			'And the second',
			'A first version'
		]);
		expect(graphHistory.versions[0].author).toBe('Ada');
		expect(await api.getNode(second.ref)).not.toBe(null);
	});

	it('has a version to keep where what changed is in no note', async () => {
		const note = await api.createNode({ title: 'Origins' });
		await graphHistory.keep('A first version');
		await api.updateNode(note.ref, { tags: ['biology'] });

		await graphHistory.read();

		expect(graphHistory.unkept).toBe(true);
		expect(graphHistory.changed?.notes).toEqual([]);
		expect(await graphHistory.keep('Tagged it')).toBe(true);
	});

	it('says nothing was kept where nothing had changed', async () => {
		await graphHistory.keep('A first version');

		expect(await graphHistory.keep('Again')).toBe(false);
		expect(graphHistory.versions).toHaveLength(1);
	});
});

describe('the lines of work a graph stands on', () => {
	it('starts one, works on it, and brings it back in', async () => {
		await graphHistory.keep('A first version');

		expect(await graphHistory.startLine('an-argument')).toBe(true);
		expect(graphHistory.lines.map((one) => one.name).sort()).toEqual(['an-argument', 'main']);
		expect(graphHistory.line).toBe('main');

		expect(await graphHistory.workOn('an-argument')).toBe(true);
		expect(graphHistory.line).toBe('an-argument');

		const there = await api.createNode({ title: 'Written over there' });
		await graphHistory.keep('Over there');
		expect(await graphHistory.workOn('main')).toBe(true);
		expect(await api.getNode(there.ref)).toBe(null);

		expect(await graphHistory.bringIn('an-argument')).toBe(true);
		expect(graphHistory.inTwoVersions).toEqual([]);
		expect(await api.getNode(there.ref)).not.toBe(null);
	});

	it('refuses to move the folder with writing in it, in words', async () => {
		const note = await api.createNode({ title: 'Origins' });
		await graphHistory.keep('A first version');
		await graphHistory.startLine('an-argument');
		await api.updateNode(note.ref, { title: 'Still being written' });

		expect(await graphHistory.workOn('an-argument')).toBe(false);

		expect(graphHistory.says).toMatch(/Commit what you have written here first/);
		expect(graphHistory.line).toBe('main');
	});
});

/** Two lines of work that each wrote into the one note. */
async function bothWrote(): Promise<{ note: OwnedRef; section: OwnedRef }> {
	const note = await api.createNode({ title: 'Origins' });
	const section = await api.createBlock({ node: note.ref, content: words('The seed') });
	await graphHistory.keep('A first version');
	await graphHistory.startLine('an-argument');
	await graphHistory.workOn('an-argument');
	await api.updateBlock(section.ref, { content: words('The seed of the argument') });
	await graphHistory.keep('Over there');
	await graphHistory.workOn('main');
	await api.updateBlock(section.ref, { content: words('The seed of it all') });
	await graphHistory.keep('Over here');
	return { note: note.ref, section: section.ref };
}

describe('a note both lines changed', () => {
	it('is left for somebody to settle rather than written into with markers', async () => {
		const { note } = await bothWrote();

		expect(await graphHistory.bringIn('an-argument')).toBe(false);

		expect(graphHistory.taking).toBe('an-argument');
		expect(graphHistory.inTwoVersions).toHaveLength(1);
		const said = await graphHistory.inTwo(graphHistory.inTwoVersions[0]);
		expect(said?.ref).toBe(note);
		expect(said?.sections.map((one) => [one.mine?.content, one.theirs?.content])).toEqual([
			[words('The seed of it all'), words('The seed of the argument')]
		]);
	});

	it('is settled whole from one side, and the merge is then kept', async () => {
		const { note, section } = await bothWrote();
		await graphHistory.bringIn('an-argument');

		expect(await graphHistory.settle(graphHistory.inTwoVersions[0], 'theirs')).toBe(true);

		expect(graphHistory.inTwoVersions).toEqual([]);
		expect(await graphHistory.keep('Both lines')).toBe(true);
		expect(graphHistory.versions[0].parents).toHaveLength(2);
		const blocks = await api.listBlocks(note);
		expect(blocks.find((one) => one.ref === section)?.content).toEqual(
			words('The seed of the argument')
		);
	});

	it('is settled section by section, taking the other line into the note', async () => {
		const { note, section } = await bothWrote();
		await graphHistory.bringIn('an-argument');
		const said = await graphHistory.inTwo(graphHistory.inTwoVersions[0]);
		if (!said) throw new Error('The note in two versions did not read');

		expect(await graphHistory.settleSections(said, new Set([said.sections[0].ulid]))).toBe(true);

		expect(graphHistory.inTwoVersions).toEqual([]);
		const blocks = await api.listBlocks(note);
		expect(blocks.find((one) => one.ref === section)?.content).toEqual(
			words('The seed of the argument')
		);
		expect(await graphHistory.keep('Both lines')).toBe(true);
	});
});

describe('sections one line wrote and the other did not', () => {
	/** The other line writes two sections after the one both lines have; this
	 *  one writes into that section instead. */
	async function theirsAdded(): Promise<OwnedRef> {
		const note = await api.createNode({ title: 'Origins' });
		const first = await api.createBlock({ node: note.ref, content: words('The seed') });
		await graphHistory.keep('A first version');
		await graphHistory.startLine('an-argument');
		await graphHistory.workOn('an-argument');
		const bee = await api.createBlock({
			node: note.ref,
			content: words('Bee'),
			after: first.ref
		});
		await api.createBlock({ node: note.ref, content: words('Cee'), after: bee.ref });
		await graphHistory.keep('Over there');
		await graphHistory.workOn('main');
		await api.updateBlock(first.ref, { content: words('The seed of it all') });
		await graphHistory.keep('Over here');
		return note.ref;
	}

	it('takes a run of them in the order the other line has them', async () => {
		const note = await theirsAdded();
		await graphHistory.bringIn('an-argument');
		const said = await graphHistory.inTwo(graphHistory.inTwoVersions[0]);
		if (!said) throw new Error('The note in two versions did not read');
		const theirs = said.sections.filter((one) => one.mine === undefined).map((one) => one.ulid);

		expect(await graphHistory.settleSections(said, new Set(theirs))).toBe(true);

		expect((await api.listBlocks(note)).map((one) => text(one.content))).toEqual([
			'The seed of it all',
			'Bee',
			'Cee'
		]);
		expect(graphHistory.inTwoVersions).toEqual([]);
	});

	it('takes one the other line no longer has, and settles the note whole', async () => {
		const note = await api.createNode({ title: 'Origins' });
		const first = await api.createBlock({ node: note.ref, content: words('The seed') });
		await graphHistory.keep('A first version');
		await graphHistory.startLine('an-argument');
		await graphHistory.workOn('an-argument');
		await api.deleteBlock(first.ref);
		await api.createBlock({ node: note.ref, content: words('Bee') });
		await graphHistory.keep('Over there');
		await graphHistory.workOn('main');
		await api.updateBlock(first.ref, { content: words('The seed of it all') });
		await graphHistory.keep('Over here');
		await graphHistory.bringIn('an-argument');
		const said = await graphHistory.inTwo(graphHistory.inTwoVersions[0]);
		if (!said) throw new Error('The note in two versions did not read');

		expect(
			await graphHistory.settleSections(said, new Set(said.sections.map((one) => one.ulid)))
		).toBe(true);

		expect(graphHistory.says).toBe(null);
		expect((await api.listBlocks(note.ref)).map((one) => text(one.content))).toEqual(['Bee']);
		expect(graphHistory.inTwoVersions).toEqual([]);
	});
});

describe('a version somebody works on', () => {
	/** A version with one note in it, and a second note kept after it. */
	async function twoVersions(): Promise<{ first: string; second: OwnedRef }> {
		await graphHistory.keep('A first version');
		const first = graphHistory.at as string;
		const second = await api.createNode({ title: 'A second thought' });
		await graphHistory.keep('And the second');
		return { first, second: second.ref };
	}

	it('becomes the graph in front of them, with every act still theirs', async () => {
		const { first, second } = await twoVersions();

		expect(await graphHistory.standOn(first)).toBe(true);

		expect(graphHistory.onAVersion).toBe(true);
		expect(graphHistory.line).toBeUndefined();
		expect(graphHistory.at).toBe(first);
		expect(await api.getNode(second)).toBe(null);

		const written = await api.createNode({ title: 'Written from here' });
		expect(await graphHistory.keep('Written from here')).toBe(true);

		expect(await api.getNode(written.ref)).not.toBe(null);
		// A version nothing leads back to is one nobody reaches again, so keeping
		// opens the line where they stand first.
		expect(graphHistory.line).toBe(`from-${first.slice(0, 8)}`);
		expect(graphHistory.versions[0].parents).toEqual([first]);
	});

	it('opens a line where it stands, named after that version', async () => {
		const { first } = await twoVersions();
		await graphHistory.standOn(first);

		const name = await graphHistory.lineHere();

		expect(name).toBe(`from-${first.slice(0, 8)}`);
		expect(graphHistory.line).toBe(name);
		expect(graphHistory.onAVersion).toBe(false);
		expect(graphHistory.at).toBe(first);
	});

	it('steps past a name already taken', async () => {
		const { first } = await twoVersions();
		await graphHistory.standOn(first);
		const taken = await graphHistory.lineHere();
		await graphHistory.standOn(first);

		expect(await graphHistory.lineHere()).toBe(`${taken}-2`);
	});

	it('leaves the folder where it was where it will not stand, and says why', async () => {
		const note = await api.createNode({ title: 'Origins' });
		const { first } = await twoVersions();
		await api.updateNode(note.ref, { title: 'Still being written' });

		expect(await graphHistory.standOn(first)).toBe(false);

		expect(graphHistory.says).toMatch(/Commit what you have written here first/);
		expect(graphHistory.line).toBe('main');
		expect(graphHistory.onAVersion).toBe(false);
		expect((await api.getNode(note.ref))?.title).toBe('Still being written');
	});

	it('carries what is written here where that version has none of it', async () => {
		const note = await api.createNode({ title: 'Origins' });
		const { first } = await twoVersions();
		await api.updateNode(note.ref, { title: 'Still being written' });

		expect(await graphHistory.standOn(first, true)).toBe(true);

		expect(graphHistory.onAVersion).toBe(true);
		expect((await api.getNode(note.ref))?.title).toBe('Still being written');
		expect(graphHistory.unkept).toBe(true);
	});

	it('calls a line something else, and stays on it', async () => {
		await graphHistory.keep('A first version');

		expect(await graphHistory.renameLine('main', 'the-thesis')).toBe(true);

		expect(graphHistory.line).toBe('the-thesis');
		expect(graphHistory.lines.map((one) => one.name)).toEqual(['the-thesis']);
	});
});

describe('a merge the folder is part-way through', () => {
	it('is still there after the surface has been put away and read again', async () => {
		const { note } = await bothWrote();
		await graphHistory.bringIn('an-argument');
		expect(graphHistory.inTwoVersions).toHaveLength(1);

		graphHistory.clear();
		await graphHistory.read();

		expect(graphHistory.taking).toBe('an-argument');
		expect(graphHistory.inTwoVersions).toHaveLength(1);
		expect(await graphHistory.inTwo(graphHistory.inTwoVersions[0])).toMatchObject({ ref: note });
	});

	it('says nothing is in two versions once each has been settled', async () => {
		await bothWrote();
		await graphHistory.bringIn('an-argument');

		await graphHistory.settle(graphHistory.inTwoVersions[0], 'theirs');

		expect(graphHistory.merging?.inTwoVersions).toEqual([]);
		expect(graphHistory.taking).toBe('an-argument');

		await graphHistory.keep('Both lines');

		expect(graphHistory.merging).toBe(null);
		expect(graphHistory.taking).toBe(null);
	});

	it('is stopped, and the graph is the one it was before the merge began', async () => {
		const { note, section } = await bothWrote();
		await graphHistory.bringIn('an-argument');

		expect(await graphHistory.abandonMerge()).toBe(true);

		expect(graphHistory.merging).toBe(null);
		expect(graphHistory.inTwoVersions).toEqual([]);
		expect(graphHistory.unkept).toBe(false);
		const blocks = await api.listBlocks(note);
		expect(blocks.find((one) => one.ref === section)?.content).toEqual(words('The seed of it all'));
	});
});

describe('a version of the graph', () => {
	it('reads as the notes it had, however the graph has moved on', async () => {
		await graphHistory.keep('A first version');
		const second = await api.createNode({ title: 'A second thought' });
		await graphHistory.read();
		const at = graphHistory.at;
		if (at === undefined) throw new Error('Nothing was kept');

		const then = await graphHistory.notesAt(at);

		expect(then.map((one) => one.title)).toEqual(['Origins']);
		expect(await api.getNode(second.ref)).not.toBe(null);
	});

	it('says what is different between it and the graph now', async () => {
		const note = await api.createNode({ title: 'Where it starts' });
		const section = await api.createBlock({ node: note.ref, content: words('The seed') });
		await graphHistory.keep('A first version');
		await api.updateBlock(section.ref, { content: words('The seed of it') });
		await graphHistory.read();

		const changed = await graphHistory.between(graphHistory.at, undefined);

		const held = changed?.notes.find((one) => one.ref === note.ref);
		expect(held?.became).toBe('kept');
		expect(held?.sections).toEqual([
			{
				ulid: section.ref.split('/')[1],
				before: words('The seed'),
				after: words('The seed of it')
			}
		]);
	});
});

describe('a folder that signs what it keeps', () => {
	// What makes a version with no signature one that could not be signed rather
	// than one nobody meant to sign.
	it('says so, and says nothing where it signs with nothing', async () => {
		await graphHistory.keep('A first version');
		await graphHistory.read();
		expect(graphHistory.signs).toBe(false);

		await kept.setSigning({ kind: 'openpgp', program: 'gpg' });
		await graphHistory.read();

		expect(graphHistory.signs).toBe(true);
	});
});

describe('the graph an act leaves in front of somebody', () => {
	it('is read again, so the notes drawn are the line the folder is on', async () => {
		const under = await api.createNode({ title: 'Where it starts' });
		await nodes.load();
		await nodes.load({ origin: under.ref });
		await graphHistory.keep('A first version');
		await graphHistory.startLine('an-argument');
		await graphHistory.workOn('an-argument');
		const alone = await nodes.create({ title: 'Written over there' });
		const below = await nodes.create({
			title: 'And under it',
			from: { relation: 'under', note: under.ref }
		});
		await graphHistory.keep('Over there');
		expect(nodes.get(alone.ref)?.title).toBe('Written over there');
		expect(nodes.get(below.ref)?.title).toBe('And under it');

		expect(await graphHistory.workOn('main')).toBe(true);

		expect(nodes.get(alone.ref)).toBeUndefined();
		expect(nodes.get(below.ref)).toBeUndefined();
		expect(nodes.region().map((one) => one.title)).toEqual(['Origins', 'Where it starts']);
	});

	it('reads the sections of a note somebody is showing again', async () => {
		const note = await api.createNode({ title: 'Where it starts' });
		const section = await api.createBlock({ node: note.ref, content: words('The seed') });
		await nodes.load();
		await graphHistory.keep('A first version');
		await graphHistory.startLine('an-argument');
		await graphHistory.workOn('an-argument');
		await api.updateBlock(section.ref, { content: words('The seed of the argument') });
		await graphHistory.keep('Over there');
		await graphHistory.workOn('main');
		outlineSections.show(note.ref, true);
		await outlineSections.read(note.ref);
		expect(outlineSections.of(note.ref)?.map((one) => one.says)).toEqual(['The seed']);

		expect(await graphHistory.workOn('an-argument')).toBe(true);

		expect(outlineSections.of(note.ref)?.map((one) => one.says)).toEqual([
			'The seed of the argument'
		]);
	});

	it('brings the notes of a line back onto the canvas when it is taken in', async () => {
		await nodes.load();
		await graphHistory.keep('A first version');
		await graphHistory.startLine('an-argument');
		await graphHistory.workOn('an-argument');
		const there = await api.createNode({ title: 'Written over there' });
		await graphHistory.keep('Over there');
		await graphHistory.workOn('main');
		expect(nodes.get(there.ref)).toBeUndefined();

		expect(await graphHistory.bringIn('an-argument')).toBe(true);

		expect(nodes.get(there.ref)?.title).toBe('Written over there');
	});
});

describe('another folder opened, or the session ended', () => {
	it('leaves nothing of the folder that was open behind', async () => {
		await graphHistory.keep('A first version');
		await api.createNode({ title: 'A second thought' });
		await graphHistory.read();
		expect(graphHistory.versions).toHaveLength(1);
		expect(graphHistory.changed?.notes).toHaveLength(1);

		graphHistory.clear();

		expect(graphHistory.versions).toEqual([]);
		expect(graphHistory.lines).toEqual([]);
		expect(graphHistory.changed).toBe(null);
		expect(graphHistory.at).toBeUndefined();
		expect(graphHistory.line).toBeUndefined();
		expect(graphHistory.unkept).toBe(false);
	});

	it('leaves no unsettled merge behind either', async () => {
		const note = await api.createNode({ title: 'Origins' });
		const section = await api.createBlock({ node: note.ref, content: words('The seed') });
		await graphHistory.keep('A first version');
		await graphHistory.startLine('an-argument');
		await graphHistory.workOn('an-argument');
		await api.updateBlock(section.ref, { content: words('The seed of the argument') });
		await graphHistory.keep('Over there');
		await graphHistory.workOn('main');
		await api.updateBlock(section.ref, { content: words('The seed of it all') });
		await graphHistory.keep('Over here');
		await graphHistory.bringIn('an-argument');
		expect(graphHistory.inTwoVersions).toHaveLength(1);

		graphHistory.clear();

		expect(graphHistory.inTwoVersions).toEqual([]);
		expect(graphHistory.taking).toBe(null);
	});
});

describe('what has moved under a note since it was confirmed', () => {
	/** A file in the folder, kept as its own version. */
	async function keepFile(path: string, said: string): Promise<string> {
		await folder().write(path, new TextEncoder().encode(said));
		await graphHistory.keep(`Wrote ${path}`);
		return graphHistory.at as string;
	}

	it('names the anchors a version kept since then has touched', async () => {
		await keepFile('src/parser.ts', 'a');
		const read = await keepFile('src/history.rs', 'a');
		await keepFile('src/parser.ts', 'b');

		expect(await graphHistory.changedSince(read, ['src/parser.ts', 'src/history.rs'])).toEqual([
			'src/parser.ts'
		]);
	});

	it('says nothing where nothing has moved', async () => {
		const read = await keepFile('src/parser.ts', 'a');

		expect(await graphHistory.changedSince(read, ['src/parser.ts'])).toEqual([]);
	});

	// A note confirmed on somebody else's device names a version this folder has
	// never been on, which is no reason to tell anybody the code has moved.
	it('says nothing of a version this folder has never been on', async () => {
		await keepFile('src/parser.ts', 'a');

		expect(await graphHistory.changedSince('nowhere', ['src/parser.ts'])).toEqual([]);
	});

	it('says nothing where this platform keeps no history', async () => {
		const read = await keepFile('src/parser.ts', 'a');
		shellKeeping(undefined);

		expect(await graphHistory.changedSince(read, ['src/parser.ts'])).toEqual([]);
	});
});
