// @vitest-environment jsdom
// What the sheet says a publish did, drawn from the difference itself rather
// than from a count of it.

import type { OwnedRef, PublishedNoteChange, UnpublishedChanges } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import { reactive } from '../props.test-support.svelte.js';
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
	published: PublishedBranch = branch,
	onpending: () => Promise<UnpublishedChanges | null> = async () => null
) {
	mounted = mount(PublishModal, {
		target,
		props: {
			open: true,
			address: '1',
			published,
			onchanges,
			onpending,
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

describe('the decision to publish again', () => {
	const pending = (
		changes: UnpublishedChanges['changes'],
		total = changes.length
	): UnpublishedChanges => ({ publication: ref('P'), since: V2, changes, total });

	const moved = (
		mark: string,
		address: string,
		title: string,
		over: Partial<UnpublishedChanges['changes'][number]> = {}
	) => ({
		note: ref(mark),
		address,
		title,
		change: 'changed' as const,
		tags_gained: [] as string[],
		tags_lost: [] as string[],
		written: false,
		...over
	});

	// What a person is about to publish is a different question from what a past
	// publish did, and it is the one the button beside it answers.
	it('says what the branch has done since, beside the button that sends it', async () => {
		open(
			async () => ({ changes }),
			branch,
			async () =>
				pending([
					moved('A', '1a', 'Written since', { written: true }),
					moved('B', '1b', 'Renamed', { was_titled: 'Called this' }),
					moved('C', '1c', 'Retagged', { tags_gained: ['sprout'], tags_lost: ['seed'] }),
					{ ...moved('D', '1d', 'New note'), change: 'added' as const },
					{ ...moved('E', '1e', 'Gone'), change: 'removed' as const }
				])
		);

		await vi.waitFor(() => expect(document.body.textContent).toContain('Written since'));
		flushSync();

		const shown = document.body.textContent ?? '';
		expect(shown).toContain('This branch has changed since then.');
		expect(shown).toContain('Written in');
		expect(shown).toContain('Was “Called this”');
		expect(shown).toContain('Now tagged sprout');
		expect(shown).toContain('No longer tagged seed');
		expect(shown).toContain('New note');
		expect(shown).toContain('Taken out');
		expect(shown).toContain('Publish again');
	});

	it('says nothing where the branch is as it was published', async () => {
		open(
			async () => ({ changes }),
			branch,
			async () => pending([])
		);

		await vi.waitFor(() => expect(document.body.textContent).toContain('Publish again'));
		for (let tick = 0; tick < 5; tick++) await Promise.resolve();
		flushSync();

		expect(document.body.textContent).not.toContain('This branch has changed since then.');
	});

	it('says how many more moved than it lists', async () => {
		open(
			async () => ({ changes }),
			branch,
			async () => pending([moved('A', '1a', 'One of many', { written: true })], 12)
		);

		await vi.waitFor(() => expect(document.body.textContent).toContain('One of many'));
		flushSync();

		expect(document.body.textContent).toContain('And 11 more.');
	});

	// The answer is about writing that is still moving, so a sheet opened again
	// asks again rather than drawing what it was told last time.
	it('asks again every time the sheet is opened', async () => {
		const asked = vi.fn(async () => pending([]));
		const props = reactive({
			open: true,
			address: '1',
			published: branch,
			onchanges: async () => ({ changes }),
			onpending: asked,
			onpublish: async () => undefined,
			oncomments: async () => undefined,
			onunpublish: async () => undefined
		});
		mounted = mount(PublishModal, { target, props });
		flushSync();

		await vi.waitFor(() => expect(asked).toHaveBeenCalledTimes(1));
		props.open = false;
		flushSync();
		props.open = true;
		flushSync();

		await vi.waitFor(() => expect(asked).toHaveBeenCalledTimes(2));
	});
});

describe('what a reader has to be given', () => {
	const opened = (
		reader: { identity?: string; where?: string },
		branchIs: { address?: string; link?: string } = { address: '1a' }
	) => {
		mounted = mount(PublishModal, {
			target,
			props: {
				open: true,
				...branchIs,
				reader,
				published: branch,
				onchanges: async () => null,
				onpending: async () => null,
				onpublish: async () => undefined,
				oncomments: async () => undefined,
				onunpublish: async () => undefined
			}
		});
		flushSync();
	};

	const selectable = () =>
		[...document.body.querySelectorAll('.select-text')].map((one) => one.textContent?.trim());

	it('names the branch, the author and where their graph is', () => {
		opened({ identity: AUTHOR, where: 'https://notes.example' });

		expect(selectable()).toEqual(['1a', AUTHOR, 'https://notes.example']);
	});

	it('leaves out where the graph is where the instance could not say', () => {
		opened({ identity: AUTHOR });

		expect(selectable()).toEqual(['1a', AUTHOR]);
		expect(document.body.textContent).not.toContain('Where your graph is');
	});

	it('says nothing at all where there is nothing to hand over', () => {
		opened({});

		expect(document.body.textContent).not.toContain('What a reader needs');
	});

	it('hands over a link to a branch its author gave no address', () => {
		opened({ identity: AUTHOR }, { link: 'https://sloppy.sh/n/1' });

		expect(selectable()).toEqual(['https://sloppy.sh/n/1', AUTHOR]);
		expect(document.body.textContent).not.toContain('undefined');
		// Said as what it is, so nobody reads a link as the number to cite.
		expect(document.body.textContent).toContain('A link to this branch');
	});

	it('leaves the branch out entirely where it has neither', () => {
		opened({ identity: AUTHOR }, {});

		expect(selectable()).toEqual([AUTHOR]);
		expect([...document.body.querySelectorAll('dt')].map((one) => one.textContent)).toEqual([
			'Your identity'
		]);
	});
});

describe('the terms of a first publish', () => {
	/** `null` is a branch its author gave no address. */
	const asked = (address: string | null = '1a') => {
		mounted = mount(PublishModal, {
			target,
			props: {
				open: true,
				...(address === null ? {} : { address }),
				published: null,
				onchanges: async () => null,
				onpending: async () => null,
				onpublish: async () => undefined,
				oncomments: async () => undefined,
				onunpublish: async () => undefined
			}
		});
		flushSync();
		return document.body.textContent ?? '';
	};

	it('says the graph goes out by name, and the look by shape alone', () => {
		const shown = asked();

		expect(shown).toContain('The name you gave the graph it sits in goes out too.');
		expect(shown).toContain(
			'How it looks on the graph goes out as well — the ring and the size, though not a picture you set there.'
		);
	});

	it('names the branch by its address wherever its author wrote one', () => {
		expect(asked()).toContain('Everything under 1a goes out');
	});

	it('asks the same of a branch its author gave no address, in words', () => {
		const shown = asked(null);

		expect(shown).toContain('Everything under this branch goes out');
		expect(shown).not.toContain('undefined');
	});
});

describe('taking a branch down', () => {
	it('says what stops, and what the people who read it keep', async () => {
		open(async () => null);

		const down = [...document.body.querySelectorAll('button')].find(
			(button) => button.textContent?.trim() === 'Take it down'
		);
		down?.click();
		flushSync();

		const shown = document.body.textContent ?? '';
		expect(shown).toContain('Nobody new can read it, and the pictures in it stop opening.');
		expect(shown).toContain('Whoever has already read it keeps their copy of the writing.');
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
