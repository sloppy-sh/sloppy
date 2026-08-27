import type { LabelDimensionView, LabelSet, NodeView, OwnedRef } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dimension, node, ref, useFakeApi, type FakeApi } from '../stores/fake-api.test-support.js';
import { labels } from '../stores/labels.svelte.js';
import { nodes } from '../stores/nodes.svelte.js';
import { prefs } from '../stores/prefs.svelte.js';
import Labels from './labels.svelte';

const ROOT = ref(1);

/** The path `SloppyClient` builds for one owned record. */
function at(of: OwnedRef): string {
	return `/${of.split('/').map(encodeURIComponent).join('/')}`;
}

/** A root and four notes under it, so an intersection has branches to count. */
function graphOf(labelled: LabelSet[]): NodeView[] {
	return [
		node(1, '1'),
		...labelled.map((set, index) =>
			node(index + 2, `1${'abcd'[index]}`, { origin: ROOT, parent: ROOT, labels: set })
		)
	];
}

let api: FakeApi;
let dimensions: LabelDimensionView[];
let graph: NodeView[];
/** Node writes to let through before the connection stops answering. */
let writesAllowed = Number.POSITIVE_INFINITY;
let deleteAllowed = true;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function body(init: RequestInit | undefined): Record<string, unknown> {
	return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
}

/** A refusal in the API's own words, which is what the page has to pass on. */
function refuse(message: string): Response {
	return new Response(JSON.stringify({ message }), {
		status: 409,
		headers: { 'content-type': 'application/json' }
	});
}

/** The API's own rules, so the page is exercised against what it really faces:
 *  a dimension rename carries its key across every note that holds it, a value
 *  nothing carries any more simply goes, and one that notes still carry, or a
 *  name already taken, is refused. */
function serve(): void {
	api.on('GET /label-dimensions', () => dimensions.map((one) => ({ ...one })));
	api.on('GET /nodes', (url) => {
		const origin = url.searchParams.get('origin');
		return graph
			.filter((one) => (origin ? one.origin === origin : one.ref === one.origin))
			.map((one) => ({ ...one }));
	});
	for (const one of dimensions) {
		api.on(`PATCH /label-dimensions${at(one.ref)}`, (_url, init) => {
			const patch = body(init);
			const held = dimensions.find((other) => other.ref === one.ref)!;
			const renamed = typeof patch.name === 'string' && patch.name !== held.name;
			if (renamed && dimensions.some((other) => other.name === patch.name)) {
				return refuse(`You already have a "${String(patch.name)}" dimension.`);
			}
			if (Array.isArray(patch.values)) {
				const kept = patch.values as string[];
				const carried = graph.filter((carrier) => {
					const value = carrier.labels[held.name];
					return value !== undefined && held.values.includes(value) && !kept.includes(value);
				}).length;
				if (carried > 0) {
					return refuse(
						`${carried} ${carried === 1 ? 'note is' : 'notes are'} still labelled with a value you are removing. Relabel them first.`
					);
				}
			}
			const before = held.name;
			Object.assign(held, patch);
			if (renamed) {
				for (const carrier of graph) {
					if (carrier.labels[before] === undefined) continue;
					const { [before]: value, ...rest } = carrier.labels;
					carrier.labels = { ...rest, [held.name]: value };
				}
			}
			return { ...held };
		});
		api.on(`DELETE /label-dimensions${at(one.ref)}`, () => {
			if (!deleteAllowed) throw new Error('the connection went away');
			dimensions = dimensions.filter((other) => other.ref !== one.ref);
			for (const carrier of graph) {
				carrier.labels = Object.fromEntries(
					Object.entries(carrier.labels).filter(([name]) => name !== one.name)
				);
			}
			return undefined;
		});
	}
	let written = 0;
	for (const one of graph) {
		api.on(`PATCH /nodes${at(one.ref)}`, (_url, init) => {
			if (++written > writesAllowed) throw new Error('the connection went away');
			const patch = body(init);
			const held = graph.find((other) => other.ref === one.ref)!;
			if (patch.labels) held.labels = patch.labels as LabelSet;
			return { ...held };
		});
	}
}

function stubViewport(): void {
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
	});
	Object.defineProperty(globalThis, 'ResizeObserver', {
		configurable: true,
		writable: true,
		value: class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	});
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 6; turn += 1) await new Promise((done) => setTimeout(done, 0));
	flushSync();
}

async function openPage(): Promise<void> {
	serve();
	stubViewport();
	mounted = mount(Labels, { target });
	flushSync();
	await settle();
}

function button(labelled: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find(
		(one) => one.textContent?.trim() === labelled || one.getAttribute('aria-label') === labelled
	);
	if (!found) throw new Error(`No "${labelled}" button on screen`);
	return found;
}

function facet(named: string): HTMLFieldSetElement {
	const found = [...document.body.querySelectorAll('fieldset')].find(
		(one) => one.querySelector('legend')?.textContent?.trim() === named
	);
	if (!found) throw new Error(`No "${named}" facet on screen`);
	return found as HTMLFieldSetElement;
}

function chip(dimensionName: string, labelled: string): HTMLInputElement {
	const found = [...facet(dimensionName).querySelectorAll('label')].find(
		(one) => one.textContent?.trim() === labelled
	);
	const input = found?.querySelector('input');
	if (!input) throw new Error(`No "${labelled}" chip under ${dimensionName}`);
	return input;
}

function type(input: HTMLInputElement, text: string): void {
	input.value = text;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

const rows = () =>
	[...document.body.querySelectorAll('input[aria-label^="Value"]')] as HTMLInputElement[];

const dialog = () => document.body.querySelector('[role="dialog"]');

const labelsOn = (dimensionName: string) =>
	graph.filter((one) => one.parent).map((one) => one.labels[dimensionName] ?? null);

beforeEach(() => {
	labels.clear();
	nodes.clear();
	prefs.set('lens', null);
	writesAllowed = Number.POSITIVE_INFINITY;
	deleteAllowed = true;
	api = useFakeApi();
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
});

describe('renaming the values of a dimension', () => {
	beforeEach(() => {
		dimensions = [dimension(10, 'swaptest', { values: ['red', 'blue'] })];
		graph = graphOf([
			{ swaptest: 'red' },
			{ swaptest: 'red' },
			{ swaptest: 'blue' },
			{ swaptest: 'blue' }
		]);
	});

	it('trades two values for each other without sweeping the same notes twice', async () => {
		await openPage();
		button('Edit swaptest').click();
		flushSync();
		type(rows()[0], 'blue');
		type(rows()[1], 'red');
		button('Save').click();
		await settle();

		expect(labelsOn('swaptest')).toEqual(['blue', 'blue', 'red', 'red']);
		expect(dimensions[0].values).toEqual(['blue', 'red']);
	});

	it('carries a chain of renames past each other', async () => {
		dimensions = [dimension(10, 'swaptest', { values: ['red', 'blue'] })];
		graph = graphOf([
			{ swaptest: 'red' },
			{ swaptest: 'blue' },
			{ swaptest: 'blue' },
			{ swaptest: 'blue' }
		]);
		await openPage();
		button('Edit swaptest').click();
		flushSync();
		type(rows()[0], 'blue');
		type(rows()[1], 'green');
		button('Save').click();
		await settle();

		expect(labelsOn('swaptest')).toEqual(['blue', 'green', 'green', 'green']);
	});

	it('says what happened when the notes stop being written part-way', async () => {
		writesAllowed = 1;
		await openPage();
		button('Edit swaptest').click();
		flushSync();
		type(rows()[0], 'crimson');
		button('Save').click();
		await settle();

		expect(dialog()?.textContent).toContain('Some notes were relabelled before that stopped');
		expect(button('Save')).toBeDefined();
	});
});

describe('the intersection a rename leaves behind', () => {
	beforeEach(() => {
		dimensions = [dimension(10, 'confidence', { values: ['hunch', 'working', 'settled'] })];
		graph = graphOf([
			{ confidence: 'hunch' },
			{ confidence: 'hunch' },
			{ confidence: 'working' },
			{ confidence: 'settled' }
		]);
	});

	it('keeps the notes it was already showing when the value is renamed', async () => {
		await openPage();
		chip('confidence', 'hunch').click();
		flushSync();
		expect(document.body.textContent).toContain('2 notes across 1 branch');

		button('Edit confidence').click();
		flushSync();
		type(rows()[0], 'inkling');
		button('Save').click();
		await settle();

		expect(chip('confidence', 'inkling').checked).toBe(true);
		expect(document.body.textContent).toContain('2 notes across 1 branch');
	});

	it('keeps the notes it was already showing when the dimension is renamed', async () => {
		await openPage();
		chip('confidence', 'working').click();
		flushSync();
		expect(document.body.textContent).toContain('1 note across 1 branch');

		button('Edit confidence').click();
		flushSync();
		type(document.body.querySelector('input[placeholder="domain"]')!, 'certainty');
		button('Save').click();
		await settle();

		expect(chip('certainty', 'working').checked).toBe(true);
		expect(document.body.textContent).toContain('1 note across 1 branch');
	});

	it('asks nothing of a value that has been dropped', async () => {
		graph = graphOf([
			{ confidence: 'hunch' },
			{ confidence: 'hunch' },
			{ confidence: 'working' },
			{}
		]);
		await openPage();
		chip('confidence', 'settled').click();
		flushSync();
		expect(document.body.textContent).toContain('No note carries all of those');
		expect(document.body.textContent).not.toContain('0 notes');

		button('Edit confidence').click();
		flushSync();
		button('Remove settled').click();
		flushSync();
		button('Save').click();
		await settle();

		expect(chip('confidence', 'Any').checked).toBe(true);
	});
});

describe('a save the API refuses once the rename has landed', () => {
	beforeEach(() => {
		dimensions = [dimension(10, 'confidence', { values: ['hunch', 'working', 'settled'] })];
		graph = graphOf([
			{ confidence: 'hunch' },
			{ confidence: 'hunch' },
			{ confidence: 'working' },
			{ confidence: 'settled' }
		]);
	});

	it('says why the removal was refused, and keeps the rename it did make', async () => {
		await openPage();
		button('Edit confidence').click();
		flushSync();
		type(rows()[0], 'guess');
		button('Remove settled').click();
		flushSync();
		button('Save').click();
		await settle();

		expect(dialog()?.textContent).toContain(
			'1 note is still labelled with a value you are removing'
		);
		expect(dialog()?.textContent).not.toContain('Save again to finish the rest');
		expect(labelsOn('confidence')).toEqual(['guess', 'guess', 'working', 'settled']);
		expect(dimensions[0].values).toEqual(['guess', 'working', 'settled']);
	});

	it('says why the name was refused, and keeps the rename it did make', async () => {
		dimensions = [
			dimension(10, 'confidence', { values: ['hunch', 'working', 'settled'] }),
			dimension(11, 'topic', { values: ['ink'] })
		];
		await openPage();
		button('Edit confidence').click();
		flushSync();
		type(rows()[0], 'guess');
		type(document.body.querySelector('input[placeholder="domain"]')!, 'topic');
		button('Save').click();
		await settle();

		expect(dialog()?.textContent).toContain('You already have a "topic" dimension');
		expect(labelsOn('confidence')).toEqual(['guess', 'guess', 'working', 'settled']);
		expect(dimensions[0].name).toBe('confidence');
		expect(dimensions[0].values).toEqual(['guess', 'working', 'settled']);
	});
});

describe('collapsing two values onto one', () => {
	beforeEach(() => {
		dimensions = [dimension(10, 'confidence', { values: ['hunch', 'working', 'settled'] })];
		graph = graphOf([
			{ confidence: 'working' },
			{ confidence: 'working' },
			{ confidence: 'settled' },
			{ confidence: 'hunch' }
		]);
	});

	it('asks first, and relabels nothing until it is answered', async () => {
		await openPage();
		button('Edit confidence').click();
		flushSync();
		type(rows()[1], 'settled');
		button('Save').click();
		await settle();

		expect(dialog()?.textContent).toContain('2 notes labelled working become settled.');
		expect(labelsOn('confidence')).toEqual(['working', 'working', 'settled', 'hunch']);
	});

	it('relabels once the answer is yes', async () => {
		await openPage();
		button('Edit confidence').click();
		flushSync();
		type(rows()[1], 'settled');
		button('Save').click();
		await settle();
		button('Merge and save').click();
		await settle();

		expect(labelsOn('confidence')).toEqual(['settled', 'settled', 'settled', 'hunch']);
		expect(dimensions[0].values).toEqual(['hunch', 'settled']);
	});
});

describe('a dimension with no values yet', () => {
	beforeEach(() => {
		dimensions = [dimension(10, 'empty', { values: [] })];
		graph = graphOf([{}, {}, {}, {}]);
	});

	it('asks nothing and offers to colour nothing', async () => {
		await openPage();

		expect(document.body.textContent).toContain('No values yet, so nothing can be sorted along it');
		expect(document.body.textContent).not.toContain('Find notes');
		expect(document.body.textContent).not.toContain('Colour the graph by this');
	});

	it('can still be turned off while it is the lens', async () => {
		prefs.set('lens', 'empty');
		await openPage();

		button('Colouring the graph').click();
		flushSync();
		expect(prefs.current.lens).toBe(null);
	});
});

describe('deleting a dimension', () => {
	beforeEach(() => {
		dimensions = [dimension(10, 'doomed', { values: ['yes'] })];
		graph = graphOf([{}, {}, {}, {}]);
	});

	it('says why it did not go, where the question was asked', async () => {
		deleteAllowed = false;
		await openPage();
		button('Delete doomed').click();
		flushSync();
		button('Delete').click();
		await settle();

		expect(dialog()?.textContent).toContain('Sloppy could not remove that dimension');
	});
});
