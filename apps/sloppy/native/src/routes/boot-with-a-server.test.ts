// What a native build that talks to a server opens on. The folder kept here is
// settled before any page mounts, so nothing asks that server about a note in
// it — docs/ARCHITECTURE.md § "A graph on this device, beside the one a Sloppy
// serves".

import type { FoldersHere } from '@sloppy/app-core/graph-here';
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The boot of the graph kept here, held open until a test settles it. */
let boot: { resolve: () => void; reject: (why: Error) => void };
let booting: Promise<void>;
/** What the shell told the store about the folders it can reach. */
let offered: FoldersHere[];

const opensFolders: FoldersHere = {
	opens: true,
	starts: true,
	ask: async () => undefined,
	remembered: async () => undefined,
	forget: async () => {}
};

vi.mock('$lib/back', () => ({ answerBack: vi.fn() }));
vi.mock('$lib/deep-link', () => ({ forwardDeepLinks: vi.fn(async () => {}) }));
vi.mock('$lib/folders', () => ({ deviceFolders: () => opensFolders }));
vi.mock('$lib/keyboard', () => ({ trackKeyboardInset: () => () => {} }));
vi.mock('$lib/local-mode', () => ({ LOCAL_MODE: false }));
vi.mock('$lib/platform', () => ({ IS_MOBILE: false, TAURI_PLATFORM: 'desktop' }));
vi.mock('$lib/runtime', () => ({
	initNativeRuntime: vi.fn(),
	openRememberedVault: vi.fn(),
	vaultIsMissing: () => false
}));
vi.mock('@sloppy/app-core/graph-here', () => ({
	graphHere: {
		offerHere: (folders: FoldersHere) => offered.push(folders),
		boot: () => booting
	}
}));
vi.mock('@sloppy/app-core/pages/frame', async () => ({
	default: (await import('./frame.test-support.svelte')).default
}));
vi.mock('@sloppy/app-core/pages/first-run', async () => ({
	default: (await import('./first-run.test-support.svelte')).default
}));

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function showing(): string | null {
	return target.querySelector('[data-page]')?.getAttribute('data-page') ?? null;
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 4; turn += 1) await new Promise((done) => setTimeout(done, 0));
	flushSync();
}

const page = createRawSnippet(() => ({ render: () => '<p data-page-inside>a note</p>' }));

async function boots(): Promise<void> {
	const Layout = (await import('./+layout.svelte')).default;
	mounted = mount(Layout, { target, props: { children: page } });
	flushSync();
}

beforeEach(() => {
	offered = [];
	booting = new Promise((resolve, reject) => {
		boot = { resolve: () => resolve(), reject };
	});
	target = document.createElement('div');
	document.body.append(target);
});

afterEach(() => {
	if (mounted) unmount(mounted);
	mounted = undefined;
	target.remove();
});

describe('what a build that talks to a server opens on', () => {
	it('tells the store how this shell reaches a folder on the device', async () => {
		await boots();

		expect(offered).toEqual([opensFolders]);
	});

	it('mounts no page until the graph a page will read is settled', async () => {
		await boots();

		expect(showing()).toBeNull();

		boot.resolve();
		await settle();

		expect(showing()).toBe('frame');
		expect(target.querySelector('[data-page-inside]')).not.toBeNull();
	});

	// The doors onto a folder are on the sign-in screen, so a folder that will
	// not open leaves somebody at a screen they can act on rather than nothing.
	it('goes on where the folder on this device will not open', async () => {
		await boots();
		boot.reject(new Error('that folder is not there any more'));
		await settle();

		expect(showing()).toBe('frame');
	});

	it('never offers the folder this build has no vault for', async () => {
		const { openRememberedVault } = await import('$lib/runtime');

		await boots();
		boot.resolve();
		await settle();

		expect(openRememberedVault).not.toHaveBeenCalled();
	});
});
