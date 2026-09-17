// One version opened out of the picture: what signed it, or that nothing did.

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DrawnVersion } from './commit-graph.js';
import CommitDetails from './commit-details.svelte';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

const version = (over: Partial<DrawnVersion> = {}): DrawnVersion => ({
	id: 'c',
	message: 'The garden as it stands',
	when: '1 Jan 2026',
	parents: [],
	refs: [],
	...over
});

function show(over: { version?: DrawnVersion; signs?: boolean } = {}): void {
	mounted = mount(CommitDetails, {
		target,
		props: {
			open: true,
			version: over.version ?? version(),
			signs: over.signs ?? false,
			onOpen: () => {},
			onStartLine: () => Promise.resolve(true),
			onWorkOn: () => Promise.resolve(true)
		}
	});
	flushSync();
}

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

beforeEach(() => {
	// jsdom drives no pointer, and a sheet asks the element it is on about one.
	Element.prototype.hasPointerCapture = () => false;
	Element.prototype.setPointerCapture = () => {};
	Element.prototype.releasePointerCapture = () => {};
	Element.prototype.scrollIntoView = () => {};
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			matches: query.includes('min-width'),
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

describe('a version somebody opened', () => {
	it('marks it unsigned where the folder signs and this version is not', () => {
		show({ signs: true });

		expect(screen()).toContain('Kept unsigned');
	});

	it('says nothing of a signature where the folder signs with none', () => {
		show();

		expect(screen()).not.toContain('Kept unsigned');
	});

	it('names the key that signed one, where one did', () => {
		show({
			version: version({ signed: { by: 'ssh-ed25519 AAAA', verified: true } }),
			signs: true
		});

		expect(screen()).not.toContain('Kept unsigned');
		expect(screen()).toContain('ssh-ed25519 AAAA');
	});
});
