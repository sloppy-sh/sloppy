// @vitest-environment jsdom
import Check from '@lucide/svelte/icons/check';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import CanvasMenu from './canvas-menu.svelte';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let closed: number;

function open(props: Record<string, unknown> = {}) {
	closed = 0;
	mounted = mount(CanvasMenu, {
		target,
		props: {
			at: { clientX: 40, clientY: 60 },
			items: [{ label: 'Choose this note', icon: Check, onSelect: () => {} }],
			label: 'What you can do here',
			onclose: () => {
				closed += 1;
			},
			...props
		}
	});
	flushSync();
}

const menu = () => document.body.querySelector<HTMLElement>('[role="menu"]');

beforeEach(() => {
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
});

describe('the canvas menu', () => {
	it('opens where it was asked for', () => {
		open();
		expect(menu()?.style.left).toBe('40px');
		expect(menu()?.style.top).toContain('66px');
	});

	// DESIGN.md § "The four inset vars": bottom-edge chrome clears the system bar,
	// and the var is what carries it because Android reports the raw probe as 0.
	it('is held clear of the bar the platform draws under it', () => {
		open();
		expect(menu()?.style.top).toContain('var(--sysnav-clearance)');
	});

	// The reader asked for a menu, not for the tap under it, so the first pointer
	// that lands anywhere else puts it away without reaching the canvas.
	it('closes on Escape and on the next pointer outside it', () => {
		open();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		expect(closed).toBe(1);

		const away = document.body.querySelector<HTMLElement>('[data-menu-scrim]');
		away?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		expect(closed).toBe(2);
	});

	it('draws nothing where there is nothing to offer', () => {
		open({ items: [] });
		expect(menu()).toBeNull();
	});

	// What a note offers is most of a phone's height by the time it is a real
	// list of acts, and the point it was asked for is usually not near the top.
	it('turns above the point rather than running off a phone', () => {
		Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
		Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
		const acts = ['Open it', 'Tags', 'Give it a look', 'Fold it', 'Choose it', 'Delete it'];
		open({
			at: { clientX: 300, clientY: 800 },
			items: acts.map((label) => ({ label, icon: Check, onSelect: () => {} }))
		});

		const height = acts.length * 44 + 8;
		const top = Number(/min\((\d+(?:\.\d+)?)px/.exec(menu()?.style.top ?? '')?.[1]);
		expect(top).toBeGreaterThanOrEqual(8);
		expect(top + height).toBeLessThanOrEqual(800);
		// And it stays off the right edge, where a menu asked for there would hang.
		expect(Number.parseFloat(menu()?.style.left ?? '')).toBeLessThanOrEqual(390 - 240 - 8);
	});
});
