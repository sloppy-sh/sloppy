// @vitest-environment jsdom
import { assignTagHueSlots, type Tag, type TagCount } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubResizeObserver } from '../dom.test-support.js';
import TagRail from './tag-rail.svelte';

const TAGS: TagCount[] = [
	{ tag: 'biology' as Tag, notes: 431 },
	{ tag: 'seed' as Tag, notes: 208 },
	{ tag: 'question' as Tag, notes: 96 }
];

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let asked: Tag[][];

function render(selected: Tag[] = [], tags: TagCount[] = TAGS) {
	mounted = mount(TagRail, {
		target,
		props: { tags, selected, onselect: (next: Tag[]) => asked.push(next) }
	});
	flushSync();
}

const chips = () => [...target.querySelectorAll('button[aria-pressed]')] as HTMLButtonElement[];

const named = (tag: string) =>
	chips().find((chip) => chip.textContent?.includes(tag)) as HTMLButtonElement;

const heading = () => target.querySelector('h2')?.textContent?.trim();

beforeEach(() => {
	asked = [];
	stubResizeObserver();
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
});

describe('choosing tags', () => {
	it('adds the one that was tapped, at the end of the selection', () => {
		render(['seed'] as Tag[]);
		named('biology').click();
		expect(asked).toEqual([['seed', 'biology']]);
	});

	it('takes a selected one back off', () => {
		render(['seed', 'biology'] as Tag[]);
		named('seed').click();
		expect(asked).toEqual([['biology']]);
	});

	it('clears the whole selection in one move, and offers that only when there is one', () => {
		render();
		expect(target.textContent).not.toContain('Clear');
		unmount(mounted!, { outro: false });
		render(['seed'] as Tag[]);
		(
			[...target.querySelectorAll('button')].find(
				(button) => button.textContent?.trim() === 'Clear'
			) as HTMLButtonElement
		).click();
		expect(asked).toEqual([[]]);
	});
});

describe('the legend', () => {
	// DESIGN.md § Hue: "Selection order assigns the slot, and the tag rail shows
	// that order, so the legend and the canvas cannot disagree about which colour
	// answers which question."
	it('leads with the selection, in the order it was made', () => {
		render(['question', 'biology'] as Tag[]);
		expect(chips().map((chip) => chip.textContent?.trim().split(/\s+/)[0])).toEqual([
			'question',
			'biology',
			'seed'
		]);
	});

	it('draws each selected tag in the slot the shared rule gave it', () => {
		const selection = ['question', 'biology'] as Tag[];
		render(selection);
		const slots = assignTagHueSlots(selection);
		for (const tag of selection) {
			expect(named(tag).getAttribute('style')).toContain(`var(--facet-${slots.get(tag)})`);
		}
	});

	it('gives an unselected tag no hue at all', () => {
		render(['question'] as Tag[]);
		expect(named('seed').getAttribute('style')).toBeNull();
		expect(named('seed').getAttribute('aria-pressed')).toBe('false');
	});

	// The word only earns its place once several tags can be selected at once.
	it('says that several selected tags means any of them, and not before', () => {
		render();
		expect(heading()).toBe('Tags');
		unmount(mounted!, { outro: false });
		render(['seed'] as Tag[]);
		expect(heading()).toBe('Tags');
		unmount(mounted!, { outro: false });
		render(['seed', 'biology'] as Tag[]);
		expect(heading()).toBe('Notes with any of these');
	});

	it('shows how many notes carry a tag nobody has selected yet', () => {
		render();
		expect(named('biology').textContent).toContain('431');
	});
});
