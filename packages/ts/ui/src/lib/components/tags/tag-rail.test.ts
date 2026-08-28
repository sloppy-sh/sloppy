// @vitest-environment jsdom
import { assignTagHueSlots, type Tag, type TagCount } from '@sloppy/types';
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('keeping the tapped tag on screen', () => {
	// Selecting sends a chip to the head of the rail, which on a graph with more
	// tags than fit is somewhere the reader has NOT scrolled to. jsdom has no
	// layout, so these are the numbers a 390px phone measures: a 374px rail, and
	// each chip placed by where in the rail's content it lands once re-ordered.
	const RAIL = 374;
	const CHIP = 100;

	function watch(at: number): number[] {
		const rail = chips()[0].parentElement as HTMLElement;
		const scrolled: number[] = [];
		Object.defineProperty(rail, 'clientWidth', { configurable: true, value: RAIL });
		Object.defineProperty(rail, 'scrollLeft', { configurable: true, value: at });
		rail.getBoundingClientRect = () => ({ left: 0, width: RAIL }) as DOMRect;
		rail.scrollTo = ((to: ScrollToOptions) => {
			scrolled.push(to.left ?? 0);
		}) as typeof rail.scrollTo;
		return scrolled;
	}

	function lands(chip: HTMLElement, start: number, at: number): void {
		chip.getBoundingClientRect = () => ({ left: start - at, width: CHIP }) as DOMRect;
	}

	it('reads the legend from the start of the rail wherever it fits there', async () => {
		render(['seed'] as Tag[]);
		const scrolled = watch(2264);
		const chip = named('question');
		lands(chip, 164, 2264);
		chip.click();
		await vi.waitFor(() => expect(scrolled).toEqual([0]));
	});

	it('brings one whose legend is too long to read whole just into view', async () => {
		render();
		const scrolled = watch(900);
		const chip = named('question');
		lands(chip, 1800, 900);
		chip.click();
		await vi.waitFor(() => expect(scrolled).toEqual([1800 + CHIP - RAIL]));
	});

	it('leaves the rail where it is when the tag is already whole on screen', async () => {
		render();
		const scrolled = watch(900);
		const chip = named('question');
		lands(chip, 940, 900);
		chip.click();
		await tick();
		expect(scrolled).toEqual([]);
	});

	// Taking a tag off sends its chip back among the unselected, which is not
	// where the reader is looking — the rest of the selection is.
	it('leaves the rail where it is when the tap took a tag off', async () => {
		render(['question'] as Tag[]);
		const scrolled = watch(900);
		const chip = named('question');
		lands(chip, 1800, 900);
		chip.click();
		await tick();
		expect(scrolled).toEqual([]);
	});
});
