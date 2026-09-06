import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { node, useFakeApi, VIEWER, type FakeApi } from '../stores/fake-api.test-support.js';
import { nodes } from '../stores/nodes.svelte.js';
import { session } from '../stores/session.svelte.js';
import Frame from './frame.test-support.svelte';

const where = vi.hoisted(() => ({ url: new URL('http://app.test/'), gone: [] as string[] }));

vi.mock('$app/state', () => ({
	page: {
		get url() {
			return where.url;
		},
		state: {}
	}
}));

vi.mock('$app/navigation', () => ({
	goto: (to: string) => {
		where.gone.push(to);
		return Promise.resolve();
	},
	replaceState: () => {}
}));

let api: FakeApi;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

async function settle(): Promise<void> {
	for (let turn = 0; turn < 6; turn += 1) await new Promise((done) => setTimeout(done, 0));
	flushSync();
}

function stubViewport(): void {
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

async function show(): Promise<void> {
	stubViewport();
	// The store is a singleton across this file, so the ask that `onMount` would
	// make is made here instead — `load()` inside the frame answers from it.
	await session.refresh();
	mounted = mount(Frame, { target });
	flushSync();
	await settle();
}

function press(label: string): void {
	const button = [...target.querySelectorAll('button')].find(
		(one) => one.textContent?.trim() === label
	);
	if (!button) throw new Error(`No "${label}" button on screen`);
	button.click();
	flushSync();
}

/** Where the chrome around the page can take somebody. */
function reachable(): string[] {
	return [...document.body.querySelectorAll('nav a')].map((to) => to.getAttribute('href') ?? '');
}

function unavailable(): Response {
	return new Response(JSON.stringify({ message: 'Try again in a moment.' }), {
		status: 503,
		headers: { 'content-type': 'application/json' }
	});
}

beforeEach(() => {
	session.clear();
	nodes.clear();
	where.url = new URL('http://app.test/');
	where.gone.length = 0;
	api = useFakeApi();
	api.on('GET /profile/me', () => new Response('{}', { status: 404 }));
	target = document.createElement('div');
	document.body.append(target);
});

afterEach(() => {
	if (mounted) unmount(mounted);
	mounted = undefined;
	target.remove();
});

describe('the frame around every page', () => {
	it('shows the page to whoever is signed in', async () => {
		api.on('GET /auth/me', () => VIEWER);

		await show();

		expect(target.textContent).toContain('The graph');
		expect(where.gone).toEqual([]);
	});

	it('sends somebody with no session to sign in', async () => {
		api.on('GET /auth/me', () => undefined);

		await show();

		expect(where.gone).toEqual(['/sign-in']);
	});

	it('brings somebody back to the thought they arrived with once they have signed in', async () => {
		api.on('GET /auth/me', () => undefined);
		where.url = new URL('http://app.test/new?text=a%20thought');

		await show();
		expect(where.gone).toEqual(['/sign-in']);

		session.adopt(VIEWER, 'token');
		flushSync();
		await settle();

		expect(where.gone.at(-1)).toBe('/new?text=a%20thought');
	});

	// A sign-in page reached because Sloppy could not ask who somebody is cannot
	// help them either: they have a session, and nothing on it to do.
	it('says so and holds, rather than signing out a session it could not check', async () => {
		api.on('GET /auth/me', () => unavailable());

		await show();

		expect(where.gone).toEqual([]);
		expect(target.textContent).toContain('Sloppy could not load just now.');
		expect(target.textContent).not.toContain('The graph');
	});

	// Settings is reachable with no account, and it is the only page that can
	// help somebody the app cannot ask about.
	it('leaves the way to Settings open while it cannot be reached', async () => {
		api.on('GET /auth/me', () => unavailable());

		await show();

		expect(reachable()).toContain('/settings');
		expect(target.textContent).toContain('Try again, or come back to it in a moment.');
	});

	// A session can end without anybody asking it to, and the next person to sign
	// in on this device must not be shown the last one's graph.
	it('drops the graph when a session ends on its own', async () => {
		api.on('GET /auth/me', () => VIEWER);
		api.on('GET /nodes', () => [node(1, '1')]);
		await show();
		await nodes.load();
		expect(nodes.region()).toHaveLength(1);

		session.clear();
		flushSync();
		await settle();

		expect(nodes.region()).toEqual([]);
	});

	it('keeps the graph standing while it only cannot be reached', async () => {
		api.on('GET /auth/me', () => VIEWER);
		api.on('GET /nodes', () => [node(1, '1')]);
		await show();
		await nodes.load();

		api.on('GET /auth/me', () => unavailable());
		await session.refresh();
		flushSync();
		await settle();

		expect(nodes.region()).toHaveLength(1);
	});

	it('offers nothing to somebody who has not signed in yet', async () => {
		api.on('GET /auth/me', () => undefined);
		where.url = new URL('http://app.test/sign-in');

		await show();

		expect(reachable()).toEqual([]);
	});

	it('shows the page once it can be asked again', async () => {
		api.on('GET /auth/me', () => unavailable());
		await show();

		api.on('GET /auth/me', () => VIEWER);
		press('Try again');
		await settle();

		expect(target.textContent).toContain('The graph');
		expect(where.gone).toEqual([]);
	});
});
