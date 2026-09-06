import type { ProfileView, PublishedPublication } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AT, ref, useFakeApi, VIEWER, type FakeApi } from '../stores/fake-api.test-support.js';
import { peers } from '../stores/peers.svelte.js';
import { people } from '../stores/people.svelte.js';
import { session } from '../stores/session.svelte.js';
import { asking } from './person-surface.test-support.svelte.js';
import PersonSurface from './person-surface.svelte';

const PEER = 'did:syr:z6MkjChhrJfLm9WGVUAnyLPnfPGmZDcyDKNsBTsAsn7RkAqB';

const THEIR_BRANCH: PublishedPublication = {
	ref: ref(3, PEER),
	root_address: '1a',
	title: 'The seed of the argument',
	latest: { ref: ref(4, PEER), sequence: 1, published_at: AT }
};

const THEM: ProfileView = {
	did: PEER,
	username: 'charles',
	display_name: 'Charles Babbage',
	bio: null,
	avatar_src: null,
	banner_src: null
};

let api: FakeApi;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
/** What the surface is asked about, as a caller holds it. */
let asked: { did: string | null };

async function settle(): Promise<void> {
	for (let turn = 0; turn < 4; turn += 1) {
		await new Promise((done) => setTimeout(done, 0));
		flushSync();
	}
}

function show(did: string | null): void {
	asked = asking(did);
	mounted = mount(PersonSurface, {
		target,
		props: {
			get did() {
				return asked.did;
			},
			set did(next: string | null) {
				asked.did = next;
			}
		}
	});
	flushSync();
}

const says = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

beforeEach(() => {
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			matches: query.includes('min-width'),
			addEventListener: () => {},
			removeEventListener: () => {}
		})
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
	people.hold(null);
	peers.clear();
	session.clear();
	session.adopt(VIEWER, 'a-session');
	api = useFakeApi();
	api.on(`GET /profile/${encodeURIComponent(PEER)}`, () => THEM);
	api.on('GET /following', () => []);
	api.on('GET /pulls', () => []);
	api.on('GET /peers/publications', () => ({ did: PEER, publications: [THEIR_BRANCH] }));
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
});

describe('meeting somebody a surface named', () => {
	it('opens on whoever it was handed, with what they publish', async () => {
		show(PEER);
		await settle();

		expect(says()).toContain('Charles Babbage');
		expect(says()).toContain('1a');
		expect(says()).toContain('The seed of the argument');
		expect(says()).toContain('Follow');
	});

	// The instance to ask is read off the reader's follows, so the sheet waits
	// for those rather than asking this instance about a stranger.
	it('asks the instance they were followed from, not this one', async () => {
		api.on('GET /following', () => [{ did: PEER, provider_url: 'https://elsewhere.test' }]);
		show(PEER);
		await settle();

		const looked = api.calls.find((call) => call.startsWith('GET /peers/publications'));
		expect(looked).toBeDefined();
		expect(new URL(looked!, 'http://api.test').searchParams.get('source_url')).toBe(
			'https://elsewhere.test'
		);
	});

	it('opens nothing until it is handed somebody', async () => {
		show(null);
		await settle();

		expect(says().trim()).toBe('');
		expect(api.calls).toHaveLength(0);
	});

	it('opens nothing on the reader themselves', async () => {
		show(VIEWER.did);
		await settle();

		expect(says().trim()).toBe('');
	});

	it('lets the person go when the reader closes the sheet', async () => {
		show(PEER);
		await settle();

		const close = [...document.body.querySelectorAll('button')].find((one) =>
			(one.getAttribute('aria-label') ?? one.textContent ?? '').includes('Close')
		);
		expect(close).toBeDefined();
		close!.click();
		await settle();

		expect(asked.did).toBeNull();
	});
});
