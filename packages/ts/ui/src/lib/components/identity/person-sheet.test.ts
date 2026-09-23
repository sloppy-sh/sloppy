// @vitest-environment jsdom
import type { OwnedRef, PublishedPublication } from '@sloppy/types';
import type { ComponentProps } from 'svelte';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import type { PublishedThere } from '../peers/peer.js';
import type { Person } from './person.js';
import PersonSheet from './person-sheet.svelte';

const THEM = 'did:syr:z6MkfZ3Uc1nUxUeaKvcVjNbBidsWv5tvfAv1TFuxNvcbXeaC';
const AT = '2026-01-01T00:00:00.000Z';

const CHARLES: Person = {
	identity: 'did:syr:z6MkCharlesCharlesCharlesCharlesChar',
	displayName: 'Charles Babbage',
	handle: 'charles',
	bio: 'Notes on the engine.',
	avatar: null,
	banner: null
};

const branch = (over: Partial<PublishedPublication> = {}): PublishedPublication => ({
	ref: `${THEM}/01ARZ3NDEKTSV4RRFFQ69G5FAV` as OwnedRef,
	root_address: '1a',
	title: 'The seed of the argument',
	latest: {
		ref: `${THEM}/01ARZ3NDEKTSV4RRFFQ69G5FAW` as OwnedRef,
		sequence: 1,
		published_at: AT
	},
	...over
});

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let copied: string[];

async function settle(): Promise<void> {
	for (let turn = 0; turn < 4; turn += 1) {
		flushSync();
		await new Promise((done) => setTimeout(done, 0));
	}
	flushSync();
}

async function open(over: Partial<ComponentProps<typeof PersonSheet>> = {}): Promise<void> {
	mounted = mount(PersonSheet, {
		target,
		props: {
			open: true,
			identity: THEM,
			person: CHARLES,
			following: false,
			onLook: () => Promise.resolve<PublishedThere>({ identity: THEM, publications: [branch()] }),
			onPull: () => {},
			onFollow: () => {},
			onUnfollow: () => {},
			...over
		}
	});
	await settle();
}

const named = (words: string): HTMLElement | undefined =>
	[...document.querySelectorAll<HTMLElement>('button')].find((one) =>
		one.textContent?.includes(words)
	);

const labelled = (label: string): HTMLElement | null =>
	document.querySelector<HTMLElement>(`[aria-label="${label}"]`);

beforeEach(() => {
	stubMediaQuery((query) => query.includes('min-width'));
	stubResizeObserver();
	copied = [];
	Object.defineProperty(globalThis.navigator, 'clipboard', {
		configurable: true,
		value: {
			writeText: (words: string) => {
				copied.push(words);
				return Promise.resolve();
			}
		}
	});
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	document.body.innerHTML = '';
});

describe('meeting somebody', () => {
	it('shows who they are and what they publish', async () => {
		await open();
		const text = document.body.textContent ?? '';
		expect(text).toContain('Charles Babbage');
		expect(text).toContain('@charles');
		expect(text).toContain('Notes on the engine.');
		expect(text).toContain('1a');
		expect(text).toContain('The seed of the argument');
	});

	it('asks what they publish once when it opens', async () => {
		let asked = 0;
		await open({
			onLook: () => {
				asked += 1;
				return Promise.resolve<PublishedThere>({ identity: THEM, publications: [] });
			}
		});
		expect(asked).toBe(1);
	});

	it('follows them, and offers the way back once they are followed', async () => {
		const followed: string[] = [];
		await open({ onFollow: () => followed.push(THEM) });
		named('Follow')?.click();
		await settle();
		expect(followed).toEqual([THEM]);

		unmount(mounted!, { outro: false });
		mounted = undefined;
		document.body.innerHTML = '';
		target = document.createElement('div');
		document.body.appendChild(target);

		const stopped: string[] = [];
		await open({ following: true, onUnfollow: () => stopped.push(THEM) });
		named('Stop following')?.click();
		await settle();
		expect(stopped).toEqual([THEM]);
	});

	it('takes a copy of one of their branches', async () => {
		const pulled: OwnedRef[] = [];
		await open({ onPull: (publication) => pulled.push(publication) });
		named('Read it')?.click();
		await settle();
		expect(pulled).toEqual([branch().ref]);
	});

	it('shows the whole identity, and hands it over on a tap', async () => {
		await open();
		expect(document.body.textContent).toContain(THEM);
		labelled('Copy their identity')?.click();
		await settle();
		expect(copied).toEqual([THEM]);
	});

	it('stands the identifier in for somebody nobody could place', async () => {
		await open({ person: null });
		const text = document.body.textContent ?? '';
		expect(text).toContain('Nobody here could say who this is.');
		expect(text).toContain('z6MkfZ3U');
		expect(named('Follow')).not.toBeUndefined();
	});
});
