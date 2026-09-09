// @vitest-environment jsdom
import type { BlockDocument } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import type { ChangedNote } from './changed-notes.svelte';
import HistorySheet, {
	type KeptVersion,
	type LineOfWork,
	type StatePicked
} from './history-sheet.svelte';

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
let compares: [StatePicked, StatePicked][];

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
			onCompare: async (before: StatePicked, after: StatePicked) => {
				compares.push([before, after]);
				return { notes: CHANGED, pictures: { added: 0, removed: 0 } };
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

/** The states one of the pickers offers, with it left open. */
async function states(labelled: string): Promise<string[]> {
	const trigger = document.body.querySelector<HTMLElement>(
		`[aria-labelledby="difference-${labelled.toLowerCase()}"]`
	);
	if (!trigger) throw new Error(`No picker is labelled "${labelled}"`);
	trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
	trigger.click();
	await settle();
	return [...document.body.querySelectorAll('[role="option"]')].map(
		(one) => one.textContent?.trim() ?? ''
	);
}

async function pick(labelled: string): Promise<void> {
	const option = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(
		(one) => one.textContent?.trim() === labelled
	);
	if (!option) throw new Error(`The picker does not offer "${labelled}"`);
	option.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
	option.click();
	await settle();
}

function typeInto(input: HTMLInputElement, said: string): void {
	input.value = said;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

beforeEach(() => {
	stubMediaQuery((query) => query.includes('max-width'));
	stubResizeObserver();
	// jsdom drives no pointer, and a Select asks the element it is on about one.
	Element.prototype.hasPointerCapture = () => false;
	Element.prototype.setPointerCapture = () => {};
	Element.prototype.releasePointerCapture = () => {};
	Element.prototype.scrollIntoView = () => {};
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

		expect(await states('From')).toEqual([
			'Now',
			'an-argument, as it stands',
			'Where the argument turned'
		]);
		await pick('Where the argument turned');
		control('Show what changed').click();
		await settle();

		expect(compares).toEqual([
			[{ at: 'a1', label: 'Where the argument turned' }, { label: 'Now' }]
		]);
	});

	it('offers a line standing at a version once, under the name of the line', async () => {
		open({ lines: [...LINES.slice(0, 1), { name: 'an-argument', head: 'a1', here: false }] });

		expect(await states('From')).toEqual(['Now', 'an-argument, as it stands']);
		await pick('an-argument, as it stands');
		control('Show what changed').click();
		await settle();

		expect(compares).toEqual([
			[{ at: 'a1', label: 'an-argument, as it stands' }, { label: 'Now' }]
		]);
	});

	it('names whoever kept a version only where the graph has a name for them', () => {
		open({ versions: [{ ...VERSION, author: undefined }] });

		expect(screen()).toContain('Where the argument turned');
		expect(screen()).not.toContain('Yesterday ·');
	});

	it('offers the version where what changed is in no note', () => {
		open({ changed: [], anythingToKeep: true });

		expect(screen()).toContain('Something changed that is not written in a note');
		expect(control('Keep this version').disabled).toBe(false);
	});

	it('names the pictures that came and went, which stand in no note', () => {
		open({ changed: [], anythingToKeep: true, pictures: { added: 1, removed: 2 } });

		expect(screen()).toContain('A picture arrived');
		expect(screen()).toContain('2 pictures went');
		expect(screen()).not.toContain('Something changed that is not written in a note');
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
