import { afterEach, describe, expect, it } from 'vitest';
import { keyboard, trackKeyboard, type KeyboardChange } from './keyboard.svelte.js';

const LAYOUT_HEIGHT = 800;

/** jsdom has no visual viewport, so the suite drives one. */
class FakeViewport extends EventTarget {
	height = LAYOUT_HEIGHT;
	offsetTop = 0;
	scale = 1;

	settle(change: { height?: number; offsetTop?: number; scale?: number }) {
		Object.assign(this, change);
		this.dispatchEvent(new Event('resize'));
	}
}

function viewport(): FakeViewport {
	const vv = new FakeViewport();
	Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
	Object.defineProperty(window, 'innerHeight', { value: LAYOUT_HEIGHT, configurable: true });
	return vv;
}

const lift = () => document.documentElement.style.getPropertyValue('--kb-inset-bottom');

afterEach(() => {
	document.documentElement.removeAttribute('style');
	keyboard.set(false, 0);
});

describe('what the on-screen keyboard covers', () => {
	it('lifts a bottom-anchored surface by what the keyboard occludes', () => {
		const vv = viewport();
		const stop = trackKeyboard();

		expect(lift()).toBe('0px');
		expect(keyboard.open).toBe(false);

		vv.settle({ height: LAYOUT_HEIGHT - 336 });
		expect(lift()).toBe('336px');
		expect(keyboard.open).toBe(true);
		expect(keyboard.height).toBe(336);

		stop();
	});

	it('reads an input accessory bar as no keyboard at all', () => {
		const vv = viewport();
		const stop = trackKeyboard();

		vv.settle({ height: LAYOUT_HEIGHT - 44 });

		expect(keyboard.open).toBe(false);
		expect(keyboard.height).toBe(0);
		expect(lift()).toBe('44px');

		stop();
	});

	it('takes the page WebKit panned off the lift, and still calls it open', () => {
		const vv = viewport();
		const stop = trackKeyboard();

		vv.settle({ height: LAYOUT_HEIGHT - 336, offsetTop: 336 });

		expect(lift()).toBe('0px');
		expect(keyboard.open).toBe(true);

		stop();
	});

	it('does not read a pinch-zoomed viewport as a keyboard', () => {
		const vv = viewport();
		const stop = trackKeyboard();

		vv.settle({ height: LAYOUT_HEIGHT / 2, scale: 2 });

		expect(keyboard.open).toBe(false);
		expect(lift()).toBe('0px');

		stop();
	});

	it('finds the keyboard behind a pinch-zoomed viewport', () => {
		const vv = viewport();
		const stop = trackKeyboard();

		vv.settle({ height: (LAYOUT_HEIGHT - 336) / 2, scale: 2 });

		expect(keyboard.open).toBe(true);
		expect(keyboard.height).toBe(336);

		stop();
	});

	it('hands a shell every reading, so it can settle insets of its own', () => {
		const vv = viewport();
		const seen: KeyboardChange[] = [];
		const stop = trackKeyboard((change) => seen.push(change));

		vv.settle({ height: LAYOUT_HEIGHT - 336 });

		expect(seen).toEqual([
			{ open: false, occlusion: 0, lift: 0 },
			{ open: true, occlusion: 336, lift: 336 }
		]);

		stop();
	});

	it('releases the lift and stops reading the viewport when it stops', () => {
		const vv = viewport();
		const stop = trackKeyboard();
		vv.settle({ height: LAYOUT_HEIGHT - 336 });

		stop();

		expect(lift()).toBe('');
		expect(keyboard.open).toBe(false);
		expect(keyboard.height).toBe(0);

		vv.settle({ height: LAYOUT_HEIGHT - 300 });
		expect(lift()).toBe('');
		expect(keyboard.open).toBe(false);
	});

	it('does nothing where there is no visual viewport to read', () => {
		Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });

		const stop = trackKeyboard();
		stop();

		expect(lift()).toBe('');
		expect(keyboard.open).toBe(false);
	});
});
