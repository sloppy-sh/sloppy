// @vitest-environment jsdom
// What one publish did to a branch, as a person reads it note by note.

import type { OwnedRef, PublishedNoteChange } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import VersionChanges from './version-changes.svelte';

const AUTHOR = 'did:syr:z6MkpTHR8VNsBxYAAWHut2Geadd9jSLuFvdmsZ2mFmZjMxYZ';
const ref = (mark: string): OwnedRef => `${AUTHOR}/01JQXR${'0'.repeat(19)}${mark}`;

const note = (mark: string, address: string | undefined, title: string) => ({
	ref: ref(mark),
	...(address === undefined ? {} : { address }),
	origin: ref('A'),
	title,
	tags: [] as string[],
	links: [] as OwnedRef[],
	created_at: '2026-01-01T00:00:00.000Z',
	updated_at: '2026-02-02T00:00:00.000Z'
});

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function draw(changes: PublishedNoteChange[]): void {
	mounted = mount(VersionChanges, { target, props: { changes, onmore: () => undefined } });
	flushSync();
}

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

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

describe('what a publish did', () => {
	it('names a note the author carried elsewhere by where it is now, and where it was', () => {
		draw([
			{
				change: 'changed',
				note: note('B', '2c', 'Spores'),
				before: note('B', '1c', 'Spores'),
				sections: []
			}
		]);

		expect(screen()).toContain('2c');
		expect(screen()).toContain('Was at 1c');
		expect(screen()).toContain('Moved');
		expect(screen()).not.toContain('Edited');
	});

	it('names a note its author gave no address by its title alone', () => {
		draw([{ change: 'added', note: note('C', undefined, 'Mycelium'), sections: [] }]);

		expect(screen()).toContain('Mycelium');
		expect(screen()).toContain('New note');
		expect(document.body.querySelector('.address')).toBeNull();
	});

	it('says where a note was once its author took the address off it, without calling it moved', () => {
		draw([
			{
				change: 'changed',
				note: note('B', undefined, 'Spores'),
				before: note('B', '1c', 'Spores'),
				sections: []
			}
		]);

		expect(screen()).toContain('Spores');
		expect(screen()).toContain('Unnumbered');
		expect(screen()).toContain('Was at 1c');
		expect(screen()).not.toContain('Moved');
	});

	it('says nothing about where a note was when it has not been carried anywhere', () => {
		draw([
			{
				change: 'changed',
				note: note('B', '1c', 'Spores'),
				before: note('B', '1c', 'Seeds'),
				sections: []
			}
		]);

		expect(screen()).toContain('Was “Seeds”');
		expect(screen()).toContain('Edited');
		expect(screen()).not.toContain('Was at');
	});
});
