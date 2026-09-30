// Being on a version rather than a line is said wherever the history is, and so
// is the line somebody's writing opened — DESIGN.md § "The history as a
// picture". This is the lines a phone reaches, where there is no column.

import { LocalApi, MemoryFiles, MemoryHistory } from '@sloppy/local';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetApi } from '../api.js';
import { initRuntime } from '../runtime.js';
import { graphs } from '../stores/graphs.svelte.js';
import { graphHistory } from '../stores/history.svelte.js';
import { nodes } from '../stores/nodes.svelte.js';
import { outlineSections } from '../stores/outline-sections.svelte.js';
import { tags } from '../stores/tags.svelte.js';
import BranchesPanel from './branches-panel.svelte';

const ROOT = '/Users/me/garden';

let store: Map<string, Uint8Array>;
let served: LocalApi;
let kept: MemoryHistory;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function folder(): MemoryFiles {
	return new MemoryFiles({ root: ROOT, store, data: '/data' });
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 8; turn += 1) await new Promise((done) => setTimeout(done, 0));
	flushSync();
}

/** The lines panel, which is how a phone reaches the history's lines. */
function show(): void {
	mounted = mount(BranchesPanel, {
		target,
		props: {
			lines: graphHistory.lines.map((one) => ({
				name: one.name,
				head: one.head,
				here: one.current,
				elsewhere: one.remote !== undefined
			})),
			anyVersion: true,
			onStartLine: () => Promise.resolve(true),
			onWorkOn: () => Promise.resolve(true),
			onBringIn: () => Promise.resolve(true),
			onDrop: () => Promise.resolve(true),
			onStartFrom: () => Promise.resolve(true)
		}
	});
	flushSync();
}

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

function press(label: string): void {
	const one = [...document.body.querySelectorAll('button')].find(
		(button) => (button.textContent ?? '').replace(/\s+/g, ' ').trim() === label
	);
	if (!one) throw new Error(`Nothing on the screen is labelled "${label}"`);
	one.click();
}

/** The older of the two versions kept. */
function theOlder(): string {
	const first = graphHistory.versions.at(-1);
	if (!first) throw new Error('Nothing has been kept');
	return first.id;
}

beforeEach(async () => {
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
	target = document.createElement('div');
	document.body.appendChild(target);
	await served.createNode({ title: 'Origins' });
	await graphHistory.keep('A first version');
	await served.createNode({ title: 'A second thought' });
	await graphHistory.keep('A second version');
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	graphHistory.clear();
	initRuntime({ apiHost: () => '', mode: () => 'hosted', history: () => undefined });
	resetApi();
	target.remove();
	document.body.innerHTML = '';
});

describe('where the folder stands, beside the lines', () => {
	it('says nothing at all while the folder is on a line', () => {
		show();

		expect(screen()).not.toContain('Working on a version');
	});

	it('says which version the folder is on', async () => {
		const older = theOlder();
		await graphHistory.standOn(older);
		show();

		expect(screen()).toContain(`Working on a version, ${older.slice(0, 8)}.`);
	});

	// A phone has no column, so an affordance only the column has is one the
	// primary surface does without — AI.md § Project.
	it('says the line writing opened there, and offers to rename it', async () => {
		const older = theOlder();
		await graphHistory.standOn(older);
		await graphHistory.lineToWriteOn();
		show();

		expect(screen()).toContain(`Your writing opened a new line, from-${older.slice(0, 8)}.`);

		press('Rename');
		await settle();
		const named = target.querySelector<HTMLInputElement>('[aria-label="What this line is called"]');
		if (!named) throw new Error('Nothing here names the line');
		named.value = 'the-other-way';
		named.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		press('Rename it');
		await settle();

		expect(graphHistory.line).toBe('the-other-way');
		expect(screen()).toContain('Your writing opened a new line, the-other-way.');
	});

	// Silence teaches somebody the control is broken.
	it('says what the folder would not do when the name is taken', async () => {
		const older = theOlder();
		await graphHistory.standOn(older);
		await graphHistory.lineToWriteOn();
		show();

		press('Rename');
		await settle();
		const named = target.querySelector<HTMLInputElement>('[aria-label="What this line is called"]');
		if (!named) throw new Error('Nothing here names the line');
		named.value = 'main';
		named.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		press('Rename it');
		await settle();

		expect(graphHistory.line).toBe(`from-${older.slice(0, 8)}`);
		expect(target.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
			'There is already one called main.'
		);
	});
});
