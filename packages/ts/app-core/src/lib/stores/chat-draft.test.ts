// A draft of the notes, driven the way the chat drives one: the folder in
// memory, a copy of it the chat writes into, and the history over each.
// docs/ARCHITECTURE.md § "Asking a tool to write the notes".

import 'fake-indexeddb/auto';
import { LocalApi, MemoryFiles, MemoryHistory } from '@sloppy/local';
import {
	draftBranch,
	ulid,
	type BlockDocument,
	type ChatAgent,
	type OwnedRef,
	type StandingDraft
} from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, resetApi } from '../api.js';
import { draftOnTheCanvas, draftRows, sectionsDrafted } from '../draft-said.js';
import { initRuntime, type ChatAccess, type DraftAccess } from '../runtime.js';
import { seamSettledAgain } from '../seam.svelte.js';
import { chatDraft } from './chat-draft.svelte.js';

const ROOT = '/Users/me/garden';
const COPY = '/appdata/drafts/one';

let store: Map<string, Uint8Array>;
let copyStore: Map<string, Uint8Array>;
let kept: MemoryHistory;
let standing: { draft: StandingDraft; history: MemoryHistory } | null;

function folder(): MemoryFiles {
	return new MemoryFiles({ root: ROOT, store, data: '/data' });
}

function copyFiles(): MemoryFiles {
	return new MemoryFiles({ root: COPY, store: copyStore, data: '/data' });
}

/** The graph as the chat reaches it: a store over the draft's copy, writing
 *  under the identity the copy carried over with it. */
function inTheDraft(): LocalApi {
	return new LocalApi(copyFiles());
}

function words(said: string): BlockDocument {
	return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: said }] }] };
}

function textIn(content: BlockDocument): string {
	return JSON.stringify(content).replace(/.*"text":"([^"]*)".*/, '$1');
}

/**
 * The platform's half of a draft: a second folder taken from the version the
 * first was last kept at, carrying the identity it writes under, with a
 * history of its own whose first version is the one it forked from.
 */
const drafts: DraftAccess = {
	standing: async () => standing?.draft,
	start: async () => {
		if (standing) return standing.draft;
		const tip = await kept.currentCommit();
		const from = tip === undefined ? new Map<string, Uint8Array>() : await kept.readAt(tip);
		copyStore = new Map();
		for (const [path, bytes] of store) {
			if (path.startsWith('/data/')) copyStore.set(path, bytes);
		}
		for (const [path, bytes] of from) copyStore.set(`${COPY}/${path}`, bytes);
		const history = new MemoryHistory(copyFiles(), { author: 'Ada' });
		const forked = await history.commit('The version it was taken from');
		if (!forked) throw new Error('a copy of nothing');
		const id = ulid();
		standing = {
			draft: { id, root: COPY, vault: COPY, branch: draftBranch(id), from: forked.id },
			history
		};
		return standing.draft;
	},
	discard: async () => {
		standing = null;
		copyStore = new Map();
	},
	files: () => copyFiles(),
	history: () => {
		if (!standing) throw new Error('no draft');
		return standing.history;
	}
};

const chatting: ChatAccess = {
	agents: async () => ['claude_code'] as ChatAgent[],
	open: async () => {},
	say: async () => {},
	stop: async () => {},
	close: async () => {},
	drafts
};

function shell(): void {
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
		history: () => kept,
		chat: chatting
	});
	seamSettledAgain();
	resetApi();
}

/** One turn of the chat: the draft where none stands, what it wrote, and the
 *  version kept on it when the turn ends. */
async function aTurn(wrote: (drafted: LocalApi) => Promise<void>): Promise<void> {
	await chatDraft.start();
	await wrote(inTheDraft());
	await chatDraft.keepWhatTheTurnWrote();
}

let origins: OwnedRef;
let seed: OwnedRef;

beforeEach(async () => {
	store = new Map();
	copyStore = new Map();
	standing = null;
	kept = new MemoryHistory(folder(), { author: 'Ada' });
	chatDraft.clear();
	shell();
	const note = await api.createNode({ title: 'Origins' });
	origins = note.ref;
	const section = await api.createBlock({ node: origins, content: words('The seed') });
	seed = section.ref;
	await kept.commit('A first version');
});

afterEach(() => {
	chatDraft.clear();
	standing = null;
	initRuntime({
		apiHost: () => '',
		mode: () => 'hosted',
		createApi: undefined,
		vault: undefined,
		history: () => undefined,
		chat: undefined
	});
	seamSettledAgain();
	resetApi();
});

describe('a draft standing for the folder', () => {
	it('is not there until a turn wants one, and is found again afterwards', async () => {
		await chatDraft.look();
		expect(chatDraft.standing).toBe(null);
		expect(chatDraft.keeps).toBe(true);

		await chatDraft.start();
		const held = chatDraft.standing;
		expect(held).not.toBe(null);

		// What a run of the app finds when it opens on a draft left standing.
		chatDraft.clear();
		await chatDraft.look();
		expect(chatDraft.standing?.id).toBe(held?.id);
	});

	it('answers the standing one rather than making a second', async () => {
		const first = await chatDraft.start();
		const second = await chatDraft.start();
		expect(second.id).toBe(first.id);
	});
});

describe('a draft growing', () => {
	it('counts what it holds as the turns go, and leaves the folder alone', async () => {
		await aTurn(async (drafted) => {
			await drafted.createNode({ title: 'The parser' });
		});

		expect(chatDraft.counts?.notes.added).toBe(1);
		expect((await api.listNodes({ graph: await new LocalApi(folder()).graphHere() })).length).toBe(
			1
		);

		await aTurn(async (drafted) => {
			await drafted.createNode({ title: 'The vault' });
			await drafted.updateNode(origins, { title: 'Where it began' });
		});

		expect(chatDraft.counts?.notes.added).toBe(2);
		expect(chatDraft.counts?.notes.retitled).toBe(1);
		expect((await api.getNode(origins))?.title).toBe('Origins');
	});
});

describe('reading a draft', () => {
	it('lists every kind of change, one row per note', async () => {
		let parser: OwnedRef;
		await aTurn(async (drafted) => {
			parser = (await drafted.createNode({ title: 'The parser' })).ref;
			await drafted.setAddress(parser, '1a');
			await drafted.updateBlock(seed, { content: words('The seed of it all') });
			await drafted.updateNode(origins, { title: 'Where it began' });
		});

		await chatDraft.review();
		const read = chatDraft.read;
		if (!read) throw new Error('nothing was read');
		const rows = draftRows(read.difference, read.conflicts, read.named);
		const bands = new Map(rows.map((one) => [one.ref, one.band]));

		expect(read.nothing).toBe(false);
		expect(bands.get(parser!)).toBe('added');
		// One row for the note, saying both things that happened to it.
		expect(rows.filter((one) => one.ref === origins)).toHaveLength(1);
		expect(bands.get(origins)).toBe('changed');
		const said = rows
			.find((one) => one.ref === origins)
			?.card.rows.map((row) => `${row.label}: ${row.value}`);
		expect(said).toContain('Sections: 1 written into');
		expect(said).toContain('Was called: Origins');
	});

	it('opens a note as either copy has it, and never one for the other', async () => {
		await aTurn(async (drafted) => {
			await drafted.updateBlock(seed, { content: words('The seed of it all') });
		});
		await chatDraft.review();

		const drafted = await chatDraft.asRead('draft', origins);
		const held = await chatDraft.asRead('folder', origins);
		expect(drafted?.sections.map((one) => textIn(one.content))).toEqual(['The seed of it all']);
		expect(held?.sections.map((one) => textIn(one.content))).toEqual(['The seed']);
		expect((await api.listBlocks(origins)).map((one) => textIn(one.content))).toEqual(['The seed']);
	});

	it('hands the canvas the draft as the later of two states, with what went in it', async () => {
		let parser: OwnedRef;
		await aTurn(async (drafted) => {
			parser = (await drafted.createNode({ title: 'The parser' })).ref;
			await drafted.updateNode(origins, { title: 'Where it began' });
		});
		await chatDraft.review();
		const read = chatDraft.read;
		if (!read) throw new Error('nothing was read');
		const shown = draftOnTheCanvas(read);

		expect(shown.notes.map((one) => one.title).sort()).toEqual(['The parser', 'Where it began']);
		expect([...shown.difference.added]).toEqual([parser!]);
		expect([...shown.difference.changed]).toEqual([origins]);
		expect(shown.at).toBe(await standing?.history.currentCommit());
	});

	it('hands the canvas a binned note as the folder had it, so it draws where it was', async () => {
		let parser: OwnedRef;
		await aTurn(async (drafted) => {
			parser = (await drafted.createNode({ title: 'The parser' })).ref;
		});
		expect(await chatDraft.merge()).toBe(true);
		await aTurn(async (drafted) => {
			await drafted.deleteNode(parser);
		});
		await chatDraft.review();
		const read = chatDraft.read;
		if (!read) throw new Error('nothing was read');

		expect(draftOnTheCanvas(read).difference.removed.map((one) => one.title)).toEqual([
			'The parser'
		]);
	});

	it('names the sections the draft wrote, and none of the ones it left alone', async () => {
		let second: OwnedRef;
		await aTurn(async (drafted) => {
			second = (await drafted.createBlock({ node: origins, content: words('And then') })).ref;
			await drafted.updateBlock(seed, { content: words('The seed of it all') });
		});
		await chatDraft.review();
		const read = chatDraft.read;
		if (!read) throw new Error('nothing was read');
		const drafted = await chatDraft.asRead('draft', origins);

		expect([...sectionsDrafted(read.difference, origins, drafted?.sections ?? [])].sort()).toEqual(
			[seed, second!].sort()
		);
	});

	it('says so in one line where nothing in it is different', async () => {
		await chatDraft.start();
		await chatDraft.review();
		expect(chatDraft.read?.nothing).toBe(true);
	});
});

describe('taking a draft in', () => {
	it('leaves the folder holding what the draft wrote, keeps a version, and lets the draft go', async () => {
		await aTurn(async (drafted) => {
			await drafted.createNode({ title: 'The parser' });
			await drafted.updateBlock(seed, { content: words('The seed of it all') });
		});
		await chatDraft.review();
		const versions = (await kept.log(30)).commits.length;

		expect(await chatDraft.merge()).toBe(true);

		const here = await api.listNodes({ graph: await new LocalApi(folder()).graphHere() });
		expect(here.map((one) => one.title).sort()).toEqual(['Origins', 'The parser']);
		expect((await api.listBlocks(origins)).map((one) => textIn(one.content))).toEqual([
			'The seed of it all'
		]);
		expect((await kept.log(30)).commits.length).toBe(versions + 1);
		expect(chatDraft.standing).toBe(null);
		expect(copyStore.size).toBe(0);
	});

	it('hands a section both sides wrote into to the person, and settles it as they chose', async () => {
		await aTurn(async (drafted) => {
			await drafted.updateBlock(seed, { content: words('The seed, as the chat has it') });
		});
		await api.updateBlock(seed, { content: words('The seed, as I have it') });

		await chatDraft.review();
		const conflicts = chatDraft.read?.conflicts ?? [];
		expect(conflicts.map((one) => one.ref)).toEqual([origins]);
		expect(conflicts[0].sections).toHaveLength(1);

		const section = conflicts[0].sections[0].section;
		expect(
			await chatDraft.merge({
				resolutions: [
					{ kind: 'section', ref: origins, keep: 'mine', sections: [{ section, keep: 'theirs' }] }
				]
			})
		).toBe(true);

		expect((await api.listBlocks(origins)).map((one) => textIn(one.content))).toEqual([
			'The seed, as the chat has it'
		]);
	});

	// Both sides wrote a note while the draft ran, so both spent the same
	// number — AI.md § "The Genealogy Is the Protocol": one note keeps it and
	// the other goes on being led to by it.
	it('hands a number both sides spent to the person, and keeps both notes', async () => {
		await aTurn(async (drafted) => {
			await drafted.createNode({ title: 'The parser' });
		});
		const mine = await api.createNode({ title: 'Mine alone' });

		await chatDraft.review();
		const conflicts = chatDraft.read?.conflicts ?? [];
		expect(conflicts.map((one) => [one.kind, one.mine, one.theirs])).toEqual([
			['address', 'Mine alone', 'The parser']
		]);

		expect(
			await chatDraft.merge({
				resolutions: [{ kind: 'address', ref: mine.ref, keep: 'mine', sections: [] }]
			})
		).toBe(true);

		const here = await api.listNodes({ graph: await new LocalApi(folder()).graphHere() });
		expect(here.map((one) => one.title).sort()).toEqual(['Mine alone', 'Origins', 'The parser']);
		expect(here.find((one) => one.title === 'Mine alone')?.address).toBe('2');
	});
});

describe('throwing a draft away', () => {
	it('leaves nothing of it, and nothing of it in the folder', async () => {
		await aTurn(async (drafted) => {
			await drafted.createNode({ title: 'The parser' });
		});
		const versions = (await kept.log(30)).commits.length;

		expect(await chatDraft.discard()).toBe(true);

		expect(chatDraft.standing).toBe(null);
		expect(chatDraft.counts).toBe(null);
		expect(chatDraft.read).toBe(null);
		expect(copyStore.size).toBe(0);
		const here = await api.listNodes({ graph: await new LocalApi(folder()).graphHere() });
		expect(here.map((one) => one.title)).toEqual(['Origins']);
		expect((await kept.log(30)).commits.length).toBe(versions);
	});
});
