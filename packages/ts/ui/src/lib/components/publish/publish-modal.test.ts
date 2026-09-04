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
const THIRD = ref('3');

const V1 = { ref: FIRST, sequence: 1, published_at: '2026-02-01T00:00:00.000Z' };
const V2 = { ref: SECOND, sequence: 2, published_at: '2026-02-02T00:00:00.000Z' };
const V3 = { ref: THIRD, sequence: 3, published_at: '2026-02-03T00:00:00.000Z' };

const branch: PublishedBranch = {
	latest: V2,
	versions: [V2, V1],
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

function open(
	onchanges: (
		from: OwnedRef,
		to: OwnedRef,
		cursor?: string
	) => Promise<{ changes: typeof changes } | null>,
	published: PublishedBranch = branch
) {
	mounted = mount(PublishModal, {
		target,
		props: {
			open: true,
			address: '1',
			published,
			onchanges,
			onpublish: async () => undefined,
			oncomments: async () => undefined,
			onunpublish: async () => undefined
		}
	});
	flushSync();
	return mounted;
}

/** The way back out of a comparison, which stays live while one is in flight. */
function back(): HTMLElement {
	const arrow = [...document.body.querySelectorAll('button')].find(
		(button) => button.textContent?.trim() === 'Publishing'
	);
	if (!arrow) throw new Error('no way back');
	return arrow;
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
		await vi.waitFor(() => expect(asked).toHaveBeenCalledWith(FIRST, SECOND, undefined));
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

	// A reorder moves the ord and not one word, so a was/now pair around it draws
	// the same writing twice and calls it a difference.
	it('says a section that only took a new place moved', async () => {
		open(async () => ({
			changes: [
				{
					change: 'changed' as const,
					note: note('A', '1', 'Where thought starts'),
					before: note('A', '1', 'Where thought starts'),
					sections: [
						{
							change: 'changed' as const,
							section: {
								ref: ref('S'),
								node: ref('A'),
								ord: 'Zx',
								content: words('Section A, written first.')
							},
							before: {
								ref: ref('S'),
								node: ref('A'),
								ord: 'Zz',
								content: words('Section A, written first.')
							}
						}
					]
				}
			]
		}));

		version(2).click();
		await vi.waitFor(() =>
			expect(document.body.textContent).toContain('Section A, written first.')
		);
		flushSync();

		const shown = document.body.textContent ?? '';
		expect(shown).toContain('Moved');
		expect(shown).not.toContain('was');
		// Drawn once: the same words either side is not a difference to show.
		expect(shown.split('Section A, written first.')).toHaveLength(2);
	});

	// The back arrow stays live while a read is in flight, so the answer to a
	// question that has been left behind must not land under the next one.
	it('drops a comparison the reader has already moved on from', async () => {
		const deep: PublishedBranch = { latest: V3, versions: [V3, V2, V1], comments: 'anyone' };
		const held = new Map<OwnedRef, (page: { changes: typeof changes }) => void>();
		open(
			(from) =>
				new Promise((settle) => {
					held.set(from, settle);
				}),
			deep
		);

		version(3).click();
		await vi.waitFor(() => expect(held.has(SECOND)).toBe(true));
		back().click();
		flushSync();
		version(2).click();
		await vi.waitFor(() => expect(held.has(FIRST)).toBe(true));

		// The abandoned read answers second, which is the whole of the race.
		held.get(SECOND)?.({
			changes: [
				{ change: 'added' as const, note: note('Z', '1z', 'From the other publish'), sections: [] }
			]
		});
		for (let tick = 0; tick < 5; tick++) await Promise.resolve();
		flushSync();

		expect(document.body.textContent).toContain('What version 2 changed');
		expect(document.body.textContent).not.toContain('From the other publish');
	});
});

describe('a chain longer than the list shows', () => {
	it('reads the oldest one listed against the publish kept back for it', async () => {
		const asked = vi.fn(async () => ({ changes }));
		open(asked, { latest: V3, versions: [V3, V2], earlier: V1, comments: 'anyone' });

		version(2).click();
		await vi.waitFor(() => expect(asked).toHaveBeenCalledWith(FIRST, SECOND, undefined));
	});
});
