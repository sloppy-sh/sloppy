import type { GraphExport, ProfileView } from '@sloppy/types';
import { pack } from '@sloppy/vault';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	AT,
	DID,
	node,
	ref,
	useFakeApi,
	VIEWER,
	type FakeApi
} from '../stores/fake-api.test-support.js';
import { initRuntime, runtime } from '../runtime.js';
import { conversation } from '../stores/conversation.svelte.js';
import { identity } from '../stores/identity.svelte.js';
import { outlineSections } from '../stores/outline-sections.svelte.js';
import { prefs } from '../stores/prefs.svelte.js';
import { publications } from '../stores/publications.svelte.js';
import { session } from '../stores/session.svelte.js';
import { people } from '../stores/people.svelte.js';
import { aGraphFolder } from '../browser-files.test-support.js';
import { graphHere } from '../graph-here.svelte.js';
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
	localStorage.clear();
	prefs.init();
	people.hold(null);
	publications.clear();
	identity.clear();
	conversation.clear();
	outlineSections.clear();
	api = useFakeApi();
	initRuntime({ apiHost: () => 'http://api.test', saveFile: undefined });
	api.on('GET /profile/me', () => STORED);
	api.on('POST /auth/logout', () => ({}));
	api.on('GET /auth/own-instance', () => ({ instance_url: null }));
	session.adopt(VIEWER, 'a-session');
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(async () => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	if (graphHere.open) await graphHere.close();
	session.clear();
	target.remove();
	document.body.innerHTML = '';
});

const HELD: GraphExport = {
	exported_at: AT,
	did: DID,
	graphs: [{ ref: ref(9), created_by: DID, title: 'My graph', created_at: AT, updated_at: AT }],
	notes: [node(1, '1')],
	blocks: [
		{
			ref: ref(2),
			created_by: DID,
			created_at: AT,
			updated_at: AT,
			node: ref(1),
			ord: 'a0',
			content: { type: 'doc', content: [] }
		}
	]
};

describe('a copy of everything somebody keeps', () => {
	it('is offered, and handed to the shell that saves files', async () => {
		const saved: { name: string; body: Blob }[] = [];
		initRuntime({
			apiHost: () => 'http://api.test',
			saveFile: (name, body) => {
				saved.push({ name, body });
				return Promise.resolve();
			}
		});
		api.on('GET /export', () => HELD);
		mounted = mount(Settings, { target });
		flushSync();
		await settle();

		expect(target.textContent).toContain('every graph, every note');
		button('Download a copy').click();
		await settle();

		expect(api.countOf('GET /export')).toBe(1);
		expect(saved[0].name).toBe('sloppy-2026-01-01.json');
		expect(JSON.parse(await saved[0].body.text())).toEqual(HELD);
	});

	// The web shell leaves the seam alone, and the browser saves it.
	it('is saved by the browser where the shell has no saving of its own', async () => {
		const asked: { href: string; name: string }[] = [];
		const clicking = HTMLAnchorElement.prototype.click;
		HTMLAnchorElement.prototype.click = function () {
			asked.push({ href: this.href, name: this.download });
		};
		URL.createObjectURL = () => 'blob:a-copy';
		URL.revokeObjectURL = () => {};
		api.on('GET /export', () => HELD);
		mounted = mount(Settings, { target });
		flushSync();
		await settle();

		button('Download a copy').click();
		await settle();
		HTMLAnchorElement.prototype.click = clicking;

		expect(asked).toEqual([{ href: 'blob:a-copy', name: 'sloppy-2026-01-01.json' }]);
	});

	it('says so plainly where nothing can save a file', async () => {
		initRuntime({ apiHost: () => 'http://api.test', saveFile: null });
		mounted = mount(Settings, { target });
		flushSync();
		await settle();

		expect(button('Download a copy').disabled).toBe(true);
		expect(target.textContent).toContain("isn't available here yet");
	});

	it('says what to do when the copy could not be put together', async () => {
		api.on(
			'GET /export',
			() => new Response('{"message":"Sloppy could not reach your writing."}', { status: 503 })
		);
		mounted = mount(Settings, { target });
		flushSync();
		await settle();

		button('Download a copy').click();
		await settle();

		expect(target.textContent).toContain('Sloppy could not reach your writing.');
	});

	// A draft still on the device is not in it, and somebody keeping the file
	// has no other way to know that.
	it('says what a copy taken now does not hold', async () => {
		mounted = mount(Settings, { target });
		flushSync();
		await settle();

		expect(target.textContent?.replace(/\s+/g, ' ')).toContain(
			"writing still waiting on this device isn't in it yet"
		);
	});

	// An archive hands back the graph it is holding; this copy is of the account's
	// graphs, which are not the ones being read, so the two must not stand
	// together as the way to keep what somebody has written.
	it('is not offered beside a graph opened on this device', async () => {
		const bytes = pack(await aGraphFolder('The thesis'));
		initRuntime({
			apiHost: () => 'http://api.test',
			openFile: async () => new File([bytes.slice().buffer as ArrayBuffer], 'thesis.sloppy')
		});
		graphHere.offerHere();
		expect(await graphHere.openArchive()).toBe(true);
		mounted = mount(Settings, { target });
		flushSync();
		await settle();

		expect(target.textContent).toContain('Save a copy');
		expect(target.textContent).not.toContain('Download a copy');
		expect(target.textContent).not.toContain('every graph, every note');
	});

	it('is not offered to somebody who is not signed in', async () => {
		session.clear();
		mounted = mount(Settings, { target });
		flushSync();
		await settle();

		expect(target.textContent).not.toContain('Download a copy');
	});
});

describe('settings', () => {
	it('keeps the four axes of the look together', () => {
		mounted = mount(Settings, { target });
		flushSync();
		for (const legend of ['Theme', 'Accent', 'Style', 'Font']) {
			expect(target.textContent).toContain(legend);
		}
		expect(target.querySelectorAll('input[type="radio"]').length).toBe(18);
	});

	// The face is the one look choice somebody may not be able to read the page
	// without, so it is offered with nobody signed in, like the three beside it.
	it('reads the whole app in the face somebody picks, before they sign in', () => {
		session.clear();
		mounted = mount(Settings, { target });
		flushSync();

		const face = [...target.querySelectorAll<HTMLInputElement>('input[name="font"]')];
		expect(face.map((option) => option.value)).toEqual([
			'system',
			'atkinson',
			'opendyslexic',
			'apple'
		]);
		expect(target.textContent).toContain('OpenDyslexic');

		const dyslexic = face.find((option) => option.value === 'opendyslexic');
		dyslexic?.click();
		flushSync();

		expect(prefs.current.font).toBe('opendyslexic');
		expect(document.documentElement.getAttribute('data-app-font')).toBe('opendyslexic');
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
		api.on(
			`GET /nodes/${encodeURIComponent(DID)}/${encodeURIComponent(NOTE.split('/')[1])}/blocks`,
			() => []
		);
		await publications.load();
		await identity.load();
		await conversation.load(NOTE);
		outlineSections.show(NOTE, true);
		await settle();
		expect(outlineSections.of(NOTE)).toEqual([]);

		mounted = mount(Settings, { target });
		flushSync();
		await settle();
		button('Sign out').click();
		await settle();

		expect(publications.all).toEqual([]);
		expect(publications.state.loaded).toBe(false);
		expect(conversation.status(NOTE).loaded).toBe(false);
		expect(outlineSections.shown.size).toBe(0);
		expect(outlineSections.of(NOTE)).toBeUndefined();
		// Where the last person's identity was kept is asked again, never assumed.
		await identity.load();
		expect(api.countOf('GET /auth/own-instance')).toBe(2);
	});
});

function typeAddress(typed: string): void {
	const field = target.querySelector<HTMLInputElement>('#sloppy-origin');
	if (!field) throw new Error('No address field on screen');
	field.value = typed;
	field.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
	const form = field.closest('form');
	form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	flushSync();
}

describe('the way out', () => {
	// The nav pill is the way between the app's pages, and it is not under this
	// one until somebody is signed in.
	it('is on the page with nobody signed in, and leads back to signing in', async () => {
		session.clear();
		mounted = mount(Settings, { target });
		flushSync();
		await settle();

		const back = [...target.querySelectorAll('a')].find((a) => a.textContent?.includes('Back'));
		expect(back?.getAttribute('href')).toBe('/sign-in');
	});

	it('leaves the nav pill to it once somebody is signed in', async () => {
		mounted = mount(Settings, { target });
		flushSync();
		await settle();

		expect([...target.querySelectorAll('a')].some((a) => a.textContent?.includes('Back'))).toBe(
			false
		);
	});
});

describe('where your Sloppy is', () => {
	// The look axes stand without an account, and so does this: somebody whose
	// own Sloppy holds their account has to reach it before signing in.
	it('is offered with nobody signed in', async () => {
		session.clear();
		mounted = mount(Settings, { target });
		flushSync();
		await settle();

		expect(target.textContent).toContain('Where your Sloppy is');
		expect(target.querySelector('#sloppy-origin')).not.toBeNull();
	});

	it('points the app at one somebody runs themselves, and says what changed', async () => {
		mounted = mount(Settings, { target });
		flushSync();
		await settle();

		typeAddress('mine.example');
		await settle();

		expect(prefs.current.origin).toBe('https://mine.example');
		expect(runtime.apiHost()).toBe('https://mine.example');
		expect(target.textContent).toContain('Sloppy is at mine.example now');
	});

	// A session belongs to the Sloppy that opened it, and so does everything
	// read through it.
	it('ends the session and lets go of what the last one said', async () => {
		api.on('GET /publications', () => []);
		await publications.load();
		expect(publications.state.loaded).toBe(true);

		mounted = mount(Settings, { target });
		flushSync();
		await settle();

		typeAddress('https://mine.example');
		await settle();

		expect(session.signedIn).toBe(false);
		expect(people.me).toBeNull();
		expect(publications.state.loaded).toBe(false);
		expect(target.textContent).not.toContain('Ada Lovelace');
	});

	it('says what to try when that is not an address, and stays where it was', async () => {
		mounted = mount(Settings, { target });
		flushSync();
		await settle();

		typeAddress('over there somewhere');
		await settle();

		expect(target.textContent).toContain("doesn't look like a web address");
		expect(prefs.current.origin).toBeNull();
		expect(session.signedIn).toBe(true);
	});

	it('asks for an address rather than moving when nothing was typed', async () => {
		mounted = mount(Settings, { target });
		flushSync();
		await settle();

		typeAddress('');
		await settle();

		expect(target.textContent).toContain('Type the web address of your Sloppy');
		expect(target.textContent).not.toContain('back where it came from');
		expect(prefs.current.origin).toBeNull();
		expect(runtime.apiHost()).toBe('http://api.test');
		expect(session.signedIn).toBe(true);
	});

	it('leaves a session alone when the address given is the one it is already on', async () => {
		prefs.set('origin', 'https://mine.example');
		mounted = mount(Settings, { target });
		flushSync();
		await settle();

		typeAddress('mine.example');
		await settle();

		expect(target.textContent).toContain('Sloppy is already at mine.example');
		expect(prefs.current.origin).toBe('https://mine.example');
		expect(session.signedIn).toBe(true);
	});

	// A canvas is built from graphs the Sloppy being left minted, so it is not
	// carried to another one.
	it('leaves the canvas behind when the app is pointed elsewhere', async () => {
		prefs.set('graph', ref(1));
		prefs.set('alsoOnCanvas', [ref(2)]);
		mounted = mount(Settings, { target });
		flushSync();
		await settle();

		typeAddress('mine.example');
		await settle();

		expect(prefs.current.graph).toBeNull();
		expect(prefs.current.alsoOnCanvas).toEqual([]);
	});

	it('comes back to the one the app came with', async () => {
		prefs.set('origin', 'https://mine.example');
		mounted = mount(Settings, { target });
		flushSync();
		await settle();

		expect(target.querySelector<HTMLInputElement>('#sloppy-origin')?.value).toBe(
			'https://mine.example'
		);
		button('Use the one Sloppy came with').click();
		await settle();

		expect(prefs.current.origin).toBeNull();
		expect(runtime.apiHost()).toBe('http://api.test');
		expect(target.textContent).toContain('Sloppy is back where it came from');
	});
});
