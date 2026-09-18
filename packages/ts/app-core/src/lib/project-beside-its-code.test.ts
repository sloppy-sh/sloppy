// A project's notes over the real store: the container is where they land, the
// code is the folder around it, and saying a note still holds is what a later
// change to that code is measured against —
// docs/ARCHITECTURE.md § "A project's container".

import 'fake-indexeddb/auto';
import { LocalApi, MemoryFiles, MemoryHistory } from '@sloppy/local';
import { anchorsOf, type BlockDocument } from '@sloppy/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { api, resetApi } from './api.js';
import { textIn } from './project-code.js';
import { initRuntime, runtime } from './runtime.js';
import { graphHistory } from './stores/history.svelte.js';
import { nodes } from './stores/nodes.svelte.js';

const PROJECT = '/work/compiler';
const PARSER = 'src/parser.ts';

const written = new TextEncoder();
const read = new TextDecoder();

let store: Map<string, Uint8Array>;
/** The project's own repository, which is what a container's history is. Its
 *  paths are the project's, which is how `changedSince` spells an anchor. */
let kept: MemoryHistory;

function device(): MemoryFiles {
	return new MemoryFiles({ store, data: '/data' });
}

function served(): LocalApi {
	return new LocalApi(device().at(PROJECT));
}

/** The shell the native app is over a project: the folder somebody picked is
 *  the project's root, the graph is the container inside it, and the code is
 *  the folder around both. */
function shell(): void {
	initRuntime({
		apiHost: () => '',
		mode: () => 'local',
		createApi: () => served(),
		vault: {
			folder: () => PROJECT,
			graph: () => served().graphHere(),
			asks: true,
			open: async () => PROJECT
		},
		history: () => kept,
		project: () => served().projectFolder()
	});
	resetApi();
}

function pointingAt(path: string): BlockDocument {
	return {
		type: 'doc',
		content: [
			{
				type: 'paragraph',
				content: [
					{
						type: 'text',
						text: path,
						marks: [{ type: 'link', attrs: { href: `code:${path}` } }]
					}
				]
			}
		]
	};
}

async function wroteCode(said: string): Promise<string> {
	await device().at(PROJECT).write(PARSER, written.encode(said));
	await kept.commit(`Wrote ${PARSER}`);
	return (await kept.currentCommit()) as string;
}

beforeEach(async () => {
	store = new Map();
	kept = new MemoryHistory(device().at(PROJECT), { author: 'Ada' });
	nodes.clear();
	graphHistory.clear();
	await new LocalApi(device()).openProject(PROJECT);
	shell();
});

describe('a note in a project, over the folder it is kept in', () => {
	it('lands in the container, with the code beside it and a history over both', async () => {
		await wroteCode('export const parse = 1;\n');

		const project = await runtime.project();

		expect(project?.root).toBe(PROJECT);
		expect(await textIn(project as MemoryFiles, PARSER)).toBe('export const parse = 1;\n');
		expect(store.has(`${PROJECT}/.sloppy/graph.json`)).toBe(true);
		expect(store.has(`${PROJECT}/graph.json`)).toBe(false);
	});

	it('says it still holds against the version the folder is on, and says so in the file', async () => {
		const at = await wroteCode('export const parse = 1;\n');
		const note = await api.createNode({ title: 'Why the parser is hand-rolled' });
		await api.createBlock({ node: note.ref, content: pointingAt(PARSER) });
		const was = await api.getNode(note.ref);

		expect(await graphHistory.versionNow()).toBe(at);
		const held = await api.updateNode(note.ref, { checked: at });

		expect(held.checked).toBe(at);
		expect(held.updated_at).toBe(was?.updated_at);
		const file = store.get(`${PROJECT}/.sloppy/notes/${note.ref.split('/')[1]}.md`);
		expect(read.decode(file)).toContain(`checked: ${at}`);
	});

	it('is told the code under it moved after that, and told nothing before it', async () => {
		const at = await wroteCode('export const parse = 1;\n');
		const note = await api.createNode({ title: 'Why the parser is hand-rolled' });
		const section = await api.createBlock({ node: note.ref, content: pointingAt(PARSER) });
		await api.updateNode(note.ref, { checked: at });
		const anchors = anchorsOf(section.content).map((one) => one.path);

		expect(await graphHistory.changedSince(at, anchors)).toEqual([]);

		await wroteCode('export const parse = 2;\n');

		expect(await graphHistory.changedSince(at, anchors)).toEqual([PARSER]);
	});
});
