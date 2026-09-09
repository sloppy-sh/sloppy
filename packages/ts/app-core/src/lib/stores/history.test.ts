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

describe('a note both lines changed', () => {
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
