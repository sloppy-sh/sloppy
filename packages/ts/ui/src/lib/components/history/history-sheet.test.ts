// @vitest-environment jsdom
import type { BlockDocument } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import type { ChangedNote } from './changed-notes.svelte';
import HistorySheet, { type KeptVersion, type LineOfWork } from './history-sheet.svelte';

const VERSION: KeptVersion = {
	id: 'a1',
	message: 'Where the argument turned',
	author: 'Ada',
	when: 'Yesterday',
	merged: false
};

const LINES: LineOfWork[] = [
	{ name: 'main', head: 'a1', here: true },
	{ name: 'an-argument', head: 'b2', here: false }
];

function words(said: string): BlockDocument {
	return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: said }] }] };
}

const CHANGED: ChangedNote[] = [
	{
		ref: 'did:syr:z1/01ARZ3NDEKTSV4RRFFQ69G5FAV',
		title: 'Origins',
		address: '1',
		became: 'kept',
		retitled: { from: 'Where it starts' },
		reordered: false,
		sections: [
			{
				ulid: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
				before: words('The seed'),
				after: words('The seed of it')
			}
		]
	}
];

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let kept: string[];
let started: string[];
let worked: string[];
let brought: string[];
let settled: string[];
let opened: string[];
let compares: [string | undefined, string | undefined][];

async function settle(): Promise<void> {
	for (let at = 0; at < 4; at += 1) {
		flushSync();
		await new Promise((done) => setTimeout(done, 0));
	}
	flushSync();
}

function open(over: Record<string, unknown> = {}): void {
	mounted = mount(HistorySheet, {
		target,
		props: {
			open: true,
			changed: CHANGED,
			anythingToKeep: true,
			versions: [VERSION],
			lines: LINES,
			onKeep: async (message: string) => {
				kept.push(message);
				return true;
			},
			onOlder: () => {},
			onStartLine: async (name: string) => {
				started.push(name);
				return true;
			},
			onWorkOn: async (name: string) => {
				worked.push(name);
				return true;
			},
			onBringIn: async (name: string) => {
				brought.push(name);
				return true;
			},
			onSettle: (path: string) => settled.push(path),
			onOpenVersion: (id: string) => opened.push(id),
			onCompare: async (before: string | undefined, after: string | undefined) => {
				compares.push([before, after]);
				return CHANGED;
			},
			...over
		}
	});
	flushSync();
}

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

function control(labelled: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find((one) =>
		one.textContent?.includes(labelled)
	);
	if (!found) throw new Error(`Nothing on the screen is labelled "${labelled}"`);
	return found;
}

function field(labelled: string): HTMLInputElement {
	const found = document.body.querySelector<HTMLInputElement>(`[aria-label="${labelled}"]`);
	if (!found) throw new Error(`No field is labelled "${labelled}"`);
	return found;
}

function typeInto(input: HTMLInputElement, said: string): void {
	input.value = said;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

beforeEach(() => {
	stubMediaQuery((query) => query.includes('max-width'));
	stubResizeObserver();
	kept = [];
	started = [];
	worked = [];
	brought = [];
	settled = [];
	opened = [];
	compares = [];
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
});

describe('the history of a graph', () => {
	it('says what has changed since the last version, in words', () => {
		open();

		expect(screen()).toContain('Since your last version');
		expect(screen()).toContain('Origins');
		expect(screen()).toContain('Was “Where it starts”');
		expect(screen()).toContain('The seed of it');
	});

	it('keeps a version under what a person says changed', async () => {
		open();

		control('Keep this version').click();
		await settle();
		typeInto(field('What changed'), 'A first version');
		control('Keep it').click();
		await settle();

		expect(kept).toEqual(['A first version']);
	});

	it('offers nothing to keep where nothing has changed', () => {
		open({ changed: [], anythingToKeep: false });

		expect(screen()).toContain('Nothing has changed since your last version');
		expect(control('Keep this version').disabled).toBe(true);
	});

	it('starts a line of work, works on another, and brings one in', async () => {
		open();

		typeInto(field('Name a new line of work'), 'an-argument');
		control('Start it here').click();
		await settle();
		control('Work on it').click();
		await settle();
		control('Bring it in').click();
		await settle();

		expect(started).toEqual(['an-argument']);
		expect(worked).toEqual(['an-argument']);
		expect(brought).toEqual(['an-argument']);
	});

	it('opens a version to read the graph as it was', async () => {
		open();

		control('Where the argument turned').click();
		await settle();

		expect(opened).toEqual(['a1']);
		expect(screen()).toContain('Nothing there can be written in');
	});

	it('leaves a version unopenable where the graph is not in front of anybody', () => {
		open({ onOpenVersion: undefined });

		expect(screen()).not.toContain('Nothing there can be written in');
	});

	it('shows what is different between two states somebody picks', async () => {
		open();
		const pickers = [...document.body.querySelectorAll('select')];
		expect(pickers).toHaveLength(2);
		expect([...pickers[0].options].map((one) => one.textContent?.trim())).toEqual([
			'Now',
			'an-argument, as it stands',
			'Where the argument turned'
		]);

		pickers[0].value = 'a1';
		pickers[0].dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();
		control('Show what changed').click();
		await settle();

		expect(compares).toEqual([['a1', undefined]]);
	});

	it('puts the notes two lines both wrote in first, and holds the version back', () => {
		open({
			conflicts: [
				{
					path: 'notes/01ARZ3NDEKTSV4RRFFQ69G5FAV.md',
					title: 'Origins',
					address: '1',
					isNote: true
				}
			],
			taking: 'an-argument'
		});

		expect(screen()).toContain('You and an-argument both wrote in these');
		expect(control('Keep this version').disabled).toBe(true);

		control('Choose').click();

		expect(settled).toEqual(['notes/01ARZ3NDEKTSV4RRFFQ69G5FAV.md']);
	});
});
