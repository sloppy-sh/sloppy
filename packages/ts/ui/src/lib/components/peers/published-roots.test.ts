// @vitest-environment jsdom
// What one identity publishes, as a reader picks a branch to take.

import type { OwnedRef, PublishedPublication, Timestamp } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import PublishedRoots from './published-roots.svelte';

const ADA = 'did:syr:z6MkAdaAdaAdaAdaAdaAdaAdaAdaAdaAda';

let mounted: ReturnType<typeof mount> | undefined;
let pulled: OwnedRef[];

const branch = (over: Partial<PublishedPublication> = {}): PublishedPublication => ({
	ref: `${ADA}/01ARZ3NDEKTSV4RRFFQ69G5FB0` as OwnedRef,
	root_address: '1a',
	title: 'Cells',
	latest: {
		ref: `${ADA}/01ARZ3NDEKTSV4RRFFQ69G5FB1` as OwnedRef,
		sequence: 1,
		published_at: '2026-01-01T00:00:00.000Z' as Timestamp
	},
	...over
});

function show(publications: PublishedPublication[]): void {
	if (mounted) unmount(mounted, { outro: false });
	document.body.innerHTML = '';
	const target = document.createElement('div');
	document.body.appendChild(target);
	pulled = [];
	mounted = mount(PublishedRoots, {
		target,
		props: {
			publications,
			onpull: (publication: OwnedRef) => pulled.push(publication),
			onmore: () => {}
		}
	});
	flushSync();
}

const press = (words: string): void => {
	const button = [...document.querySelectorAll<HTMLElement>('button')].find((one) =>
		one.textContent?.includes(words)
	);
	button?.click();
	flushSync();
};

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	document.body.innerHTML = '';
});

describe('the branches somebody publishes', () => {
	it('cites one by the address its author gave it', () => {
		show([branch()]);

		const text = document.body.textContent ?? '';
		expect(text).toContain('1a');
		expect(text).toContain('Cells');
	});

	// A branch its author never numbered is listed like any other, read by its
	// title, and taken by the same button.
	it('reads one its author gave no address by its title', () => {
		show([branch({ root_address: undefined })]);

		const text = document.body.textContent ?? '';
		expect(text).toContain('Cells');
		expect(text).not.toContain('undefined');
		expect(document.querySelector('.address')?.textContent).toBe('');

		press('Read it');
		expect(pulled).toEqual([branch().ref]);
	});

	it('names one whose author gave it neither', () => {
		show([branch({ root_address: undefined, title: '' })]);

		expect(document.body.textContent).toContain('Untitled');
	});
});
