import type { ProfileView } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AT, DID, ref, useFakeApi, VIEWER, type FakeApi } from '../stores/fake-api.test-support.js';
import { conversation } from '../stores/conversation.svelte.js';
import { identity } from '../stores/identity.svelte.js';
import { publications } from '../stores/publications.svelte.js';
import { session } from '../stores/session.svelte.js';
import { people } from '../stores/people.svelte.js';
import Settings from './settings.svelte';

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

async function settle(): Promise<void> {
	for (let turn = 0; turn < 4; turn += 1) {
		await new Promise((done) => setTimeout(done, 0));
		flushSync();
	}
}

function button(labelled: string): HTMLButtonElement {
	const found = [...target.querySelectorAll('button')].find((b) =>
		b.textContent?.includes(labelled)
	);
	if (!found) throw new Error(`No "${labelled}" button on screen`);
	return found;
}

beforeEach(() => {
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
	});
	people.hold(null);
	publications.clear();
	identity.clear();
	conversation.clear();
	api = useFakeApi();
	api.on('GET /profile/me', () => STORED);
	api.on('POST /auth/logout', () => ({}));
	api.on('GET /auth/own-instance', () => ({ instance_url: null }));
	session.adopt(VIEWER, 'a-session');
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	session.clear();
	target.remove();
	document.body.innerHTML = '';
});

describe('settings', () => {
	it('keeps the three axes it already had', () => {
		mounted = mount(Settings, { target });
		flushSync();
		for (const legend of ['Theme', 'Accent', 'Style']) {
			expect(target.textContent).toContain(legend);
		}
		expect(target.querySelectorAll('input[type="radio"]').length).toBe(14);
	});

	it('shows who is signed in, on the way to their page', async () => {
		mounted = mount(Settings, { target });
		flushSync();
		await settle();
		expect(target.textContent).toContain('Ada Lovelace');
		expect(target.textContent).toContain('@ada');
		expect(target.querySelector('a[href="/profile"]')).not.toBeNull();
	});

	// Nothing about the last person may be on screen for the next one.
	it('forgets them when they sign out', async () => {
		mounted = mount(Settings, { target });
		flushSync();
		await settle();
		button('Sign out').click();
		await settle();
		expect(people.me).toBeNull();
		expect(target.textContent).not.toContain('Ada Lovelace');
	});

	// What one person could reach depends on who they are, and a second sign-in
	// on the same device does not reload the app.
	it('lets go of what was read as them, so the next person reads for themselves', async () => {
		const NOTE = ref(1);
		api.on('GET /publications', () => [
			{
				ref: ref(10),
				created_by: DID,
				created_at: AT,
				updated_at: AT,
				root: NOTE,
				root_address: '1',
				comments: 'anyone' as const,
				latest: { ref: ref(20), sequence: 1, published_at: AT }
			}
		]);
		api.on(
			`GET /nodes/${encodeURIComponent(DID)}/${encodeURIComponent(NOTE.split('/')[1])}/comments`,
			() => []
		);
		api.on(
			`GET /nodes/${encodeURIComponent(DID)}/${encodeURIComponent(NOTE.split('/')[1])}/reactions`,
			() => []
		);
		await publications.load();
		await identity.load();
		await conversation.load(NOTE);

		mounted = mount(Settings, { target });
		flushSync();
		await settle();
		button('Sign out').click();
		await settle();

		expect(publications.all).toEqual([]);
		expect(publications.state.loaded).toBe(false);
		expect(conversation.status(NOTE).loaded).toBe(false);
		// Where the last person's identity was kept is asked again, never assumed.
		await identity.load();
		expect(api.countOf('GET /auth/own-instance')).toBe(2);
	});
});
