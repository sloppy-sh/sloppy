// @vitest-environment jsdom
import { assignTagHueSlots, type Tag, type TagCount } from '@sloppy/types';
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import { reactive } from '../props.test-support.svelte.js';
import TagRail, { type TagOrder } from './tag-rail.svelte';

const TAGS: TagCount[] = [
	{ tag: 'biology' as Tag, notes: 431 },
	{ tag: 'seed' as Tag, notes: 208 },
	{ tag: 'question' as Tag, notes: 96 }
];

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let asked: Tag[][];

function render(selected: Tag[] = [], tags: TagCount[] = TAGS, stacked = false) {
	const props = reactive({ tags, selected, stacked, onselect: (next: Tag[]) => asked.push(next) });
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
	stubMediaQuery(() => false);
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

// DESIGN.md § Layout: beside the graph the same ordering reads down a column.
describe('the tags down a column', () => {
	const column = (): HTMLElement => chips()[0].parentElement as HTMLElement;

	it('leads with the selection, in its hue, and counts the rest', () => {
		const selection = ['question'] as Tag[];
		render(selection, TAGS, true);
		expect(names()).toEqual(['question', 'biology', 'seed']);
		const slot = assignTagHueSlots(selection).get(selection[0]);
		const dot = named('question').querySelector('span[aria-hidden="true"]') as HTMLElement;
		expect(painted(dot)).toEqual({ 'background-color': `var(--facet-${slot})` });
		expect(named('biology').textContent).toContain('431');
	});

	it('stands the way to find a tag at the head of a crowded column', () => {
		render([], MANY, true);
		expect(searchChip()).toBeUndefined();
		expect(filter()).not.toBeNull();
	});

	it('offers the field at the head of any column, crowded or not', () => {
		render([], TAGS, true);
		expect(searchChip()).toBeUndefined();
		expect(filter()).not.toBeNull();
	});

	it('orders the rest by name when asked, with the selection still first', () => {
		const orders: string[] = [];
		const props = reactive({
			tags: TAGS,
			selected: ['seed'] as Tag[],
			stacked: true,
			order: 'count' as TagOrder,
			onselect: (next: Tag[]) => asked.push(next),
			onorder: (next: string) => orders.push(next)
		});
		mounted = mount(TagRail, { target, props });
		flushSync();
		expect(names()).toEqual(['seed', 'biology', 'question']);

		const by = () =>
			[...target.querySelectorAll('button')].find((one) =>
				one.getAttribute('aria-label')?.startsWith('Order by')
			) as HTMLButtonElement;
		expect(by().getAttribute('aria-label')).toBe('Order by name');
		by().click();
		expect(orders).toEqual(['name']);

		props.order = 'name';
		flushSync();
		expect(names()).toEqual(['seed', 'biology', 'question']);
		expect(by().getAttribute('aria-label')).toBe('Order by how many notes carry each');

		props.tags = [...TAGS, { tag: 'algae' as Tag, notes: 3 }];
		flushSync();
		expect(names()).toEqual(['seed', 'algae', 'biology', 'question']);
	});

	it('scrolls down rather than along', () => {
		render([], MANY, true);
		expect(column().className).toContain('overflow-y-auto');
		expect(column().className).not.toContain('overflow-x-auto');
	});

	it('brings a tapped tag back into view down the column', async () => {
		render([], MANY, true);
		const rail = column();
		const scrolled: number[] = [];
		Object.defineProperty(rail, 'clientHeight', { configurable: true, value: 300 });
		Object.defineProperty(rail, 'scrollTop', { configurable: true, value: 400 });
		rail.getBoundingClientRect = () => ({ top: 0, height: 300 }) as DOMRect;
		rail.scrollTo = ((to: ScrollToOptions) => {
			scrolled.push(to.top ?? 0);
		}) as typeof rail.scrollTo;
		const chip = named('thesis');
		chip.getBoundingClientRect = () => ({ top: 100 - 400, height: 44 }) as DOMRect;
		chip.click();
		await vi.waitFor(() => expect(scrolled).toEqual([0]));
	});
});

// A trackpad and a sideways wheel reach the rail on their own; a plain mouse
// wheel does not, and the rail is the only way to the rest of the tags.
describe('a mouse wheel over the rail', () => {
	const SEEN = 374;

	function scroller(over: number): HTMLElement {
		const rail = chips()[0].parentElement as HTMLElement;
		let left = 0;
		Object.defineProperty(rail, 'clientWidth', { configurable: true, value: SEEN });
		Object.defineProperty(rail, 'scrollWidth', { configurable: true, value: SEEN + over });
		Object.defineProperty(rail, 'scrollLeft', {
			configurable: true,
			get: () => left,
			set: (to: number) => {
				left = to;
			}
		});
		return rail;
	}

	function wheel(rail: HTMLElement, deltaY: number, deltaX = 0): boolean {
		const event = new WheelEvent('wheel', { deltaY, deltaX, cancelable: true, bubbles: true });
		rail.dispatchEvent(event);
		flushSync();
		return event.defaultPrevented;
	}

	const onAMouse = () => stubMediaQuery((query) => query.includes('pointer: fine'));

	it('carries the rail sideways', () => {
		onAMouse();
		render();
		const rail = scroller(600);
		expect(wheel(rail, 120)).toBe(true);
		expect(rail.scrollLeft).toBe(120);
	});

	it('leaves the page to scroll itself under a finger', () => {
		stubMediaQuery(() => false);
		render();
		const rail = scroller(600);
		expect(wheel(rail, 120)).toBe(false);
		expect(rail.scrollLeft).toBe(0);
	});

	it('leaves a wheel that already runs sideways alone', () => {
		onAMouse();
		render();
		const rail = scroller(600);
		expect(wheel(rail, 0, 120)).toBe(false);
	});

	it('hands the page back the wheel at the end of the rail', () => {
		onAMouse();
		render();
		const rail = scroller(600);
		rail.scrollLeft = 600;
		expect(wheel(rail, 120)).toBe(false);
	});

	it('leaves the column to scroll itself', () => {
		onAMouse();
		render([], TAGS, true);
		const rail = scroller(600);
		expect(wheel(rail, 120)).toBe(false);
	});
});
