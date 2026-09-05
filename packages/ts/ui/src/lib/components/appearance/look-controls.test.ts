// @vitest-environment jsdom
import { LOOK_RING_AT, LOOK_RING_WIDTH, MARK_PICTURE_PX } from '@sloppy/graph';
import {
	MARK_RADIUS_SCALE,
	MARK_SCALE_MAX,
	MARK_SCALE_MIN,
	PICTURE_TURN_MAX,
	PREVIEW_COVER_MAX,
	PREVIEW_COVER_MIN,
	type MediaAsset,
	type NodeAppearance
} from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeldPicture, NoteMedia } from '../editor/contract.js';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import { NOTE_PX } from '../editor/fit.js';
import LookControls from './look-controls.svelte';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let saved: (NodeAppearance | null)[];
let refuse: string | null;
let sent: File[];
let held: HeldPicture[];

const UPLOAD = 'did:syr:ham/01UP';

/** The row a picture's share of the mark is dragged along. */
const COVER = 'How much it covers';

/** What the client actually throws when a save is refused — a status, a route
 *  and a record id, none of which may reach a person. */
const RAW = 'Sloppy API 400 Bad Request for /nodes/did:syr:ham/01JABCXYZ: nope';

// webp, because that is what a note's pictures ARE: `capped` encodes to it, so
// every picture big enough for the note path to have shrunk comes back as one.
const picture = (id: string): HeldPicture => ({
	upload_id: id,
	filename: 'kite.webp',
	mime_type: 'image/webp',
	size: 9
});

const media: NoteMedia = {
	send(file) {
		sent.push(file);
		const asset: MediaAsset = {
			upload_id: `sent-${sent.length}`,
			mime_type: file.type,
			size: file.size
		};
		return { asset: Promise.resolve(asset), cancel: () => {} };
	},
	picture: async (uploadId) => ({ src: `blob:${uploadId}`, release: () => {} }),
	library: async () => held
};

function open(appearance: NodeAppearance | null = null) {
	if (mounted) unmount(mounted, { outro: false });
	document.body.innerHTML = '';
	target = document.createElement('div');
	document.body.appendChild(target);
	mounted = mount(LookControls, {
		target,
		props: {
			appearance,
			media,
			refused: refuse,
			onchange: (next: NodeAppearance | null) => {
				saved.push(next);
				if (refuse) throw new Error(RAW);
			}
		}
	});
	flushSync();
}

const buttons = (within: ParentNode = document.body): HTMLButtonElement[] => [
	...within.querySelectorAll('button')
];

/** "Medium" is a ring and a size both, so a choice is named by its group the way
 *  the legend names it for a reader. */
function group(legend: string): HTMLFieldSetElement {
	const found = [...document.body.querySelectorAll('fieldset')].find(
		(set) => set.querySelector('legend')?.textContent?.trim() === legend
	);
	if (!found) throw new Error(`no group named ${legend}`);
	return found;
}

const named = (label: string, within?: ParentNode): HTMLButtonElement => {
	const found = buttons(within).find((button) => button.textContent?.trim() === label);
	if (!found) throw new Error(`no control named ${label}`);
	return found;
};

async function tap(label: string, within?: ParentNode): Promise<void> {
	named(label, within).click();
	await settle();
}

/** The thumb under a legend, which is what carries the value and the range. */
function thumb(legend: string): HTMLElement {
	const found = group(legend).querySelector<HTMLElement>('[role="slider"]');
	if (!found) throw new Error(`no slider named ${legend}`);
	return found;
}

const at = (legend: string): number => Number(thumb(legend).getAttribute('aria-valuenow'));

/** Dragged with a keyboard, which is the one way jsdom can hold a thumb:
 *  `Home` and `End` are the ends of the range, the arrows are one step. */
async function drag(legend: string, key: string): Promise<void> {
	thumb(legend).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
	await settle();
}

/** A picture is taken off where it is shown, by its turn in the series. */
async function takeOff(turn: number): Promise<void> {
	const tile = document.body.querySelector<HTMLButtonElement>(
		`button[aria-label="Take picture ${turn} off"]`
	);
	if (!tile) throw new Error(`no picture is showing at turn ${turn}`);
	tile.click();
	await settle();
}

async function settle(): Promise<void> {
	await new Promise((done) => setTimeout(done, 0));
	flushSync();
}

/** Through the picker, the way somebody would: the modal offers a picture, the
 *  picker hands one back. */
async function choose(file: File): Promise<void> {
	await tap('Add a picture');
	const chooser = document.body.querySelector('input[type="file"]') as HTMLInputElement;
	Object.defineProperty(chooser, 'files', { configurable: true, value: [file] });
	chooser.dispatchEvent(new Event('change', { bubbles: true }));
	await settle();
}

beforeEach(() => {
	saved = [];
	sent = [];
	held = [];
	refuse = null;
	stubMediaQuery(() => true);
	stubResizeObserver();
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('giving a note a look', () => {
	// DESIGN.md § "A note's look never uses colour": the hue on the canvas is the
	// reader's question, and a build that grows a colour picker has grown a bug.
	it('offers shape and a picture, and no colour at all', () => {
		open();
		const words = document.body.textContent ?? '';
		for (const colour of ['Colour', 'Color', 'Hue', 'Tint']) {
			expect(words).not.toContain(colour);
		}
		expect(document.body.querySelector('input[type="color"]')).toBeNull();
	});

	it('saves the whole look, not the one channel that changed', async () => {
		open({ mark_radius: 'large' });
		await tap('Heavy', group('Ring'));
		expect(saved).toEqual([{ mark_radius: 'large', ring_weight: 'heavy' }]);
	});

	// `appearance.ts`: there is no reason to store a look whose every channel
	// says what a plain note already draws.
	it('stores nothing for a choice a plain note already draws', async () => {
		open({ mark_scale: 1.01 });
		await drag('Size', 'ArrowLeft');
		expect(saved).toEqual([null]);
	});

	// A style says nothing with no ring to break, so the control that would
	// have been dead offers a ring instead of a greyed-out row.
	it('gives the note a ring where a style is chosen without one', async () => {
		open();
		expect(named('Dashed').matches(':disabled')).toBe(false);
		await tap('Dashed', group('Ring style'));
		expect(saved).toEqual([{ ring_weight: 'regular', ring_style: 'dashed' }]);
	});

	it('holds no style while there is no ring to break', () => {
		open();
		for (const style of ['Solid', 'Open', 'Notched', 'Dashed']) {
			expect(named(style, group('Ring style')).getAttribute('aria-pressed'), style).toBe('false');
		}
		open({ ring_weight: 'hairline' });
		expect(named('Solid', group('Ring style')).getAttribute('aria-pressed')).toBe('true');
	});

	// A ring style says nothing with no ring, and a size that says what a plain
	// note draws is not a look either — so what is stored draws what is shown.
	it('stores nothing for a channel that draws what a plain note does', async () => {
		open({ ring_weight: 'none', ring_style: 'dashed' });
		await drag('Size', 'End');
		expect(saved).toEqual([{ mark_scale: MARK_SCALE_MAX }]);

		open({ ring_weight: 'heavy', ring_style: 'dashed' });
		await tap('Solid', group('Ring style'));
		expect(saved.at(-1)).toEqual({ ring_weight: 'heavy' });
	});

	it('takes the whole look back off', async () => {
		open({ ring_weight: 'heavy', preview: UPLOAD });
		await tap('Leave it plain');
		expect(saved).toEqual([null]);
	});

	it('offers nothing to take off a note that has no look', () => {
		open();
		expect(buttons().some((button) => button.textContent?.trim() === 'Leave it plain')).toBe(false);
	});

	// A look that never saved must not sit there looking saved, and what the
	// reader is told is what to do next — never the route the client named.
	it('puts the choices back when a look will not save, and says so', async () => {
		refuse = 'Sloppy could not save that look. Try again in a moment.';
		open({ mark_radius: 'large' });
		await tap('Heavy');
		expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(refuse);
		expect(named('Heavy').getAttribute('aria-pressed')).toBe('false');
		expect(at('Size')).toBe(MARK_RADIUS_SCALE.large);
	});

	// A style says nothing with no ring, and a stored look that draws nothing
	// leaves the note reading as styled.
	it('takes the ring style off with the ring', async () => {
		open({ ring_weight: 'heavy', ring_style: 'dashed' });
		await tap('None', group('Ring'));
		expect(saved).toEqual([null]);
	});
});

describe('a picture for the mark', () => {
	/** A picture of these dimensions, and a canvas that reports the SHORT side of
	 *  what it was redrawn onto — the one a crop to a disc has to fill. The
	 *  default is what a camera hands over. */
	function fromACamera(width = 4032, height = 3024): { drawnAt: number[] } {
		const drawnAt: number[] = [];
		vi.stubGlobal('createImageBitmap', async () => ({
			width,
			height,
			close: () => {}
		}));
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
			drawImage: () => {}
		} as unknown as CanvasRenderingContext2D);
		vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
			this: HTMLCanvasElement,
			done
		) {
			drawnAt.push(Math.min(this.width, this.height));
			done(new Blob([new Uint8Array(20_000)], { type: 'image/webp' }));
		});
		return { drawnAt };
	}

	// A mark is tens of pixels wide, so a camera's answer is orders of magnitude
	// more than one ever shows.
	it('is cut to the size a mark draws it at before it is sent', async () => {
		const { drawnAt } = fromACamera();
		open();
		await choose(new File([new Uint8Array(4_200_000)], 'IMG_0042.jpeg', { type: 'image/jpeg' }));

		expect(drawnAt).toEqual([MARK_PICTURE_PX]);
		expect(sent.map((file) => file.size)).toEqual([20_000]);
		expect(saved).toEqual([{ preview: 'sent-1' }]);
	});

	it('is cut smaller for a mark than for the note it was written in', () => {
		expect(MARK_PICTURE_PX).toBeLessThan(NOTE_PX);
	});

	/** What `media.picture` hands back is a URL the bytes are read from. */
	function readable(): void {
		vi.stubGlobal('fetch', async () => ({
			blob: async () => new Blob([new Uint8Array(900_000)], { type: 'image/webp' })
		}));
	}

	async function chooseHeld(): Promise<void> {
		held = [picture(UPLOAD)];
		open();
		await tap('Add a picture');
		(document.body.querySelector('button[aria-label="kite.webp"]') as HTMLButtonElement).click();
		await settle();
	}

	it('re-uses one already small enough rather than sending it again', async () => {
		const { drawnAt } = fromACamera(200, 150);
		readable();
		await chooseHeld();

		expect(drawnAt).not.toContain(MARK_PICTURE_PX);
		expect(sent).toEqual([]);
		expect(saved).toEqual([{ preview: UPLOAD }]);
	});

	// A note keeps its pictures at the size a note draws them, which is many
	// times what a mark shows — so re-using one is not the same as re-using it
	// whole.
	it("cuts one held at a note's size before the mark wears it", async () => {
		const { drawnAt } = fromACamera();
		readable();
		await chooseHeld();

		expect(drawnAt).toContain(MARK_PICTURE_PX);
		expect(saved).toEqual([{ preview: 'sent-1' }]);
	});

	// The picker only offers what the person has; bytes that will not read are
	// no reason to refuse them the picture they pointed at.
	it('keeps the picture pointed at when its bytes will not read', async () => {
		vi.stubGlobal('fetch', async () => {
			throw new Error('offline');
		});
		await chooseHeld();

		expect(sent).toEqual([]);
		expect(saved).toEqual([{ preview: UPLOAD }]);
		expect(document.body.querySelector('[role="alert"]')).toBeNull();
	});

	it('takes the picture off without disturbing the rest of the look', async () => {
		open({ ring_weight: 'heavy', preview: UPLOAD });
		await takeOff(1);
		expect(saved).toEqual([{ ring_weight: 'heavy' }]);
	});
});

// DESIGN.md § "The mark": how much of the mark the picture covers is the
// author's to choose, and a size says nothing with no picture to size.
describe('how big the picture is drawn', () => {
	it('is asked for only once there is a picture to size', () => {
		open();
		expect(() => group(COVER)).toThrow();
		open({ preview: UPLOAD });
		expect(at(COVER)).toBe(PREVIEW_COVER_MIN);
	});

	it('saves how much of the mark its author dragged it over', async () => {
		open({ preview: UPLOAD });
		await drag(COVER, 'ArrowRight');
		expect(saved).toEqual([{ preview: UPLOAD, preview_cover: 0.4225 }]);
	});

	// The developer's complaint the range answers: a picture could never reach
	// the ring, let alone lie over it. All the way is now the disc's own edge.
	it('drags all the way over the ring, to the edge of the disc', async () => {
		open({ preview: UPLOAD, ring_weight: 'heavy' });
		await drag(COVER, 'End');
		expect(saved).toEqual([
			{ preview: UPLOAD, ring_weight: 'heavy', preview_cover: PREVIEW_COVER_MAX }
		]);
		expect(PREVIEW_COVER_MAX).toBeGreaterThan(LOOK_RING_AT + LOOK_RING_WIDTH.heavy / 2);
	});

	it('stores nothing for the size a picture already draws at', async () => {
		open({ preview: UPLOAD, preview_cover: 0.4225 });
		await drag(COVER, 'Home');
		expect(saved).toEqual([{ preview: UPLOAD }]);
	});

	it('goes with the picture it sized', async () => {
		open({ preview: UPLOAD, preview_cover: PREVIEW_COVER_MAX });
		await takeOff(1);
		expect(saved).toEqual([null]);
	});

	// The swatch is what somebody reads before they save, so it draws the cover
	// the canvas will.
	it('is what the swatch draws before it is saved', async () => {
		const across = (): number =>
			Number(document.body.querySelector('svg image')?.getAttribute('width'));

		open({ preview: UPLOAD });
		await settle();
		const small = across();

		open({ preview: UPLOAD, preview_cover: PREVIEW_COVER_MAX });
		await settle();
		expect(across()).toBeGreaterThan(small);
	});
});

// DESIGN.md § "The mark": the fold is capped and the author's step is spent on
// top of it, so this is the control for a note somebody wants bigger.
describe('how big the note is drawn', () => {
	// The developer's complaint the slider answers: five words were the whole
	// of the channel, and a size between two of them could not be asked for.
	it('is dragged across the whole range rather than picked off a ladder', () => {
		open();
		expect(buttons(group('Size'))).toEqual([]);
		expect(Number(thumb('Size').getAttribute('aria-valuemin'))).toBe(MARK_SCALE_MIN);
		expect(Number(thumb('Size').getAttribute('aria-valuemax'))).toBe(MARK_SCALE_MAX);
	});

	it('stores the size its author dragged to', async () => {
		open();
		await drag('Size', 'End');
		expect(saved).toEqual([{ mark_scale: MARK_SCALE_MAX }]);
	});

	// A note spelt in the old steps opens where that step always drew, and the
	// step goes as soon as the number says it more finely.
	it('opens a note spelt in a step at that step, and drags off it', async () => {
		open({ mark_radius: 'large' });
		expect(at('Size')).toBe(MARK_RADIUS_SCALE.large);
		await drag('Size', 'ArrowRight');
		expect(saved).toEqual([{ mark_scale: 1.35 }]);
	});

	// The complaint the control answers is that a mark's size was the fold's
	// alone, so the row has to say whose the size is.
	it('says whose the size is, over what the fold already did', () => {
		open();
		expect(group('Size').textContent).toContain('folded');
	});

	// A swatch that clips the top of the range draws the sizes near it alike,
	// and somebody dragging between them is dragging blind.
	it('draws every size apart, up to the top of the range', () => {
		const across = (): number =>
			Number(document.body.querySelector('svg circle')?.getAttribute('r'));

		const drawn = [MARK_SCALE_MIN, 1, 1.34, 1.8, MARK_SCALE_MAX].map((mark_scale) => {
			open({ mark_scale });
			return across();
		});

		expect(drawn).toEqual([...drawn].sort((a, b) => a - b));
		expect(new Set(drawn).size).toBe(drawn.length);
	});
});

// DESIGN.md § "A picture that takes turns": a mark reads the same model the
// ground does, so somebody who has learnt one has learnt the other.
describe('a mark that wears more than one picture', () => {
	it('keeps the second behind the first, in the order they take turns', async () => {
		open({ preview: UPLOAD });
		await choose(new File([new Uint8Array(90)], 'kite.webp', { type: 'image/webp' }));

		expect(saved).toEqual([{ preview: UPLOAD, preview_more: ['sent-1'] }]);
	});

	it('asks nothing about turns while there is one picture to show', () => {
		open({ preview: UPLOAD });
		const words = document.body.textContent ?? '';
		expect(words).not.toContain('Takes turns');
		expect(words).not.toContain('How it changes');
	});

	it('asks how one gives way to the next as soon as there are two', () => {
		open({ preview: UPLOAD, preview_more: ['b'] });
		const words = document.body.textContent ?? '';
		expect(words).toContain('Takes turns');
		for (const word of ['Crossfade', 'Slide', 'Slow zoom']) expect(words).toContain(word);
	});

	it('stores the transition chosen, and nothing for the quietest', async () => {
		open({ preview: UPLOAD, preview_more: ['b'] });
		await tap('Slow zoom');
		expect(saved).toEqual([{ preview: UPLOAD, preview_more: ['b'], preview_transition: 'zoom' }]);

		open({ preview: UPLOAD, preview_more: ['b'], preview_transition: 'zoom' });
		await tap('Crossfade');
		expect(saved.at(-1)).toEqual({ preview: UPLOAD, preview_more: ['b'] });
	});

	// A cadence and a transition say nothing about a picture that never changes,
	// so they go with the second picture rather than being stored unread.
	it('drops the cadence and the transition with the picture that earned them', async () => {
		open({
			preview: UPLOAD,
			preview_more: ['b'],
			preview_every: 30,
			preview_transition: 'slide'
		});
		await takeOff(2);
		expect(saved).toEqual([{ preview: UPLOAD }]);
	});

	it('promotes the next picture where the first is taken off', async () => {
		open({ preview: UPLOAD, preview_more: ['b', 'c'] });
		await takeOff(1);
		expect(saved).toEqual([{ preview: 'b', preview_more: ['c'] }]);
	});

	it('stops offering more once the series is as long as one is written with', () => {
		open({ preview: UPLOAD, preview_more: ['b', 'c', 'd', 'e', 'f', 'g', 'h'] });
		expect(buttons().some((button) => button.textContent?.trim() === 'Add a picture')).toBe(false);
	});

	// A newer Sloppy may write a longer series and a slower cadence than this one
	// draws, and a request may carry neither. Changing the ring on such a note is
	// still a change the reader gets to make.
	it('sends what it drew where a newer Sloppy wrote more than a request carries', async () => {
		open({
			preview: UPLOAD,
			preview_more: ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
			preview_every: PICTURE_TURN_MAX * 3
		});

		await tap('Heavy', group('Ring'));

		expect(saved).toEqual([
			{
				ring_weight: 'heavy',
				preview: UPLOAD,
				preview_more: ['b', 'c', 'd', 'e', 'f', 'g', 'h'],
				preview_every: PICTURE_TURN_MAX
			}
		]);
	});
});
