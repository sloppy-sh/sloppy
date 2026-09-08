// @vitest-environment jsdom
// What a branch has done since it went out, as its author reads it before
// sending it again.

import type { OwnedRef, UnpublishedChange } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubResizeObserver } from '../dom.test-support.js';
import PendingChanges from './pending-changes.svelte';

const AUTHOR = 'did:syr:z6MkpTHR8VNsBxYAAWHut2Geadd9jSLuFvdmsZ2mFmZjMxYZ';
const ref = (mark: string): OwnedRef => `${AUTHOR}/01JQXR${'0'.repeat(19)}${mark}`;

const entry = (over: Partial<UnpublishedChange> = {}): UnpublishedChange =>
	({
		note: ref('B'),
		address: '1c',
		title: 'Spores',
		change: 'changed',
		tags_gained: [],
		tags_lost: [],
		written: false,
		...over
	}) as UnpublishedChange;

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function draw(changes: UnpublishedChange[]): void {
	mounted = mount(PendingChanges, { target, props: { changes, total: changes.length } });
	flushSync();
}

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

beforeEach(() => {
	stubResizeObserver();
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
});

describe('a note carried somewhere else', () => {
	it('is named as carried, and by where it was', () => {
		draw([entry({ was_at: '1a' })]);

		expect(screen()).toContain('Moved');
		expect(screen()).toContain('Was at 1a');
		expect(screen()).not.toContain('Edited');
	});

	it('is named by what else was done to it where something else was', () => {
		draw([entry({ was_at: '1a', was_titled: 'Seeds' })]);

		expect(screen()).toContain('Edited');
		expect(screen()).toContain('Was at 1a');
		expect(screen()).toContain('Was “Seeds”');
	});

	it('says nothing of where it was when it has not been carried', () => {
		draw([entry({ was_titled: 'Seeds' })]);

		expect(screen()).toContain('Edited');
		expect(screen()).not.toContain('Was at');
	});
});

describe('a note written since with no address', () => {
	it('is named by its title, and by nothing standing in for an address', () => {
		const written = entry({ change: 'added', title: 'Mycelium' });
		delete written.address;
		draw([written]);

		expect(screen()).toContain('Mycelium');
		expect(screen()).toContain('New note');
		expect(document.body.querySelector('.address')).toBeNull();
	});

	it('says where it was once its author took the address off it, without calling it moved', () => {
		const unnumbered = entry({ was_at: '1c', title: 'Spores' });
		delete unnumbered.address;
		draw([unnumbered]);

		expect(screen()).toContain('Spores');
		expect(screen()).toContain('Unnumbered');
		expect(screen()).toContain('Was at 1c');
		expect(screen()).not.toContain('Moved');
	});
});
