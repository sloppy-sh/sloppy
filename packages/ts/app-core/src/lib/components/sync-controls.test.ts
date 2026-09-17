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
let picked: string[];

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

function show(over: Record<string, unknown> = {}): void {
	mounted = mount(SyncControls, {
		target,
		props: {
			places: PLACES,
			chosen: 'origin',
			ahead: 1,
			behind: 2,
			onPick: (name: string) => picked.push(name),
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
	picked = [];
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
	it('says how far it is from the place in front of somebody', () => {
		show();

		expect(screen()).toContain('2 to take in, 1 to put there.');
	});

	it('says how far it is from another place once that is the one picked', () => {
		show({ chosen: 'backup', ahead: 3, behind: 0 });

		expect(screen()).toContain('backup');
		expect(screen()).toContain('3 to put there.');
	});

	it('says nothing of a distance to a place it has not heard from', () => {
		show({ chosen: 'backup', ahead: undefined, behind: undefined });

		expect(screen()).not.toContain('to take in');
		expect(screen()).not.toContain('to put there');
		expect(screen()).not.toContain('Everything here is there too');
	});

	it('says there is nothing waiting either way where the two are level', () => {
		show({ ahead: 0, behind: 0 });

		expect(screen()).toContain('Everything here is there too.');
	});

	it('takes every act to the place that is picked', () => {
		const asked: string[] = [];
		show({ chosen: 'backup', onTakeIn: (name: string) => asked.push(name) });

		[...document.querySelectorAll('button')]
			.find((one) => one.textContent?.trim() === 'Take them in')
			?.click();
		flushSync();

		expect(asked).toEqual(['backup']);
	});
});
