// @vitest-environment jsdom
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from './dom.test-support.js';
import ReadingPanel, { type ReadingTab } from './reading-panel.svelte';

const body = createRawSnippet(() => ({ render: () => '<p data-testid="body">a thought</p>' }));

const CELLS = 'did:example:one/01CELLS' as ReadingTab['ref'];
const COMPOST = 'did:example:one/01COMPOST' as ReadingTab['ref'];

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function panel(tabs: readonly ReadingTab[]): void {
	stubMediaQuery(() => true);
	mounted = mount(ReadingPanel, {
		target,
		props: { open: true, title: 'Note', tabs, active: tabs[0]?.ref ?? null, children: body }
	});
	flushSync();
}

/** What each tab on the strip says, in the order they were opened. */
const tabsSay = (): string[] =>
	[...document.body.querySelectorAll<HTMLElement>('[aria-label="Open notes"] button')]
		.filter((one) => one.querySelector('.address'))
		.map((one) => (one.textContent ?? '').replace(/\s+/g, ' ').trim());

/** Every control on the strip, as a screen reader names it. */
const labels = (): string[] =>
	[...document.body.querySelectorAll('[aria-label="Open notes"] button')].map(
		(one) => one.getAttribute('aria-label') ?? ''
	);

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

// PRODUCT.md principle 3: an address is read inside one graph, so two tabs at
// the same address are told apart by the graph each is in.
describe('the strip over the reading panel', () => {
	it('says the address and the title, and no more, where no graph is given', () => {
		panel([
			{ ref: CELLS, address: '1a', title: 'Cells' },
			{ ref: COMPOST, address: '2', title: 'Method' }
		]);

		expect(tabsSay()).toEqual(['1a Cells', '2 Method']);
		expect(labels()).toEqual(['', 'Close 1a', '', 'Close 2']);
	});

	it('names the graph beside the address where one is given', () => {
		panel([
			{ ref: CELLS, address: '1', title: 'Origins', graph: 'Biology' },
			{ ref: COMPOST, address: '1', title: 'Compost', graph: 'Garden' }
		]);

		expect(tabsSay()).toEqual(['1 Origins Biology', '1 Compost Garden']);
		expect(labels()).toEqual([
			'1 Origins, in Biology',
			'Close 1 in Biology',
			'1 Compost, in Garden',
			'Close 1 in Garden'
		]);
	});
});
