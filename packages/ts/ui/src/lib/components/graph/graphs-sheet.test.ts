// @vitest-environment jsdom
import type { OwnedRef } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import GraphsSheet, { type DeletedChoice } from './graphs-sheet.svelte';

const HOME = 'did:syr:z6MkAda/00000000000000000000000000' as OwnedRef;
const GARDEN = 'did:syr:z6MkAda/01ARZ3NDEKTSV4RRFFQ69G5FAV' as OwnedRef;
const BRANCH = 'did:syr:z6MkAda/01ARZ3NDEKTSV4RRFFQ69G5FAW' as OwnedRef;
const OTHER = 'did:syr:z6MkAda/01ARZ3NDEKTSV4RRFFQ69G5FAX' as OwnedRef;

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let putBack: OwnedRef[];
let closed: OwnedRef[];
let shown: number;

const branch = (over: Partial<DeletedChoice> = {}): DeletedChoice => ({
	ref: BRANCH,
	address: '1a',
	graph: HOME,
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
	},
	onRemove: (ref: OwnedRef) => Promise<void> = () => Promise.resolve(),
	publishedFrom: ReadonlySet<OwnedRef> | undefined = undefined
): Promise<void> {
	if (mounted) unmount(mounted, { outro: false });
	document.body.innerHTML = '';
	target = document.createElement('div');
	document.body.appendChild(target);
	putBack = [];
	closed = [];
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
			home: HOME,
			alsoUp: new Set<OwnedRef>(),
			deleted,
			publishedFrom,
			onEnter: () => {},
			onToggle: () => {},
			onOpen: () => Promise.resolve(),
			onRename: () => Promise.resolve(),
			onRemove: (ref: OwnedRef) => {
				closed.push(ref);
				return onRemove(ref);
			},
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

/** The button in the question a destructive act is asked through. */
const confirm = (words: string): HTMLElement | null =>
	[...document.querySelectorAll<HTMLElement>('button')].find(
		(button) => button.textContent?.trim() === words
	) ?? null;

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
		expect(text).toContain('My graph');
	});

	it('tells apart two branches at the same number in different graphs', async () => {
		await open([branch(), branch({ ref: OTHER, graph: GARDEN, title: 'The other one' })]);

		expect(find('Put 1a in My graph back')).not.toBeNull();
		expect(find('Put 1a in Garden back')).not.toBeNull();

		find('Put 1a in Garden back')?.click();
		await settle();

		expect(putBack).toEqual([OTHER]);
	});

	// AI.md § "The Genealogy Is the Protocol": a branch whose number went to
	// another note waits under its title, with nothing standing where one was.
	it('names a branch with no number by its title alone', async () => {
		await open([branch({ address: undefined, title: 'The seed of the argument' })]);

		expect(document.body.querySelector('.address')).toBeNull();
		expect(document.body.textContent).toContain('The seed of the argument');
		expect(find('Put The seed of the argument in My graph back')).not.toBeNull();
	});

	it('counts one note as one', async () => {
		await open([branch({ notes: 1 })]);
		expect(document.body.textContent).toContain('1 note ·');
	});

	it('puts one back when asked', async () => {
		await open([branch()]);

		find('Put 1a in My graph back')?.click();
		await settle();

		expect(putBack).toEqual([BRANCH]);
	});

	it('offers no way to close the graph somebody started with', async () => {
		await open([]);
		expect(find('Close My graph')).toBeNull();
		expect(find('Close Garden')).not.toBeNull();
	});

	it('asks before closing a graph, naming what goes and what stays out', async () => {
		await open([]);

		find('Close Garden')?.click();
		await settle();

		const text = document.body.textContent ?? '';
		expect(text).toContain('Close Garden?');
		expect(text).toContain('they cannot be put back');
		expect(text).toContain('Whoever already has a branch you published from it keeps their copy');
		expect(closed).toEqual([]);
	});

	it('leaves out what a peer keeps where nothing went out of that graph', async () => {
		await open([], undefined, undefined, new Set([HOME]));

		find('Close Garden')?.click();
		await settle();

		const text = document.body.textContent ?? '';
		expect(text).toContain('they cannot be put back');
		expect(text).not.toContain('keeps their copy');
	});

	it('says what a peer keeps where a branch went out of that graph', async () => {
		await open([], undefined, undefined, new Set([GARDEN]));

		find('Close Garden')?.click();
		await settle();

		expect(document.body.textContent).toContain(
			'Whoever already has a branch you published from it keeps their copy'
		);
	});

	it('holds a graph name to the length one can be saved at', async () => {
		await open([]);

		const naming = [...document.querySelectorAll<HTMLInputElement>('input')].filter(
			(input) => input.maxLength === 512
		);
		expect(naming.length).toBe(1);

		find('Rename Garden')?.click();
		await settle();

		expect(
			[...document.querySelectorAll<HTMLInputElement>('input')].filter(
				(input) => input.maxLength === 512
			).length
		).toBe(2);
	});

	it('offers the graph’s own settings behind one door, and puts a refused choice back', async () => {
		let refuse = true;
		if (mounted) unmount(mounted, { outro: false });
		document.body.innerHTML = '';
		target = document.createElement('div');
		document.body.appendChild(target);
		mounted = mount(GraphsSheet, {
			target,
			props: {
				open: true,
				graphs: [
					{ ref: HOME, title: 'My graph' },
					{ ref: GARDEN, title: 'Garden' }
				],
				current: HOME,
				home: HOME,
				alsoUp: new Set<OwnedRef>(),
				onEnter: () => {},
				onToggle: () => {},
				onOpen: () => Promise.resolve(),
				onRename: () => Promise.resolve(),
				onOwnership: () =>
					refuse ? Promise.reject(new Error('That did not save.')) : Promise.resolve()
			}
		});
		await settle();

		find('Settings for Garden')?.click();
		await settle();

		const owned = document.querySelector<HTMLButtonElement>('[role="switch"]');
		if (!owned) throw new Error('The graph offers no choice about what a new note carries');
		expect(owned.getAttribute('aria-checked')).toBe('false');

		owned.click();
		await settle();

		expect(owned.getAttribute('aria-checked')).toBe('false');
		expect(document.body.textContent).toContain('That did not save.');

		refuse = false;
		owned.click();
		await settle();

		expect(owned.getAttribute('aria-checked')).toBe('true');
	});

	it('closes it once the question is answered', async () => {
		await open([]);

		find('Close Garden')?.click();
		await settle();
		confirm('Close it')?.click();
		await settle();

		expect(closed).toEqual([GARDEN]);
	});

	it('says why one did not close, in the words it was refused in', async () => {
		await open([], undefined, () => Promise.reject(new Error('That graph is not here.')));

		find('Close Garden')?.click();
		await settle();
		confirm('Close it')?.click();
		await settle();

		const said = [...document.querySelectorAll('[role="alert"]')].map((one) => one.textContent);
		expect(said).toEqual(['That graph is not here.']);

		confirm('Cancel')?.click();
		await settle();
		expect(document.querySelector('[role="alert"]')).toBeNull();
	});

	it('says why one did not come back, in the words it was refused in', async () => {
		await open([branch()], () => Promise.reject(new Error('That number is taken now.')));

		find('Put 1a in My graph back')?.click();
		await settle();

		expect(document.querySelector('[role="alert"]')?.textContent).toContain(
			'That number is taken now.'
		);
	});
});
