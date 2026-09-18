// A project opened by its own root, with the notes started inside it and the
// code beside them: what an anchor in one of those notes reaches —
// docs/ARCHITECTURE.md § "A project's container".

import {
	CONTAINER_DIR,
	containerOf,
	LocalApi,
	MemoryFiles,
	projectRootOf,
	type Files
} from '@sloppy/local';
import { parseCodeAnchor, type CodeAnchor } from '@sloppy/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { excerpt } from './components/code-preview.js';
import { fileAddress, filesIn, textIn } from './project-code.js';

const PROJECT = '/Users/me/engine';
const PARSER = 'export function discover() {\n\treturn bounded();\n}\n';

const encode = (said: string) => new TextEncoder().encode(said);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

type Said = Parameters<typeof projectRootOf>[1];

let root: MemoryFiles;

async function graphIn(vault: Files): Promise<Said> {
	return JSON.parse(decode((await vault.read('graph.json')) as Uint8Array)) as Said;
}

/**
 * The project as the shell leaves it once somebody has opened it: a graph
 * started in the container, a note written in it, and `project` saying where
 * the code is.
 */
async function openedAsAProject(): Promise<Files> {
	const vault = root.at(CONTAINER_DIR);
	const api = new LocalApi(vault);
	await api.graphHere();
	await api.createNode({ title: 'Why discovery is bounded' });
	const said = await graphIn(vault);
	await vault.write(
		'graph.json',
		encode(`${JSON.stringify({ ...said, project: '..' }, null, 2)}\n`)
	);
	return vault;
}

/** Where the code is, reached the way a surface in the app reaches it: off the
 *  container it is reading the notes out of. */
async function codeBeside(vault: Files): Promise<Files> {
	return projectRootOf(vault, await graphIn(vault)) as Files;
}

beforeEach(async () => {
	root = new MemoryFiles({ root: PROJECT, data: '/data' });
	await root.write('src/parser.ts', encode(PARSER));
	await root.write('README.md', encode('# Engine\n'));
});

describe('the code beside a project’s notes', () => {
	it('is the folder the container was started in', async () => {
		const vault = await openedAsAProject();

		expect((await containerOf(root))?.root).toBe(`${PROJECT}/${CONTAINER_DIR}`);
		expect((await codeBeside(vault)).root).toBe(PROJECT);
	});

	// The notes are inside the project, so the one folder nothing there is
	// written about is the folder holding the writing.
	it('is what somebody is offered to point at, and never the notes themselves', async () => {
		const vault = await openedAsAProject();
		const code = await codeBeside(vault);

		const offered = await filesIn(code);

		expect(await code.list(CONTAINER_DIR)).not.toEqual([]);
		expect(offered.sort()).toEqual(['README.md', 'src/parser.ts']);
	});

	it('is read back by the anchor a note written there carries', async () => {
		const code = await codeBeside(await openedAsAProject());
		const anchor = parseCodeAnchor('code:src/parser.ts#discover') as CodeAnchor;

		const said = (await textIn(code, anchor.path)) as string;

		expect(excerpt(said, anchor).lines[0]).toBe('export function discover() {');
	});

	it('is where whatever opens files here is sent, beside the notes and not inside them', async () => {
		const code = await codeBeside(await openedAsAProject());

		expect(fileAddress(code.root, 'src/parser.ts')).toBe('file:///Users/me/engine/src/parser.ts');
	});
});
