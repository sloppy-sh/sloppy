// Standing on a version is somewhere to write from, so nothing ever lands on
// one: the line opens before anything is written or kept, wherever the writing
// came from — DESIGN.md § "The history as a picture".

import { LocalApi, MemoryFiles, MemoryHistory } from '@sloppy/local';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetApi } from '../api.js';
import { initRuntime } from '../runtime.js';
import { saveNow } from './autosave.svelte.js';
import { graphs } from './graphs.svelte.js';
import { graphHistory } from './history.svelte.js';
import { nodes } from './nodes.svelte.js';
import { outlineSections } from './outline-sections.svelte.js';
import { prefs } from './prefs.svelte.js';
import { tags } from './tags.svelte.js';

const ROOT = '/Users/me/garden';

let store: Map<string, Uint8Array>;
let served: LocalApi;
let kept: MemoryHistory;

function folder(): MemoryFiles {
	return new MemoryFiles({ root: ROOT, store, data: '/data' });
}

/** The older of the two versions kept, which is the one somebody stands on. */
function theOlder(): string {
	const first = graphHistory.versions.at(-1);
	if (!first) throw new Error('Nothing has been kept');
	return first.id;
}

function lineFrom(version: string): string {
	return `from-${version.slice(0, 8)}`;
}

/** Somebody writing into the folder some other way than through the page: an
 *  open note, a chat, a tool at the terminal. */
async function somethingIsWritten(title: string): Promise<void> {
	await served.createNode({ title });
}

beforeEach(async () => {
	localStorage.clear();
	prefs.init();
	nodes.clear();
	outlineSections.clear();
	tags.clear();
	graphs.clear();
	graphHistory.clear();
	store = new Map();
	served = new LocalApi(folder());
	kept = new MemoryHistory(folder(), { author: 'Ada' });
	initRuntime({
		apiHost: () => '',
		mode: () => 'local',
		createApi: () => (served = new LocalApi(folder())),
		vault: {
			folder: () => ROOT,
			graph: () => new LocalApi(folder()).graphHere(),
			asks: true,
			open: async () => ROOT
		},
		history: () => kept
	});
	resetApi();
	await served.createNode({ title: 'Origins' });
	await graphHistory.keep('A first version');
	await served.createNode({ title: 'A second thought' });
	await graphHistory.keep('A second version');
});

describe('a line to write on', () => {
	it('opens nothing while the folder is on a line already', async () => {
		expect(await graphHistory.lineToWriteOn()).toBe(true);

		expect(graphHistory.line).toBe('main');
		expect(graphHistory.openedLine).toBeNull();
		expect(graphHistory.lines.map((one) => one.name)).toEqual(['main']);
	});

	// A real checkout outlives the app, so the first write after it starts again
	// may come before anything has drawn the history.
	it('opens one though nothing has read the history this time round', async () => {
		const older = theOlder();
		expect(await graphHistory.standOn(older)).toBe(true);
		graphHistory.clear();

		expect(await graphHistory.lineToWriteOn()).toBe(true);

		expect(graphHistory.line).toBe(lineFrom(older));
		expect(graphHistory.openedLine).toBe(lineFrom(older));
	});

	it('says which line it opened after that line is renamed, and stops once the folder leaves it', async () => {
		const older = theOlder();
		await graphHistory.standOn(older);
		await graphHistory.lineToWriteOn();

		expect(await graphHistory.renameLine(lineFrom(older), 'the-other-way')).toBe(true);
		expect(graphHistory.openedLine).toBe('the-other-way');

		expect(await graphHistory.workOn('main')).toBe(true);
		expect(graphHistory.openedLine).toBeNull();
	});
});

describe('keeping a version while the folder stands on one', () => {
	// A version kept on no line is reachable from nothing, and the folder reads
	// as having nothing unkept the moment after — so the next move takes the
	// writing away without asking.
	it('opens a line first, and keeps on it', async () => {
		const older = theOlder();
		await graphHistory.standOn(older);
		await somethingIsWritten('Written while standing there');

		expect(await graphHistory.keep('Something written there')).toBe(true);

		expect(graphHistory.line).toBe(lineFrom(older));
		expect(graphHistory.lines.find((one) => one.name === graphHistory.line)?.head).toBe(
			graphHistory.at
		);
		expect(graphHistory.unkept).toBe(false);
	});

	it('does the same for a version kept on the clock', async () => {
		prefs.set('autosave', true);
		const older = theOlder();
		await graphHistory.standOn(older);
		await somethingIsWritten('Written while standing there');

		await saveNow();

		expect(graphHistory.line).toBe(lineFrom(older));
		expect(graphHistory.lines.find((one) => one.name === graphHistory.line)?.head).toBe(
			graphHistory.at
		);
		expect(graphHistory.unkept).toBe(false);
	});
});
