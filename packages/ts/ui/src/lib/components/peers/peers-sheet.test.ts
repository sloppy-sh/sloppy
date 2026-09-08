// @vitest-environment jsdom
import type { OwnedRef, Timestamp } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import type { Person } from '../identity/person.js';
import type { Answered, HeldRegion, Peer, PublishedThere } from './peer.js';
import PeersSheet from './peers-sheet.svelte';

const ADA = 'did:syr:z6MkAdaAdaAdaAdaAdaAdaAdaAdaAdaAda';
const BRAM = 'did:syr:z6MkBramBramBramBramBramBramBramBra';
const CARL = 'did:syr:z6MkCarlCarlCarlCarlCarlCarlCarlCar';
const REGION = `${ADA}/01ARZ3NDEKTSV4RRFFQ69G5FAV` as OwnedRef;
const OTHER = `${BRAM}/01ARZ3NDEKTSV4RRFFQ69G5FAW` as OwnedRef;

const ADA_PERSON: Person = {
	displayName: 'Ada Lovelace',
	handle: 'ada',
	bio: null,
	avatar: null,
	banner: null
};

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let asked: { who: string; where: string | undefined }[];
let dropped: OwnedRef[];
let unfollowed: string[];

const region = (over: Partial<HeldRegion> = {}): HeldRegion => ({
	ref: REGION,
	identity: ADA,
	person: ADA_PERSON,
	publication: `${ADA}/01ARZ3NDEKTSV4RRFFQ69G5FB0` as OwnedRef,
	address: '1a',
	version: {
		ref: `${ADA}/01ARZ3NDEKTSV4RRFFQ69G5FB1` as OwnedRef,
		sequence: 1,
		published_at: '2026-01-01T00:00:00.000Z' as Timestamp
	},
	readAt: '2026-01-02T00:00:00.000Z' as Timestamp,
	from: 'https://peer.example',
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
	props: { regions?: HeldRegion[]; following?: Peer[]; answers?: Answered[] } = {}
): Promise<void> {
	if (mounted) unmount(mounted, { outro: false });
	document.body.innerHTML = '';
	target = document.createElement('div');
	document.body.appendChild(target);
	asked = [];
	dropped = [];
	unfollowed = [];
	mounted = mount(PeersSheet, {
		target,
		props: {
			open: true,
			regions: props.regions ?? [],
			following: props.following ?? [],
			answers: props.answers ?? [],
			onEnter: () => {},
			onDrop: (ref: OwnedRef) => dropped.push(ref),
			onLook: (who: string, where: string | undefined): Promise<PublishedThere | null> => {
				asked.push({ who, where });
				return Promise.resolve({ identity: who, publications: [] });
			},
			onPull: () => {},
			onRefresh: () => {},
			onChain: () => Promise.resolve(null),
			onChanges: () => Promise.resolve(null),
			onFollow: () => {},
			onUnfollow: (identity: string) => unfollowed.push(identity)
		}
	});
	await settle();
}

const find = (label: string): HTMLElement | null =>
	document.querySelector<HTMLElement>(`[aria-label="${label}"]`);

const type = (label: string, words: string): void => {
	const box = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
	if (!box) throw new Error(`No ${label} to type into`);
	box.value = words;
	box.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
};

const press = (words: string): void => {
	const button = [...document.querySelectorAll<HTMLElement>('button')].find(
		(one) => one.textContent?.trim() === words
	);
	button?.click();
};

beforeEach(() => {
	stubMediaQuery((query) => query.includes('min-width'));
	stubResizeObserver();
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	document.body.innerHTML = '';
});

describe('a branch somebody else published', () => {
	it('names the person who wrote it', async () => {
		await open({ regions: [region()] });
		expect(document.body.textContent).toContain('Ada Lovelace');
		expect(document.body.textContent).not.toContain(ADA);
	});

	// Two strangers nobody could place are still two, so the identifier stays
	// readable under whatever stands in for their name.
	it('says Somebody while their name is still on its way, with the identifier beside it', async () => {
		await open({ regions: [region({ person: null })] });

		const text = document.body.textContent ?? '';
		expect(text).toContain('Somebody');
		expect(text).toContain(ADA);
	});

	it('draws the letters they travel by once nobody could be placed there', async () => {
		await open({ regions: [region({ person: null, unplaced: true })] });

		const text = document.body.textContent ?? '';
		expect(text).toContain('z6MkAdaA…aAda');
		expect(text).not.toContain('Somebody');
		expect(text).toContain(ADA);
	});

	it('names the branch each button acts on', async () => {
		await open({
			regions: [region(), region({ ref: OTHER, address: '3b2', identity: BRAM, person: null })]
		});

		expect(find('Stop holding 1a')).not.toBeNull();
		expect(find('Stop holding 3b2')).not.toBeNull();
		expect(find('Read 1a again')).not.toBeNull();

		find('Stop holding 3b2')?.click();
		await settle();
		expect(dropped).toEqual([OTHER]);
	});

	// A branch its author never numbered is held like any other: nothing is
	// cited by an address that is not there, and whose branch it is tells one
	// row from the next.
	it('holds a region its author gave no address', async () => {
		await open({
			regions: [
				region({ address: undefined }),
				region({ ref: OTHER, address: undefined, identity: BRAM, person: null })
			]
		});

		const text = document.body.textContent ?? '';
		expect(text).toContain('Ada Lovelace');
		expect(text).not.toContain('undefined');
		expect(find("Read Ada Lovelace's branch again")).not.toBeNull();
		expect(find("Stop holding Somebody's branch")).not.toBeNull();

		find("Stop holding Ada Lovelace's branch")?.click();
		await settle();
		expect(dropped).toEqual([REGION]);
	});
});

describe("a note of the reader's own that somebody answered", () => {
	const answered = (over: Partial<Answered> = {}): Answered => ({
		note: OTHER,
		address: '2b',
		title: 'Spores',
		graph: `${BRAM}/01ARZ3NDEKTSV4RRFFQ69G5FC0` as OwnedRef,
		voices: [{ identity: ADA, person: ADA_PERSON }],
		...over
	});

	it('is named by the address it is cited at, and by who answered it', async () => {
		await open({ answers: [answered()] });

		const shown = document.body.textContent ?? '';
		expect(shown).toContain('2b');
		expect(shown).toContain('Spores');
		expect(shown).toContain('Ada Lovelace');
	});

	it('is named by its title alone where it has no address', async () => {
		const bare = answered();
		delete bare.address;
		await open({ answers: [bare] });

		const shown = document.body.textContent ?? '';
		expect(shown).toContain('Spores');
		expect(document.body.querySelector('.address')).toBeNull();
	});
});

describe('who the reader follows', () => {
	it('names each one on the button that stops following them', async () => {
		await open({
			following: [
				{ identity: ADA, person: ADA_PERSON },
				{ identity: BRAM, person: null, unplaced: true },
				{ identity: CARL, person: null }
			]
		});

		expect(find('Stop following Ada Lovelace')).not.toBeNull();
		expect(find('Stop following z6MkBram…mBra')).not.toBeNull();
		expect(find('Stop following Somebody')).not.toBeNull();

		find('Stop following Ada Lovelace')?.click();
		await settle();
		expect(unfollowed).toEqual([ADA]);
	});
});

describe('finding somebody', () => {
	it('hands who and where over as the two things they were typed as', async () => {
		await open();

		type('Who to read', 'alice');
		type('Where their graph is', 'https://peer.example');
		press('See what they publish');
		await settle();

		expect(asked).toEqual([{ who: 'alice', where: 'https://peer.example' }]);
	});

	it('asks here where the second line is left empty', async () => {
		await open();

		type('Who to read', 'alice');
		press('See what they publish');
		await settle();

		expect(asked).toEqual([{ who: 'alice', where: undefined }]);
	});

	it('says what a web address looks like where the second line is not one', async () => {
		await open();

		type('Who to read', 'alice');
		type('Where their graph is', 'not a place');
		press('See what they publish');
		await settle();

		expect(document.querySelector('[role="alert"]')?.textContent).toContain(
			'That does not look like a web address'
		);
		expect(asked).toEqual([]);
	});
});
