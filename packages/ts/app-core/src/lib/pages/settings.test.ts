import type { ProfileView } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DID, useFakeApi, VIEWER, type FakeApi } from '../stores/fake-api.test-support.js';
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
	api = useFakeApi();
	api.on('GET /profile/me', () => STORED);
	api.on('POST /auth/logout', () => ({}));
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
});
