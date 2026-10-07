import { Refusal } from '@sloppy/ui';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rememberFolder } from '../browser-files.js';
import { aGraphFolder, fakeFolder } from '../browser-files.test-support.js';
import { graphHere } from '../graph-here.svelte.js';
import { initRuntime, updateRuntime, type OpenTabs } from '../runtime.js';
import { deleted } from '../stores/deleted.svelte.js';
import {
	AT,
	DID,
	node,
	ref,
	useFakeApi,
	VIEWER,
	type FakeApi
} from '../stores/fake-api.test-support.js';
import { nodes } from '../stores/nodes.svelte.js';
import { outlineSections } from '../stores/outline-sections.svelte.js';
import { session } from '../stores/session.svelte.js';
import { tabs } from '../stores/tabs.svelte.js';
import Frame from './frame.test-support.svelte';
import { nodeHref } from './routes.js';

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
	deleted.clear();
	where.url = new URL('http://app.test/');
	where.gone.length = 0;
	api = useFakeApi();
	api.on('GET /profile/me', () => new Response('{}', { status: 404 }));
	target = document.createElement('div');
	document.body.append(target);
});

afterEach(async () => {
	if (mounted) unmount(mounted);
	mounted = undefined;
	target.remove();
	if (graphHere.open) await graphHere.close();
	await rememberFolder(null);
	Reflect.deleteProperty(globalThis, 'showDirectoryPicker');
	running('hosted');
	tabs.clear();
	updateRuntime({ tabs: undefined });
});

/** A folder this browser would hand over, as one somebody picks. */
function picksUp(held: Awaited<ReturnType<typeof aGraphFolder>>, named = 'garden'): void {
	Object.defineProperty(globalThis, 'showDirectoryPicker', {
		configurable: true,
		writable: true,
		value: async () => fakeFolder(held, '', named)
	});
}

/** Which of the deployments the app is running as, for the mount that follows. */
function running(mode: 'hosted' | 'local'): void {
	initRuntime({ apiHost: () => '', mode: () => mode });
}

/** A shell holding folders open, as `TabsAccess` hands them over. `refuses` is
 *  a close it will not do, in the words it says so in — `null` is one it will
 *  not do and has nothing to say about. */
function holding(open: string[], active: string, refuses?: string | null): void {
	let listed = [...open];
	let front: string | undefined = active;
	let hear: ((tabs: OpenTabs) => void) | undefined;
	const held = (): OpenTabs => ({ open: listed, active: front });
	running('local');
	updateRuntime({
		tabs: {
			held,
			close: (root: string) => {
				if (refuses === null) return Promise.reject(new Error('the tab stands'));
				if (refuses !== undefined) return Promise.reject(new Refusal(refuses));
				listed = listed.filter((one) => one !== root);
				if (front === root) front = listed[0];
				hear?.(held());
				return Promise.resolve();
			},
			changed: (heard) => {
				hear = heard;
				return () => {
					hear = undefined;
				};
			}
		}
	});
}

const strip = () => target.querySelector('[role="tablist"]');
const closes = (name: string) =>
	target.querySelector<HTMLButtonElement>(`[aria-label="Close ${name}"]`);

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
	// PRODUCT.md § "The peer": a link somebody was handed opens for whoever
	// follows it, and signing in is what they do to keep or answer the note.
	it('lets somebody with no account stand on the note they were sent to', async () => {
		api.on('GET /auth/me', () => undefined);
		where.url = new URL(`http://app.test${nodeHref(ref(7))}`);

		await show();

		expect(where.gone).toEqual([]);
		expect(target.textContent).toContain('The graph');
	});

	it('brings them back to that note once they have signed in', async () => {
		api.on('GET /auth/me', () => undefined);
		where.url = new URL(`http://app.test${nodeHref(ref(7))}`);
		await show();

		// They take the offer, which leaves the note for the sign-in page.
		unmount(mounted!);
		where.url = new URL('http://app.test/sign-in');
		await show();
		session.adopt(VIEWER, 'token');
		flushSync();
		await settle();

		expect(where.gone.at(-1)).toBe(nodeHref(ref(7)));
	});

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

	// A page about the reader has nobody to be about while Sloppy cannot say who
	// they are, so offering it is a tab that lands back where it was tapped.
	it('offers nothing that leads back to the same screen while it cannot be reached', async () => {
		api.on('GET /auth/me', () => unavailable());

		await show();

		expect(reachable()).toEqual(['/', '/settings']);
	});

	// A session can end without anybody asking it to, and the next person to sign
	// in on this device must not be shown the last one's graph.
	it('drops the graph when a session ends on its own', async () => {
		const NOTE = ref(1);
		api.on('GET /auth/me', () => VIEWER);
		api.on('GET /nodes', () => [node(1, '1')]);
		api.on(
			`GET /nodes/${encodeURIComponent(DID)}/${encodeURIComponent(NOTE.split('/')[1])}/blocks`,
			() => []
		);
		await show();
		await nodes.load();
		outlineSections.show(NOTE, true);
		await settle();
		expect(nodes.region()).toHaveLength(1);
		expect(outlineSections.of(NOTE)).toEqual([]);

		session.clear();
		flushSync();
		await settle();

		expect(nodes.region()).toEqual([]);
		// The outline's own sections go with it, not on whoever mounts a tree next.
		expect(outlineSections.shown.size).toBe(0);
		expect(outlineSections.of(NOTE)).toBeUndefined();
	});

	it('takes what they deleted with it, which is a listing of their notes too', async () => {
		api.on('GET /auth/me', () => VIEWER);
		api.on('GET /nodes/deleted', () => [
			{ ref: ref(31), address: '1a', graph: ref(1), title: 'A branch', deleted_at: AT, notes: 3 }
		]);
		await show();
		await deleted.load();
		expect(deleted.all).toHaveLength(1);

		session.clear();
		flushSync();
		await settle();

		session.adopt(VIEWER, 'token');
		flushSync();
		await settle();

		expect(deleted.all).toEqual([]);
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

	// The identity a graph on this device is written under is made on the spot,
	// so there is no screen to send anybody to and nothing to send them for.
	it('shows the page on a device holding its own graph, with nowhere to sign in', async () => {
		running('local');
		api.on('GET /auth/me', () => VIEWER);

		await show();

		expect(target.textContent).toContain('The graph');
		expect(where.gone).toEqual([]);
	});

	it('sends nobody to sign in there, even where the identity could not be read', async () => {
		running('local');
		api.on('GET /auth/me', () => undefined);

		await show();

		expect(where.gone).toEqual([]);
		expect(target.textContent).toContain('Sloppy could not load just now');
	});

	it('still sends somebody with no session to sign in where a Sloppy serves the graph', async () => {
		running('hosted');
		api.on('GET /auth/me', () => undefined);

		await show();

		expect(where.gone).toEqual(['/sign-in']);
	});

	// The door beside the account on the sign-in screen: opening a graph kept
	// here is the way in, so the page asking for an account is one nobody is
	// left standing on.
	it('takes somebody who opened a graph kept on this device off the sign-in page', async () => {
		api.on('GET /auth/me', () => undefined);
		where.url = new URL('http://app.test/sign-in');
		await show();
		expect(where.gone).toEqual([]);

		graphHere.offerHere();
		picksUp(await aGraphFolder());
		await graphHere.openFolder();
		flushSync();
		await settle();

		expect(graphHere.open?.name).toBe('garden');
		expect(where.gone).toEqual(['/']);
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

// DESIGN.md § Layout: the folders open stand in a strip across the top, and
// only where there are two or more.
describe('the folders open above the page', () => {
	const GARDEN = '/Users/me/garden';
	const THESIS = '/Users/me/thesis';

	beforeEach(() => {
		api.on('GET /auth/me', () => VIEWER);
	});

	it('stand above the page rather than inside it', async () => {
		holding([GARDEN, THESIS], THESIS);

		await show();

		expect(
			[...(strip()?.querySelectorAll('[role="tab"]') ?? [])].map((one) => one.textContent)
		).toEqual(['garden', 'thesis']);
		expect(target.firstElementChild?.querySelector('[role="tablist"]')).toBe(strip());
		expect(strip()?.closest('main')).toBeNull();
		expect(target.textContent).toContain('The graph');
	});

	// That folder's name is already in the chrome, so a strip to tell it from
	// nothing is chrome with nothing in it.
	it('stand nowhere while one folder is open', async () => {
		holding([GARDEN], GARDEN);

		await show();

		expect(strip()).toBeNull();
		expect(target.textContent).toContain('The graph');
	});

	it('go once closing one leaves a single folder open', async () => {
		holding([GARDEN, THESIS], THESIS);
		await show();
		expect(strip()).not.toBeNull();

		closes('garden')?.click();
		flushSync();
		await settle();

		expect(strip()).toBeNull();
		expect(target.textContent).toContain('The graph');
	});

	it('say what the shell would not do, in the words it said it in', async () => {
		holding([GARDEN, THESIS], THESIS, 'Keep at least one folder open.');
		await show();

		closes('garden')?.click();
		flushSync();
		await settle();

		expect(target.querySelector('[role="alert"]')?.textContent).toContain(
			'Keep at least one folder open.'
		);
		expect(strip()).not.toBeNull();
	});

	// A shell with nothing to say still leaves somebody knowing which act did
	// not happen.
	it('name the act themselves where the shell said nothing about it', async () => {
		holding([GARDEN, THESIS], THESIS, null);
		await show();

		closes('garden')?.click();
		flushSync();
		await settle();

		expect(target.querySelector('[role="alert"]')?.textContent).toContain(
			'That folder could not be closed.'
		);
	});

	// Nobody dismisses a line about a folder they have moved on from, so it goes
	// on its own.
	it('take what they said away again after a few seconds', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		try {
			holding([GARDEN, THESIS], THESIS, 'Keep at least one folder open.');
			await show();
			closes('garden')?.click();
			flushSync();
			await settle();
			expect(target.querySelector('[role="alert"]')).not.toBeNull();

			await vi.advanceTimersByTimeAsync(10_000);
			flushSync();

			expect(target.querySelector('[role="alert"]')).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});
});
