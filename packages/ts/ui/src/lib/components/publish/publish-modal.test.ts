// @vitest-environment jsdom
// What the sheet says a publish did, drawn from the difference itself rather
// than from a count of it.

import type { OwnedRef, PublishedNoteChange } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import PublishModal, { type PublishedBranch } from './publish-modal.svelte';

const AUTHOR = 'did:syr:z6MkpTHR8VNsBxYAAWHut2Geadd9jSLuFvdmsZ2mFmZjMxYZ';
const ref = (mark: string): OwnedRef => `${AUTHOR}/01JQXR${'0'.repeat(19)}${mark}`;

const FIRST = ref('1');
const SECOND = ref('2');

const branch: PublishedBranch = {
	latest: { ref: SECOND, sequence: 2, published_at: '2026-02-02T00:00:00.000Z' },
	versions: [
		{ ref: SECOND, sequence: 2, published_at: '2026-02-02T00:00:00.000Z' },
		{ ref: FIRST, sequence: 1, published_at: '2026-02-01T00:00:00.000Z' }
	],
	comments: 'anyone'
};

const words = (text: string) => ({
	type: 'doc' as const,
	content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
});

const note = (mark: string, address: string, title: string) => ({
	ref: ref(mark),
	address,
	origin: ref('1'),
	title,
	tags: [] as string[],
	links: [] as OwnedRef[],
	created_at: '2026-01-01T00:00:00.000Z',
	updated_at: '2026-02-02T00:00:00.000Z'
});

const changes: PublishedNoteChange[] = [
	{
		change: 'changed',
		note: { ...note('A', '1', 'After'), tags: ['seed'] },
		before: note('A', '1', 'Before'),
		sections: [
			{
				change: 'changed',
				section: { ref: ref('S'), node: ref('A'), ord: 'a0', content: words('what it says now') },
				before: { ref: ref('S'), node: ref('A'), ord: 'a0', content: words('what it said') }
			}
		]
	},
	{ change: 'removed', note: note('B', '1a', 'Gone') }
];

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function open(onchanges: (from: OwnedRef, to: OwnedRef) => Promise<{ changes: typeof changes }>) {
	mounted = mount(PublishModal, {
		target,
		props: {
			open: true,
			address: '1',
			published: branch,
			onchanges,
			onpublish: async () => undefined,
			oncomments: async () => undefined,
			onunpublish: async () => undefined
		}
	});
	flushSync();
	return mounted;
}

/** The row for one version, which is what a person opens a comparison from. */
function version(sequence: number): HTMLElement {
	const row = [...document.body.querySelectorAll('button')].find((button) =>
		button.textContent?.includes(`Version ${sequence}`)
	);
	if (!row) throw new Error(`no row for version ${sequence}`);
	return row;
}

beforeEach(() => {
	stubResizeObserver();
	stubMediaQuery(() => false);
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
});

describe('a branch already published', () => {
	it('reads one publish against the one before it', async () => {
		const asked = vi.fn(async () => ({ changes }));
		open(asked);

		version(2).click();
		await vi.waitFor(() => expect(asked).toHaveBeenCalledWith(FIRST, SECOND));
		flushSync();

		const shown = document.body.textContent ?? '';
		expect(shown).toContain('What version 2 changed');
		expect(shown).toContain('Against version 1');
	});

	it('draws what the difference carries, both sides of it', async () => {
		open(async () => ({ changes }));

		version(2).click();
		await vi.waitFor(() => expect(document.body.textContent).toContain('what it says now'));
		flushSync();

		const shown = document.body.textContent ?? '';
		// A reworded section shows the writing either side of it, not a count.
		expect(shown).toContain('what it said');
		expect(shown).toContain('Was “Before”');
		expect(shown).toContain('Now tagged seed');
		// A note that is gone is named where it stood.
		expect(shown).toContain('1a');
		expect(shown).toContain('Taken out');
	});

	it('says what a first publish was, without asking anybody', async () => {
		const asked = vi.fn(async () => ({ changes }));
		open(asked);

		version(1).click();
		flushSync();

		expect(asked).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain('This is where 1 was first published');
	});
});
