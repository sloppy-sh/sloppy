import { describe, expect, it } from 'vitest';
import { overlay } from './overlay.svelte.js';

describe('what is up over the page', () => {
	it('is nothing until a surface declares itself', () => {
		expect(overlay.open).toBe(false);
		expect(overlay.closeTop()).toBe(false);
	});

	it('stands until the last of a stack goes', () => {
		const first = overlay.push(() => {});
		const second = overlay.push(() => {});
		second();
		expect(overlay.open).toBe(true);
		first();
		expect(overlay.open).toBe(false);
	});

	it('takes the one that went up last off first', () => {
		const closed: string[] = [];
		const first = overlay.push(() => closed.push('first'));
		const second = overlay.push(() => closed.push('second'));

		expect(overlay.closeTop()).toBe(true);
		expect(closed).toEqual(['second']);
		// A surface closes by its own means, so it is still declared until it says
		// it has gone.
		expect(overlay.open).toBe(true);

		second();
		expect(overlay.closeTop()).toBe(true);
		expect(closed).toEqual(['second', 'first']);
		first();
		expect(overlay.open).toBe(false);
	});

	it('keeps a stack straight when a disposer runs twice', () => {
		const first = overlay.push(() => {});
		const second = overlay.push(() => {});
		second();
		second();
		expect(overlay.open).toBe(true);
		first();
		expect(overlay.open).toBe(false);
	});
});
