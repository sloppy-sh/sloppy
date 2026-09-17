// Where else a folder is kept, and which place the numbers beside it are the
// distance from.

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import SyncControls, { type KeptAlso } from './sync-controls.svelte';

const PLACES: KeptAlso[] = [
	{ name: 'origin', at: 'github.test' },
	{ name: 'backup', at: 'backup' }
];

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

function show(over: Record<string, unknown> = {}): void {
	mounted = mount(SyncControls, {
		target,
		props: {
			places: PLACES,
			chosen: 'origin',
			follows: 'origin',
			ahead: 1,
			behind: 2,
			onLook: () => {},
			onTakeIn: () => {},
			onPutThere: () => {},
			...over
		}
	});
	flushSync();
}

beforeEach(() => {
	// jsdom drives no pointer, and a picker asks the element it is on about one.
	Element.prototype.hasPointerCapture = () => false;
	Element.prototype.setPointerCapture = () => {};
	Element.prototype.releasePointerCapture = () => {};
	Element.prototype.scrollIntoView = () => {};
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			matches: query.includes('max-width'),
			addEventListener: () => {},
			removeEventListener: () => {}
		})
	});
	Object.defineProperty(globalThis, 'ResizeObserver', {
		configurable: true,
		writable: true,
		value: class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	});
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
});

describe('the places a folder is also kept', () => {
	it('says how far it is from the place its line follows', () => {
		show();

		expect(screen()).toContain('2 to take in, 1 to put there.');
	});

	it('says nothing of the distance to any other place', () => {
		show({ chosen: 'backup' });

		expect(screen()).toContain('backup');
		expect(screen()).not.toContain('to take in');
		expect(screen()).not.toContain('to put there');
	});
});
