// @vitest-environment jsdom
import type { LabelDimensionView, LabelSet } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import LabelPicker from './label-picker.svelte';

const DID = 'did:syr:z6MktestKeyForTheFacetSuite';

function dimension(name: string, values: string[], at: string): LabelDimensionView {
	return {
		ref: `${DID}/01J0000000000000000000000${at}`,
		created_by: DID,
		created_at: '2026-01-01T00:00:00.000Z',
		updated_at: '2026-01-01T00:00:00.000Z',
		name,
		values
	} as LabelDimensionView;
}

const STATUS = dimension('status', ['seed', 'growing'], 'A');
const KIND = dimension('kind', ['question', 'claim'], 'B');

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let asked: LabelSet[];

function show(props: Record<string, unknown> = {}) {
	asked = [];
	mounted = mount(LabelPicker, {
		target,
		props: {
			dimensions: [STATUS, KIND],
			labels: {},
			slotFor: () => 1,
			onassign: (labels: LabelSet) => {
				asked.push(labels);
				return Promise.resolve();
			},
			...props
		}
	});
	flushSync();
}

function chip(dimension: string, text: string): HTMLInputElement {
	const group = [...target.querySelectorAll('fieldset')].find(
		(field) => field.querySelector('legend')?.textContent === dimension
	);
	if (!group) throw new Error(`no chips for ${dimension}`);
	const label = [...group.querySelectorAll('label')].find(
		(one) => one.textContent?.trim() === text
	);
	if (!label) throw new Error(`no "${text}" chip in ${dimension}`);
	return label.querySelector('input') as HTMLInputElement;
}

/** The assignment runs in a promise; let its continuation and the render after
 *  it both land before reading the surface. */
async function settle() {
	await new Promise((done) => setTimeout(done, 0));
	flushSync();
}

beforeEach(() => {
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
});

describe('putting a note into a facet', () => {
	it('shows a row per dimension, on the value the note carries', () => {
		show({ labels: { status: 'growing' } });
		expect(chip('status', 'growing').checked).toBe(true);
		expect(chip('status', 'None').checked).toBe(false);
		expect(chip('kind', 'None').checked).toBe(true);
	});

	it('stores the whole set, so a note keeps the dimensions it was already in', async () => {
		show({ labels: { status: 'seed' } });
		chip('kind', 'claim').click();
		await settle();
		expect(asked).toEqual([{ status: 'seed', kind: 'claim' }]);
	});

	it('replaces rather than adds, because a note holds one value per dimension', async () => {
		show({ labels: { status: 'seed' } });
		chip('status', 'growing').click();
		await settle();
		expect(asked).toEqual([{ status: 'growing' }]);
	});

	it('takes the note out of a dimension entirely', async () => {
		show({ labels: { status: 'seed', kind: 'claim' } });
		chip('status', 'None').click();
		await settle();
		expect(asked).toEqual([{ kind: 'claim' }]);
	});

	it('puts the chips back on what the note still carries when the save is refused', async () => {
		show({
			labels: { status: 'seed' },
			refused: 'There is no "kind" dimension. Add it before labelling with it.',
			onassign: () => Promise.reject(new Error('nope'))
		});
		chip('kind', 'claim').click();
		await settle();
		expect(chip('status', 'seed').checked).toBe(true);
		expect(chip('kind', 'None').checked).toBe(true);
		expect(target.textContent).toContain('Add it before labelling with it.');
	});

	it('says what to do next when the save is refused without words', async () => {
		show({ onassign: () => Promise.reject(new Error('nope')) });
		chip('status', 'seed').click();
		await settle();
		expect(target.textContent).toContain('Try again in a moment.');
	});

	it('invites a reader with nothing declared to declare something', () => {
		show({ dimensions: [], manageHref: '/labels' });
		expect(target.querySelector('a')?.getAttribute('href')).toBe('/labels');
	});

	it('draws nothing at all where there is nowhere to send them', () => {
		show({ dimensions: [] });
		expect(target.textContent?.trim()).toBe('');
	});
});
