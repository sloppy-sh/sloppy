// @vitest-environment jsdom
import { MARK_PICTURE_PX } from '@sloppy/graph';
import type { MediaAsset, NodeAppearance } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeldPicture, NoteMedia } from '../editor/contract.js';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import { NOTE_PX } from '../editor/fit.js';
import AppearanceModal from './appearance-modal.svelte';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let saved: (NodeAppearance | null)[];
let refuse: string | null;
let sent: File[];
let held: HeldPicture[];

const UPLOAD = 'did:syr:ham/01UP';

/** What the client actually throws when a save is refused — a status, a route
 *  and a record id, none of which may reach a person. */
const RAW = 'Sloppy API 400 Bad Request for /nodes/did:syr:ham/01JABCXYZ: nope';

const picture = (id: string): HeldPicture => ({
	upload_id: id,
	filename: 'kite.png',
	mime_type: 'image/png',
	size: 9
});

const media: NoteMedia = {
	send(file) {
		sent.push(file);
		const asset: MediaAsset = { upload_id: 'sent-1', mime_type: file.type, size: file.size };
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
	mounted = mount(AppearanceModal, {
		target,
		props: {
			open: true,
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
		open();
		await tap('Medium', group('Size'));
		expect(saved).toEqual([null]);
	});

	it('leaves the ring style alone while there is no ring', () => {
		open();
		expect(group('Ring style').disabled).toBe(true);
		expect(named('Dashed').matches(':disabled')).toBe(true);
		open({ ring_weight: 'hairline' });
		expect(group('Ring style').disabled).toBe(false);
		expect(named('Dashed').matches(':disabled')).toBe(false);
	});

	// A ring style says nothing with no ring, and a size that says what a plain
	// note draws is not a look either — so what is stored draws what is shown.
	it('stores nothing for a channel that draws what a plain note does', async () => {
		open({ ring_weight: 'none', ring_style: 'dashed' });
		await tap('Large', group('Size'));
		expect(saved).toEqual([{ mark_radius: 'large' }]);

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
		expect(named('Large').getAttribute('aria-pressed')).toBe('true');
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
	/** A picture of these dimensions, and a canvas that reports what it was
	 *  redrawn onto. The default is what a camera hands over. */
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
			drawnAt.push(Math.max(this.width, this.height));
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
		(document.body.querySelector('button[aria-label="kite.png"]') as HTMLButtonElement).click();
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
		await tap('Remove');
		expect(saved).toEqual([{ ring_weight: 'heavy' }]);
	});
});
