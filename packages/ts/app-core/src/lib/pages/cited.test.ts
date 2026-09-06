// Following a link to somebody's note: what a stranger sees, what a signed-in
// reader gets instead, and what is said where nothing is published there.

import type { OwnedRef, PublishedSubtreePage } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { people } from '../stores/people.svelte.js';
import { session } from '../stores/session.svelte.js';
import { AT, DID, ref, useFakeApi, VIEWER, type FakeApi } from '../stores/fake-api.test-support.js';

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
	pushState: () => {},
	replaceState: () => {},
	afterNavigate: () => {}
}));

vi.mock('@sloppy/ui', async (original) => ({
	...((await original()) as object),
	GraphSurface: (await import('./graph-surface.test-support.svelte')).default
}));

const Cited = (await import('./cited.svelte')).default;

const AUTHOR = 'did:syr:z6MkpTHR8VNsBxYAAWHut2Geadd9jSLuFvdmsZ2mFmZjMxYZ';
const ROOT = ref(21, AUTHOR);
const VERSION = ref(22, AUTHOR);

function refPath(of: OwnedRef): string {
	const cut = of.lastIndexOf('/');
	return `/${encodeURIComponent(of.slice(0, cut))}/${encodeURIComponent(of.slice(cut + 1))}`;
}

function branch(over: Partial<PublishedSubtreePage> = {}): PublishedSubtreePage {
	return {
		publication: ROOT,
		version: { ref: VERSION, sequence: 1, published_at: AT },
		root_address: '1',
		graph_title: 'Their notebook',
		comments: 'anyone',
		nodes: [
			{
				ref: ROOT,
				address: '1',
				origin: ROOT,
				title: 'Ash keys',
				tags: ['trees'],
				links: [],
				created_at: AT,
				updated_at: AT
			}
		],
		blocks: [
			{
				ref: ref(23, AUTHOR),
				node: ROOT,
				ord: 'a0',
				content: {
					type: 'doc',
					content: [
						{ type: 'paragraph', content: [{ type: 'text', text: 'They hang on all winter' }] }
					]
				}
			}
		],
		...over
	};
}

let api: FakeApi;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

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

async function settle(): Promise<void> {
	for (let turn = 0; turn < 8; turn += 1) {
		await new Promise((done) => setTimeout(done, 0));
		flushSync();
	}
	for (let frame = 0; frame < 3; frame += 1) await new Promise(requestAnimationFrame);
	flushSync();
}

async function until(ready: () => boolean): Promise<void> {
	for (let turn = 0; turn < 200 && !ready(); turn += 1) {
		await new Promise((wake) => setTimeout(wake));
		flushSync();
	}
	if (!ready()) throw new Error('The page never settled');
}

const screen = () => document.body.textContent ?? '';

async function open(): Promise<void> {
	stubViewport();
	mounted = mount(Cited, { target });
	flushSync();
	await settle();
}

beforeEach(() => {
	session.clear();
	people.hold(null);
	where.url = new URL(`http://app.test/n${refPath(ROOT)}`);
	where.gone.length = 0;
	api = useFakeApi();
	target = document.createElement('div');
	document.body.append(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	session.clear();
	target.remove();
	document.body.innerHTML = '';
});

describe('a note somebody was sent to, with no account', () => {
	it('reads what its author published', async () => {
		api.on(`GET /public/publications${refPath(ROOT)}`, () => branch());

		await open();
		await until(() => screen().includes('Ash keys'));

		expect(screen()).toContain('They hang on all winter');
		expect(screen()).toContain('trees');
	});

	// Nobody's profile resolves without an account, and an identity is never what
	// stands in for their name — AI.md § "User-Facing Copy".
	it('names no identity where it cannot say who wrote it', async () => {
		api.on(`GET /public/publications${refPath(ROOT)}`, () => branch());

		await open();
		await until(() => screen().includes('Ash keys'));

		expect(screen()).toContain('Somebody else wrote this');
		expect(screen()).not.toContain(AUTHOR);
	});

	it('offers signing in to keep it or answer it', async () => {
		api.on(`GET /public/publications${refPath(ROOT)}`, () => branch());

		await open();
		await until(() => screen().includes('Ash keys'));

		expect(screen()).toContain('Sign in to keep it, or to answer it.');
	});

	// The peer routes are the API's own, so a reader with no session never
	// reaches another instance: what is not served here is not read here.
	it('says plainly when nothing is published at that address', async () => {
		api.on(`GET /public/publications${refPath(ROOT)}`, () => null);

		await open();
		await until(() => screen().includes('nothing to read'));

		expect(screen()).toContain('may keep their graph somewhere else');
		expect(screen()).not.toContain(AUTHOR);
	});

	it('says so rather than emptying the page when the ask does not land', async () => {
		api.on(`GET /public/publications${refPath(ROOT)}`, () => {
			throw new Error('unreachable');
		});

		await open();
		await until(() => screen().includes('Sloppy could not open that note'));

		expect(screen()).toContain('Sign in');
	});
});

describe('the same link followed by somebody signed in', () => {
	it('opens the graph, which reaches the note where it belongs', async () => {
		api.on('GET /auth/me', () => VIEWER);
		api.on('GET /nodes', () => []);
		api.on('GET /graphs', () => []);
		session.adopt(VIEWER, 'a-session');

		await open();

		expect(screen()).toContain('Your graph');
		expect(api.countOf(`GET /public/publications${refPath(ROOT)}`)).toBe(0);
	});
});

describe('a link to nothing', () => {
	it('asks for nothing where the path names no note', async () => {
		where.url = new URL(`http://app.test/n/${encodeURIComponent(DID)}`);

		await open();

		expect(api.calls).toEqual([]);
	});
});
