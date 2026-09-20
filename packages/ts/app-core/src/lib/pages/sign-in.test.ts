import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initRuntime } from '../runtime.js';
import { useFakeApi, type FakeApi } from '../stores/fake-api.test-support.js';
import SignIn from './sign-in.svelte';

const HERE = 'https://sloppy.test';

let api: FakeApi;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

async function settle(): Promise<void> {
	for (let turn = 0; turn < 6; turn += 1) await new Promise((done) => setTimeout(done, 0));
	flushSync();
}

async function show(): Promise<void> {
	mounted = mount(SignIn, { target });
	flushSync();
	await settle();
}

function press(label: string): void {
	const button = [...target.querySelectorAll('button')].find(
		(one) => one.textContent?.trim() === label
	);
	if (!button) throw new Error(`No "${label}" button on the page`);
	button.click();
	flushSync();
}

function unavailable(): Response {
	return new Response(JSON.stringify({ message: 'Try again in a moment.' }), {
		status: 503,
		headers: { 'content-type': 'application/json' }
	});
}

beforeEach(() => {
	api = useFakeApi();
	target = document.createElement('div');
	document.body.append(target);
});

afterEach(() => {
	if (mounted) unmount(mounted);
	mounted = undefined;
	target.remove();
});

// Somebody with no identity anywhere reaches this page with nothing to type in
// the box, so the offer of one is the only way through it.
describe('the sign-in page', () => {
	it('offers the identity this Sloppy hosts', async () => {
		api.on('GET /auth/own-instance', () => ({ instance_url: HERE }));

		await show();

		expect(target.textContent).toContain('Start here');
	});

	it('shows what an address looks like without naming what runs at one', async () => {
		api.on('GET /auth/own-instance', () => ({ instance_url: HERE }));

		await show();

		const box = target.querySelector<HTMLInputElement>('#instance');
		expect(box?.placeholder).toBe('https://sloppy.example');
	});

	it('says nothing where this Sloppy hosts none', async () => {
		api.on('GET /auth/own-instance', () => ({ instance_url: null }));

		await show();

		expect(target.textContent).not.toContain('Start here');
		expect(target.textContent).not.toContain('Try again');
	});

	// The two used to look alike, which took the only way in off the page and
	// said nothing about why it had gone.
	it('says so, and offers another go, where it could not be asked', async () => {
		api.on('GET /auth/own-instance', () => unavailable());

		await show();

		expect(target.textContent).toContain('Sloppy could not offer you an identity here just now.');
		expect(target.textContent).toContain('Try again');
	});

	// A webview's own origin is not an address the system browser can navigate
	// back to, so the shell says where consent should put somebody down.
	describe('and where it says to come back to', () => {
		let asked: { redirect?: string } = {};

		beforeEach(() => {
			asked = {};
			api.on('GET /auth/own-instance', () => ({ instance_url: HERE }));
			api.on('POST /auth/login', (_url, init) => {
				asked = JSON.parse(String(init?.body));
				return { consent_url: 'https://syr.test/consent' };
			});
		});

		it('is the page it is on where the shell names nothing', async () => {
			initRuntime({
				apiHost: () => 'http://api.test',
				openExternal: () => {},
				signInRedirect: undefined
			});
			await show();

			press('Start here');
			await settle();

			expect(asked.redirect).toBe(`${location.origin}/`);
		});

		it('is what the shell names where it names one', async () => {
			initRuntime({
				apiHost: () => 'http://api.test',
				openExternal: () => {},
				signInRedirect: () => 'sloppy://auth/callback'
			});
			await show();

			press('Start here');
			await settle();

			expect(asked.redirect).toBe('sloppy://auth/callback');
		});

		// The window stays put while the consent page is somewhere else, so a
		// person who comes back without finishing must be able to try again.
		it('leaves the doors open once the consent page is somewhere else', async () => {
			initRuntime({
				apiHost: () => 'http://api.test',
				openExternal: () => {},
				signInRedirect: () => 'sloppy://auth/callback'
			});
			await show();

			press('Start here');
			await settle();

			const shut = [...target.querySelectorAll('button')].filter((one) => one.disabled);
			expect(shut).toEqual([]);
		});
	});

	it('offers the identity once the answer can be had', async () => {
		api.on('GET /auth/own-instance', () => unavailable());
		await show();

		api.on('GET /auth/own-instance', () => ({ instance_url: HERE }));
		press('Try again');
		await settle();

		expect(target.textContent).toContain('Start here');
		expect(target.textContent).not.toContain('Try again');
	});
});
