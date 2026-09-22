import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** What the boot read answers, held open until a test settles it. */
let boot: { resolve: (folder: string | undefined) => void; reject: (why: Error) => void };
let reading: Promise<string | undefined>;
/** Whether the boot read found the folder gone rather than never chosen. */
let missing = false;

vi.mock('$lib/back', () => ({ answerBack: vi.fn() }));
vi.mock('$lib/deep-link', () => ({ forwardDeepLinks: vi.fn(async () => {}) }));
vi.mock('$lib/keyboard', () => ({ trackKeyboardInset: () => () => {} }));
vi.mock('$lib/local-mode', () => ({ LOCAL_MODE: true }));
vi.mock('$lib/platform', () => ({ IS_MOBILE: false, TAURI_PLATFORM: 'desktop' }));
vi.mock('$lib/runtime', () => ({
	initNativeRuntime: vi.fn(),
	openRememberedVault: () => reading,
	vaultIsMissing: () => missing
}));
vi.mock('@sloppy/app-core/graph-here', () => ({
	graphHere: { offerHere: vi.fn(), boot: vi.fn(async () => {}) }
}));
vi.mock('@sloppy/app-core/pages/frame', async () => ({
	default: (await import('./frame.test-support.svelte')).default
}));
vi.mock('@sloppy/app-core/pages/first-run', async () => ({
	default: (await import('./first-run.test-support.svelte')).default
}));

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

/** Which page the shell has put in front of somebody, or nothing. */
function showing(): string | null {
	return target.querySelector('[data-page]')?.getAttribute('data-page') ?? null;
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 4; turn += 1) await new Promise((done) => setTimeout(done, 0));
	flushSync();
}

/** The page the router would have put inside the frame. */
const page = createRawSnippet(() => ({ render: () => '<p data-page-inside>a note</p>' }));

async function boots(): Promise<void> {
	const Layout = (await import('./+layout.svelte')).default;
	mounted = mount(Layout, { target, props: { children: page } });
	flushSync();
}

beforeEach(() => {
	missing = false;
	reading = new Promise((resolve, reject) => {
		boot = { resolve, reject };
	});
	target = document.createElement('div');
	document.body.append(target);
});

afterEach(() => {
	if (mounted) unmount(mounted);
	mounted = undefined;
	target.remove();
});

describe('what the native shell opens on', () => {
	it('waits rather than offering a folder somebody already has', async () => {
		await boots();

		expect(showing()).toBeNull();
	});

	it('opens the graph where this device has a folder for one', async () => {
		await boots();
		boot.resolve('/Users/me/garden');
		await settle();

		expect(showing()).toBe('frame');
		expect(target.querySelector('[data-page-inside]')).not.toBeNull();
	});

	it('offers a folder where this device has none', async () => {
		await boots();
		boot.resolve(undefined);
		await settle();

		expect(showing()).toBe('first-run');
	});

	it('offers a folder rather than nothing where the read goes wrong', async () => {
		await boots();
		boot.reject(new Error('the folder could not be read'));
		await settle();

		expect(showing()).toBe('first-run');
	});

	it('says the folder is gone where the one this device had is not there any more', async () => {
		missing = true;
		await boots();
		boot.resolve(undefined);
		await settle();

		expect(target.querySelector('[data-page="first-run"]')?.getAttribute('data-missing')).toBe(
			'true'
		);
	});

	it('opens the graph in the folder somebody names', async () => {
		await boots();
		boot.resolve(undefined);
		await settle();

		target.querySelector('button')?.click();
		await settle();

		expect(showing()).toBe('frame');
	});

	// A build that opens a folder from the start is already in one, so there is
	// no second way onto a graph kept here to offer or to settle.
	it('offers no graph beside the folder it opens', async () => {
		const { graphHere } = await import('@sloppy/app-core/graph-here');

		await boots();
		boot.resolve('/Users/me/garden');
		await settle();

		expect(graphHere.offerHere).not.toHaveBeenCalled();
		expect(graphHere.boot).not.toHaveBeenCalled();
	});
});
