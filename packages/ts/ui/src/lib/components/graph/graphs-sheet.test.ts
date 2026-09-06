// @vitest-environment jsdom
import type { OwnedRef } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import GraphsSheet, { type DeletedChoice } from './graphs-sheet.svelte';

const HOME = 'did:syr:z6MkAda/00000000000000000000000000' as OwnedRef;
const GARDEN = 'did:syr:z6MkAda/01ARZ3NDEKTSV4RRFFQ69G5FAV' as OwnedRef;
const BRANCH = 'did:syr:z6MkAda/01ARZ3NDEKTSV4RRFFQ69G5FAW' as OwnedRef;

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let putBack: OwnedRef[];
let shown: number;

const branch = (over: Partial<DeletedChoice> = {}): DeletedChoice => ({
	ref: BRANCH,
	address: '1a',
	title: 'The seed of the argument',
	notes: 12,
	within: '20 days left',
	...over
});

async function settle(): Promise<void> {
	for (let at = 0; at < 4; at++) {
		flushSync();
		await new Promise((done) => setTimeout(done, 0));
	}
	flushSync();
}

async function open(
	deleted: DeletedChoice[],
	onRestore: (ref: OwnedRef) => Promise<void> = (ref) => {
		putBack.push(ref);
		return Promise.resolve();
	}
): Promise<void> {
	if (mounted) unmount(mounted, { outro: false });
	document.body.innerHTML = '';
	target = document.createElement('div');
	document.body.appendChild(target);
	putBack = [];
	shown = 0;
	mounted = mount(GraphsSheet, {
		target,
		props: {
			open: true,
			graphs: [
				{ ref: HOME, title: 'My graph' },
				{ ref: GARDEN, title: 'Garden' }
			],
			current: HOME,
			alsoUp: new Set<OwnedRef>(),
			deleted,
			onEnter: () => {},
			onToggle: () => {},
			onOpen: () => Promise.resolve(),
			onRename: () => Promise.resolve(),
			onShow: () => {
				shown += 1;
			},
			onRestore
		}
	});
	await settle();
}

const find = (label: string): HTMLElement | null =>
	document.querySelector<HTMLElement>(`[aria-label="${label}"]`);

beforeEach(() => {
	// The sheet at the width a desktop reader has, which is a centred dialog.
	stubMediaQuery((query) => query.includes('min-width'));
	stubResizeObserver();
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	document.body.innerHTML = '';
});

describe('the graphs sheet', () => {
	it('asks for what it lists when it opens', async () => {
		await open([]);
		expect(shown).toBe(1);
	});

	it('says nothing about deleting where nothing has been deleted', async () => {
		await open([]);
		expect(document.body.textContent).not.toContain('Recently deleted');
	});

	it('names a deleted branch by its number, its title and what comes back with it', async () => {
		await open([branch()]);

		const text = document.body.textContent ?? '';
		expect(text).toContain('Recently deleted');
		expect(text).toContain('1a');
		expect(text).toContain('The seed of the argument');
		expect(text).toContain('12 notes');
		expect(text).toContain('20 days left');
	});

	it('counts one note as one', async () => {
		await open([branch({ notes: 1 })]);
		expect(document.body.textContent).toContain('1 note ·');
	});

	it('puts one back when asked', async () => {
		await open([branch()]);

		find('Put 1a back')?.click();
		await settle();

		expect(putBack).toEqual([BRANCH]);
	});

	it('says why one did not come back, in the words it was refused in', async () => {
		await open([branch()], () => Promise.reject(new Error('That number is taken now.')));

		find('Put 1a back')?.click();
		await settle();

		expect(document.querySelector('[role="alert"]')?.textContent).toContain(
			'That number is taken now.'
		);
	});
});
