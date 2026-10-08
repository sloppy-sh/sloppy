// The choices behind the strip's +: each hands its act to the one switch path,
// and goes once a folder is in front of somebody.

import 'fake-indexeddb/auto';
import type { OwnedRef } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initRuntime, type KnownFolder } from '../runtime.js';
import { graphs } from '../stores/graphs.svelte.js';
import { tabs } from '../stores/tabs.svelte.js';
import OpenAnother from './open-another.svelte';

const GARDEN = '/Users/me/garden';
const THESIS = '/Users/me/thesis';
const OWNER = 'did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE';
const known: KnownFolder[] = [
	{
		root: GARDEN,
		graph: { ref: `${OWNER}/01A` as OwnedRef, name: 'The garden', owner: OWNER },
		reachable: true
	},
	{
		root: THESIS,
		graph: { ref: `${OWNER}/01B` as OwnedRef, name: 'The thesis', owner: OWNER },
		reachable: true
	}
];

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let done: number;

async function settle(): Promise<void> {
	for (let turn = 0; turn < 10; turn += 1) {
		await new Promise((wake) => setTimeout(wake));
		flushSync();
	}
}

const named = (words: string): HTMLButtonElement | undefined =>
	[...target.querySelectorAll('button')].find((one) => one.textContent?.trim() === words);

function show(): void {
	mounted = mount(OpenAnother, { target, props: { onDone: () => done++ } });
	flushSync();
}

beforeEach(async () => {
	done = 0;
	initRuntime({
		apiHost: () => '',
		mode: () => 'local',
		vault: {
			folder: () => GARDEN,
			graph: async () => undefined,
			asks: true,
			open: async () => undefined,
			known: async () => known,
			openKnown: async () => {},
			start: async () => undefined,
			startHere: async () => undefined,
			openProject: async () => undefined
		}
	});
	graphs.clear();
	tabs.clear();
	await graphs.readOpenFolder();
	vi.spyOn(tabs, 'openWith').mockImplementation(async (open) => open());
	vi.spyOn(tabs, 'switchTo').mockResolvedValue();
	target = document.createElement('div');
	document.body.append(target);
});

afterEach(() => {
	vi.restoreAllMocks();
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
});

describe('the choices of what to open next', () => {
	it('start a graph of its own, named where somebody named it', async () => {
		const started = vi.spyOn(graphs, 'startHere').mockResolvedValue(true);
		const renamed = vi.spyOn(graphs, 'rename').mockResolvedValue(undefined as never);
		show();

		const field = target.querySelector<HTMLInputElement>('input');
		if (field) {
			field.value = 'The compiler';
			field.dispatchEvent(new Event('input', { bubbles: true }));
		}
		named('Start a graph')?.click();
		await settle();

		expect(started).toHaveBeenCalledTimes(1);
		expect(renamed).toHaveBeenCalledWith(expect.anything(), { title: 'The compiler' });
		expect(done).toBe(1);
	});

	it('open a project and choose a folder through the one switch path', async () => {
		const project = vi.spyOn(graphs, 'openProject').mockResolvedValue(true);
		const folder = vi.spyOn(graphs, 'startFolder').mockResolvedValue(false);
		show();

		named('Open a project')?.click();
		await settle();
		expect(project).toHaveBeenCalledTimes(1);
		expect(done).toBe(1);

		named('Choose a folder')?.click();
		await settle();
		expect(folder).toHaveBeenCalledTimes(1);
		// Nobody chose a folder, so the choices stay.
		expect(done).toBe(1);
	});

	it('list where somebody has been writing, without the folder in front of them', async () => {
		show();
		await settle();

		const shown = target.textContent?.replace(/\s+/g, ' ') ?? '';
		expect(shown).toContain('The thesis');
		expect(shown).not.toContain('The garden');
	});

	it('say what went wrong, in words, and stay', async () => {
		vi.spyOn(graphs, 'startHere').mockRejectedValue(new Error('no room'));
		show();

		named('Start a graph')?.click();
		await settle();

		expect(target.querySelector('[role="alert"]')?.textContent).toContain('could not');
		expect(done).toBe(0);
	});
});
