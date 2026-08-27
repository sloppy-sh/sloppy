// @vitest-environment jsdom
import type { LabelDimensionView } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import type { DimensionDraft } from './contract.js';
import DimensionEditor from './dimension-editor.svelte';

const DID = 'did:syr:z6MktestKeyForTheFacetSuite';

const STATUS = {
	ref: `${DID}/01J0000000000000000000000A`,
	created_by: DID,
	created_at: '2026-01-01T00:00:00.000Z',
	updated_at: '2026-01-01T00:00:00.000Z',
	name: 'status',
	values: ['seed', 'growing']
} as LabelDimensionView;

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let drafts: DimensionDraft[];

function open(props: Record<string, unknown> = {}) {
	drafts = [];
	stubMediaQuery(() => false);
	mounted = mount(DimensionEditor, {
		target,
		props: {
			open: true,
			carrying: new Map<string, number>(),
			onsave: (draft: DimensionDraft) => {
				drafts.push({ ...draft, values: draft.values.map((value) => ({ ...value })) });
				return Promise.resolve();
			},
			...props
		}
	});
	flushSync();
}

const field = (selector: string) =>
	document.body.querySelector(selector) as HTMLInputElement | null;

const values = () =>
	[...document.body.querySelectorAll('input[aria-label^="Value"]')] as HTMLInputElement[];

const button = (label: string) =>
	[...document.body.querySelectorAll('button')].find(
		(one) => one.textContent?.trim() === label || one.getAttribute('aria-label') === label
	);

function type(input: HTMLInputElement, text: string) {
	input.value = text;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

async function settle() {
	await new Promise((done) => setTimeout(done, 0));
	flushSync();
}

beforeEach(() => {
	stubResizeObserver();
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
});

describe('declaring and editing a dimension', () => {
	it('opens on what the dimension already says', () => {
		open({ dimension: STATUS });
		expect(field('input[placeholder="domain"]')?.value).toBe('status');
		expect(values().map((one) => one.value)).toEqual(['seed', 'growing']);
	});

	it('will not save a dimension with no name', () => {
		open();
		expect(button('Add dimension')?.disabled).toBe(true);
		type(field('input[placeholder="domain"]')!, 'domain');
		expect(button('Add dimension')?.disabled).toBe(false);
	});

	it('hands back an added value as an addition', async () => {
		open({ dimension: STATUS });
		button('Add a value')?.click();
		flushSync();
		type(values()[2], 'settled');
		button('Save')?.click();
		await settle();
		expect(drafts[0].values).toEqual([
			{ was: 'seed', now: 'seed' },
			{ was: 'growing', now: 'growing' },
			{ now: 'settled' }
		]);
	});

	it('hands back an edited value as a rename of the value it was', async () => {
		open({ dimension: STATUS });
		type(values()[0], 'sprout');
		button('Save')?.click();
		await settle();
		expect(drafts[0].values[0]).toEqual({ was: 'seed', now: 'sprout' });
	});

	it('hands back a removed value by leaving it out', async () => {
		open({ dimension: STATUS });
		button('Remove growing')?.click();
		flushSync();
		expect(values().map((one) => one.value)).toEqual(['seed']);
	});

	it('stays up when the save is refused, and says why', async () => {
		open({
			dimension: STATUS,
			refused: '3 notes are still labelled with a value you are removing.',
			onsave: () => Promise.reject(new Error('nope'))
		});
		button('Save')?.click();
		await settle();
		expect(document.body.textContent).toContain('3 notes are still labelled');
		expect(button('Save')?.disabled).toBe(false);
	});

	it('offers to choose the hue for a dimension that has not pinned one', () => {
		open({ dimension: STATUS });
		expect(document.body.textContent).toContain('Pick for me');
	});

	it('does not offer a way back once a hue is pinned', () => {
		open({ dimension: { ...STATUS, color_slot: 3 } });
		expect(document.body.textContent).not.toContain('Pick for me');
	});
});

describe('a draft that would put two values under one name', () => {
	const carrying = new Map([
		['seed', 12],
		['growing', 1]
	]);

	it('asks before it relabels, and says how many notes move', () => {
		open({ dimension: STATUS, carrying });
		type(values()[0], 'growing');
		button('Save')?.click();
		flushSync();
		expect(drafts).toEqual([]);
		expect(document.body.textContent).toContain('Merge into growing?');
		expect(document.body.textContent).toContain('12 notes labelled seed become growing.');
	});

	it('counts one note as one note', () => {
		open({ dimension: STATUS, carrying });
		type(values()[1], 'seed');
		button('Save')?.click();
		flushSync();
		expect(document.body.textContent).toContain('1 note labelled growing becomes seed.');
	});

	it('goes back to the values without touching a note', () => {
		open({ dimension: STATUS, carrying });
		type(values()[0], 'growing');
		button('Save')?.click();
		flushSync();
		button('Back')?.click();
		flushSync();
		expect(drafts).toEqual([]);
		expect(values().map((one) => one.value)).toEqual(['growing', 'growing']);
	});

	it('saves the draft once the merge is answered', async () => {
		open({ dimension: STATUS, carrying });
		type(values()[0], 'growing');
		button('Save')?.click();
		flushSync();
		button('Merge and save')?.click();
		await settle();
		expect(drafts[0].values).toEqual([
			{ was: 'seed', now: 'growing' },
			{ was: 'growing', now: 'growing' }
		]);
	});

	it('says why a merge would not save, where the question was asked', async () => {
		open({
			dimension: STATUS,
			carrying,
			refused: 'Sloppy could not save that dimension. Try again in a moment.',
			onsave: () => Promise.reject(new Error('nope'))
		});
		type(values()[0], 'growing');
		button('Save')?.click();
		flushSync();
		button('Merge and save')?.click();
		await settle();
		expect(document.body.textContent).toContain('Sloppy could not save that dimension');
		expect(button('Merge and save')).toBeDefined();
	});

	it('does not ask where the values it collapses are on no notes', async () => {
		open({ dimension: STATUS, carrying: new Map() });
		type(values()[0], 'growing');
		button('Save')?.click();
		await settle();
		expect(drafts).toHaveLength(1);
	});

	it('does not ask a dimension being declared for the first time', async () => {
		open();
		type(field('input[placeholder="domain"]')!, 'status');
		button('Add a value')?.click();
		flushSync();
		type(values()[0], 'seed');
		button('Add a value')?.click();
		flushSync();
		type(values()[1], 'seed');
		button('Add dimension')?.click();
		await settle();
		expect(drafts).toHaveLength(1);
	});
});
