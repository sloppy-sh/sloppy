import {
	HOME_GRAPH_TITLE,
	type OwnedRef,
	type ProfileView,
	type PublicationView
} from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	AT,
	DID,
	node,
	ref,
	ulid,
	useFakeApi,
	type FakeApi
} from '../stores/fake-api.test-support.js';
import { graphs } from '../stores/graphs.svelte.js';
import { nodes } from '../stores/nodes.svelte.js';
import { people } from '../stores/people.svelte.js';
import { publications } from '../stores/publications.svelte.js';
import Profile from './profile.svelte';

const ROOT = ref(1);

const PUBLISHED: PublicationView = {
	ref: ref(7),
	created_by: DID,
	created_at: AT,
	updated_at: AT,
	root: ROOT,
	root_address: '1',
	comments: 'anyone',
	latest: { ref: ref(8), sequence: 1, published_at: AT }
};

const STORED: ProfileView = {
	did: DID,
	username: 'ada',
	display_name: 'Ada Lovelace',
	bio: null,
	avatar_src: null,
	banner_src: null
};

let api: FakeApi;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function stubBrowser(): void {
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
	});
	Object.defineProperty(globalThis, 'ResizeObserver', {
		configurable: true,
		writable: true,
		value: class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	});
}

/** Past the profile read, the branch reads it fans out into, and the render. */
async function settle(): Promise<void> {
	for (let turn = 0; turn < 4; turn += 1) {
		await new Promise((done) => setTimeout(done, 0));
		flushSync();
	}
}

function open(): void {
	mounted = mount(Profile, { target });
	flushSync();
}

function button(labelled: string): HTMLButtonElement {
	const found = [...target.querySelectorAll('button')].find((b) =>
		b.textContent?.includes(labelled)
	);
	if (!found) throw new Error(`No "${labelled}" button on screen`);
	return found;
}

beforeEach(() => {
	stubBrowser();
	nodes.clear();
	graphs.clear();
	publications.clear();
	people.hold(null);
	api = useFakeApi();
	api.on('GET /profile/me', () => STORED);
	api.on('GET /graphs', () => [
		{
			ref: `${DID}/01ARZ3NDEKTSV4RRFFQ69G5HMM` as OwnedRef,
			created_by: DID,
			created_at: AT,
			updated_at: AT,
			title: HOME_GRAPH_TITLE
		}
	]);
	api.on('GET /nodes', (url) =>
		url.searchParams.get('origin')
			? [node(1, '1'), node(2, '1a', { origin: ROOT, parent: ROOT })]
			: [node(1, '1')]
	);
	api.on(`GET /nodes/${encodeURIComponent(DID)}/${ulid(1)}`, () => ({
		...node(1, '1'),
		title: 'The seed of the argument'
	}));
	api.on('GET /publications', () => [PUBLISHED]);
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
});

describe('the page a person is on', () => {
	it('shows what their identity store says they are called', async () => {
		open();
		await settle();
		expect(target.textContent).toContain('Ada Lovelace');
		expect(target.textContent).toContain('@ada');
	});

	// The one identifier the product shows: a peer resolves it to follow them.
	it('shows the name a peer would follow them by', async () => {
		open();
		await settle();
		expect(target.textContent).toContain(DID);
	});

	// It is asked for on another surface entirely, so the page it is shown on is
	// where somebody learns what it is for.
	it('says what to do with it', async () => {
		open();
		await settle();
		expect(target.textContent).toContain(
			'Hand this to somebody who wants to read what you publish'
		);
	});

	it('shows the branches a peer can read, and who may answer each', async () => {
		open();
		await settle();
		const text = target.textContent ?? '';
		expect(text).toContain('What you publish');
		expect(text).toContain('1');
		expect(text).toContain('The seed of the argument');
		expect(text).toContain('Anyone reading it can answer');
	});

	it('opens the note the branch is rooted at', async () => {
		open();
		await settle();
		const row = target.querySelector<HTMLAnchorElement>('a[href^="/n/"]');
		expect(row?.getAttribute('href')).toBe(
			`/n/${encodeURIComponent(DID)}/${encodeURIComponent(ulid(1))}`
		);
	});

	// The page says what a peer can read, so it costs what that list costs and
	// never a walk of everything the person has written.
	it('reads no subtree to say it', async () => {
		open();
		await settle();
		expect(api.calls.filter((call) => call.includes('origin='))).toEqual([]);
	});

	it('says what publishing one would mean where nothing is published yet', async () => {
		api.on('GET /publications', () => []);
		open();
		await settle();
		expect(target.textContent).toContain('read by anyone who has its address');
	});

	it('hands the identity over on a tap', async () => {
		const copied: string[] = [];
		Object.defineProperty(globalThis.navigator, 'clipboard', {
			configurable: true,
			value: {
				writeText: (words: string) => {
					copied.push(words);
					return Promise.resolve();
				}
			}
		});
		open();
		await settle();
		target.querySelector<HTMLElement>('[aria-label="Copy your identity"]')?.click();
		await settle();
		expect(copied).toEqual([DID]);
	});

	it('asks the store once, however many surfaces want the answer', async () => {
		open();
		await settle();
		unmount(mounted!, { outro: false });
		mounted = undefined;
		open();
		await settle();
		expect(api.countOf('GET /profile/me')).toBe(1);
	});

	it('writes a new name through and shows the store’s answer, not the typing', async () => {
		api.on('PATCH /profile/me', () => ({ ...STORED, display_name: 'Ada' }));
		open();
		await settle();
		button('Edit').click();
		flushSync();
		const name = target.querySelector<HTMLInputElement>('#person-name');
		if (!name) throw new Error('No name field on screen');
		name.value = 'Ada King';
		name.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		target.querySelector('form')?.requestSubmit();
		await settle();
		expect(api.countOf('PATCH /profile/me')).toBe(1);
		expect(target.textContent).toContain('Ada');
		expect(target.textContent).not.toContain('Ada King');
	});

	it('says what to choose instead when the file is not a picture, and sends nothing', async () => {
		open();
		await settle();
		button('Edit').click();
		flushSync();
		const picker = target.querySelector<HTMLInputElement>('input[type="file"]');
		if (!picker) throw new Error('No picture picker on screen');
		Object.defineProperty(picker, 'files', {
			configurable: true,
			value: [new File(['{}'], 'notes.json', { type: 'application/json' })]
		});
		picker.dispatchEvent(new Event('change', { bubbles: true }));
		await settle();
		expect(target.textContent).toContain('Choose an image file.');
		expect(api.countOf('POST /media/uploads')).toBe(0);
	});

	it('says what to do instead when the store refuses the change', async () => {
		open();
		await settle();
		button('Edit').click();
		flushSync();
		target.querySelector('form')?.requestSubmit();
		await settle();
		expect(target.textContent).toContain('Nothing lives at that address.');
	});
});
