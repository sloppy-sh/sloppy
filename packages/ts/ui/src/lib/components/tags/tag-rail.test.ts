// @vitest-environment jsdom
import { assignTagHueSlots, type Tag, type TagCount } from '@sloppy/types';
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubResizeObserver } from '../dom.test-support.js';
import { reactive } from '../props.test-support.svelte.js';
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
	const props = reactive({ tags, selected, onselect: (next: Tag[]) => asked.push(next) });
	mounted = mount(TagRail, { target, props });
	flushSync();
	return props;
}

const chips = () => [...target.querySelectorAll('button[aria-pressed]')] as HTMLButtonElement[];

const named = (tag: string) =>
	chips().find((chip) => chip.textContent?.includes(tag)) as HTMLButtonElement;

const railSays = () => target.querySelector('[role="group"]')?.getAttribute('aria-label');

const searchChip = () =>
	[...target.querySelectorAll('button')].find(
		(button) => button.getAttribute('aria-label') === 'Find a tag'
	);

const filter = () => target.querySelector('input') as HTMLInputElement | null;

const names = () => chips().map((chip) => chip.textContent?.trim().split(/\s+/)[0]);

function openSearch(): void {
	(searchChip() as HTMLButtonElement).click();
	flushSync();
}

/** What the rail reads to know a tap landed somewhere other than in it. */
function tapOn(where: EventTarget): void {
	where.dispatchEvent(new Event('pointerdown', { bubbles: true }));
	flushSync();
}

function type(text: string): void {
	if (!filter()) openSearch();
	const field = filter() as HTMLInputElement;
	field.value = text;
	field.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

/** More tags than the rail draws without offering to narrow them, most-used first. */
const MANY: TagCount[] = [
	'biology',
	'seed',
	'question',
	'chemistry',
	'physics',
	'geology',
	'ecology',
	'ethics',
	'method',
	'sources',
	'draft',
	'reading',
	'garden',
	'soil',
	'ink',
	'thesis'
].map((tag, at) => ({ tag: tag as Tag, notes: 100 - at }));

const painted = (element: HTMLElement): Record<string, string> =>
	Object.fromEntries(
		(element.getAttribute('style') ?? '')
			.split(';')
			.filter((rule) => rule.trim() !== '')
			.map((rule) => rule.split(':').map((part) => part.trim()))
	);

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

	// DESIGN.md § "Contrast is measured": the mark family is held to 3:1 as a
	// graphical object, which is not the floor a word at text-sm owes.
	it('spends the hue on the mark and the edge, and leaves the word at foreground', () => {
		const selection = ['question'] as Tag[];
		render(selection);
		const slot = assignTagHueSlots(selection).get(selection[0]);
		const chip = named('question');
		const dot = chip.querySelector('span[aria-hidden="true"]') as HTMLElement;
		expect(painted(chip)).toEqual({ 'border-color': `var(--facet-${slot})` });
		expect(painted(dot)).toEqual({ 'background-color': `var(--facet-${slot})` });
		expect(chip.className.split(/\s+/)).toContain('text-foreground');
	});

	it('gives an unselected tag no hue at all', () => {
		render(['question'] as Tag[]);
		expect(named('seed').getAttribute('style')).toBeNull();
		expect(named('seed').getAttribute('aria-pressed')).toBe('false');
	});

	// The chips say what they are by being read; the word is what is left for
	// somebody who is not reading them, so it rides the rail rather than a row of
	// its own.
	it('tells a reader who cannot see the chips that several means any of them', () => {
		render();
		expect(target.querySelector('h2')).toBeNull();
		expect(railSays()).toBe('Tags');
		unmount(mounted!, { outro: false });
		render(['seed'] as Tag[]);
		expect(railSays()).toBe('Tags');
		unmount(mounted!, { outro: false });
		render(['seed', 'biology'] as Tag[]);
		expect(railSays()).toBe('Notes with any of these');
	});

	it('shows how many notes carry a tag nobody has selected yet', () => {
		render();
		expect(named('biology').textContent).toContain('431');
	});
});

describe('typing for a tag', () => {
	it('offers nowhere to type until the rail holds more than a screen of chips', () => {
		render();
		expect(searchChip()).toBeUndefined();
		unmount(mounted!, { outro: false });
		render([], MANY);
		expect(searchChip()).toBeDefined();
	});

	// The rail is one row, so the field is the chip's own place rather than a
	// second row standing over the chips waiting to be used.
	it('swaps the chip for the field where the chip was, and back on a tap off the rail', () => {
		render([], MANY);
		expect(filter()).toBeNull();
		openSearch();
		expect(filter()).not.toBeNull();
		expect(searchChip()).toBeUndefined();

		tapOn(document.body);
		expect(filter()).toBeNull();
		expect(searchChip()).toBeDefined();
	});

	// The field is several chips wide, so putting it away moves the row along:
	// a tap that lands IN the row has to leave it standing, or the chip travels
	// out from under the finger before it comes up and nothing is tapped at all.
	it('leaves the field standing when the tap is a chip in the same row', () => {
		render([], MANY);
		openSearch();
		tapOn(named('ethics'));
		expect(filter()).not.toBeNull();
		named('ethics').click();
		expect(asked).toEqual([['ethics']]);
	});

	it('keeps the field open while a word is still narrowing the rail', () => {
		render([], MANY);
		type('ology');
		tapOn(document.body);
		expect(filter()?.value).toBe('ology');
		expect(names()).toEqual(['biology', 'geology', 'ecology']);
	});

	it('draws only the tags holding what was typed, still most-used first', () => {
		render([], MANY);
		type('ology');
		expect(names()).toEqual(['biology', 'geology', 'ecology']);
	});

	it('matches whatever case it was typed in, and past the space around it', () => {
		render([], MANY);
		type('  ECOL  ');
		expect(names()).toEqual(['ecology']);
	});

	// DESIGN.md § Hue: the canvas is drawing the selection's colours, so a legend
	// that dropped a selected tag would leave a hue on screen with nothing naming it.
	it('keeps the selection drawn whatever is typed', () => {
		render(['seed', 'question'] as Tag[], MANY);
		type('ology');
		expect(names()).toEqual(['seed', 'question', 'biology', 'geology', 'ecology']);
	});

	// The page over the rail reads Escape to end a multi-select, so a field that
	// let the key past would answer with something the reader did not ask for.
	it('empties the field on Escape, and keeps that key to itself', () => {
		render([], MANY);
		type('ology');

		const away = vi.fn();
		window.addEventListener('keydown', away);
		filter()?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
		);
		flushSync();
		window.removeEventListener('keydown', away);

		expect(filter()?.value).toBe('');
		expect(names()).toEqual(MANY.map((entry) => entry.tag));
		expect(away).not.toHaveBeenCalled();
	});

	it('leaves Escape alone once there is nothing typed to clear', () => {
		render([], MANY);
		openSearch();

		const away = vi.fn();
		window.addEventListener('keydown', away);
		filter()?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
		);
		window.removeEventListener('keydown', away);

		expect(away).toHaveBeenCalledTimes(1);
	});

	it('says when nothing has that in it, and not while something does', () => {
		render([], MANY);
		type('ology');
		expect(target.textContent).not.toContain('No tag has that in it.');
		type('zzz');
		expect(names()).toEqual([]);
		expect(target.textContent).toContain('No tag has that in it.');
	});

	it('does not say nothing has it while the tag holding it is a selected one', () => {
		render(['ecology'] as Tag[], MANY);
		type('ecolo');
		expect(names()).toEqual(['ecology']);
		expect(target.textContent).not.toContain('No tag has that in it.');
	});

	// A filter stands until the reader clears it: the word is still in the field
	// beside the chips, and emptying it out from under them would be the surprise.
	it("holds what was typed when the rail is handed another read's tags", () => {
		const props = render([], MANY);
		type('ology');
		props.tags = MANY.filter((entry) => entry.tag !== 'geology');
		flushSync();
		expect(filter()?.value).toBe('ology');
		expect(names()).toEqual(['biology', 'ecology']);
	});

	it('still selects the tag that was tapped out of a narrowed rail', () => {
		render([], MANY);
		type('ology');
		named('geology').click();
		expect(asked).toEqual([['geology']]);
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
