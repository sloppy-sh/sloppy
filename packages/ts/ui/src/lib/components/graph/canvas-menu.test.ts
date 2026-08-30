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
		expect(menu()?.style.top).toContain('var(--safe-area-inset-bottom');
		expect(menu()?.style.top).toContain('var(--sysnav-inset-bottom');
	});

	// The reader asked for a menu, not for the tap under it, so the first pointer
	// that lands anywhere else puts it away without reaching the canvas.
	it('closes on Escape and on the next pointer outside it', () => {
		open();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		expect(closed).toBe(1);

		const away = document.body.querySelector<HTMLElement>('.fixed.inset-0');
		away?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		expect(closed).toBe(2);
	});

	it('draws nothing where there is nothing to offer', () => {
		open({ items: [] });
		expect(menu()).toBeNull();
	});
});
