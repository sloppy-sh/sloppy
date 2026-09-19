// The two doors onto a graph kept on this device, and what a person is told
// while one is open — docs/ARCHITECTURE.md § "A graph on this device, in the
// browser".

import { LocalApi, MemoryFiles } from '@sloppy/local';
import { pack } from '@sloppy/vault';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeFolder, type Held } from '../browser-files.test-support.js';
import { graphHere } from '../graph-here.svelte.js';
import { initRuntime } from '../runtime.js';
import { useFakeApi, VIEWER } from '../stores/fake-api.test-support.js';
import { session } from '../stores/session.svelte.js';
import OpenHere from './open-here.svelte';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

async function aGraphOnTheDevice(title: string): Promise<Held> {
	const store = new Map<string, Uint8Array>();
	const at = '/the-folder';
	const writing = new LocalApi(new MemoryFiles({ store, folder: at, data: '/elsewhere' }));
	await writing.createGraph({ title });
	return new Map(
		[...store]
			.filter(([path]) => path.startsWith(`${at}/`))
			.map(([path, bytes]) => [path.slice(at.length + 1), bytes])
	);
}

function picksUp(held: Held, named: string): void {
	Object.defineProperty(globalThis, 'showDirectoryPicker', {
		configurable: true,
		writable: true,
		value: async () => fakeFolder(held, '', named)
	});
}

function show(): void {
	mounted = mount(OpenHere, { target });
	flushSync();
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 8; turn += 1) await new Promise((done) => setTimeout(done, 0));
	flushSync();
}

function screen(): string {
	return (target.textContent ?? '').replace(/\s+/g, ' ');
}

function labels(): string[] {
	return [...target.querySelectorAll('button')].map((one) => one.textContent?.trim() ?? '');
}

function press(label: string): void {
	const one = [...target.querySelectorAll('button')].find(
		(button) => button.textContent?.trim() === label
	);
	if (!one) throw new Error(`No button reads ${JSON.stringify(label)}: ${labels().join(' · ')}`);
	one.click();
	flushSync();
}

beforeEach(async () => {
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			matches: query.includes('max-width'),
			addEventListener: () => {},
			removeEventListener: () => {}
		})
	});
	URL.createObjectURL = () => 'blob:held';
	URL.revokeObjectURL = () => {};
	target = document.createElement('div');
	document.body.append(target);
	useFakeApi().on('GET /auth/me', () => VIEWER);
	graphHere.offerHere();
	await session.refresh();
});

afterEach(async () => {
	if (mounted) unmount(mounted);
	mounted = undefined;
	target.remove();
	if (graphHere.open) await graphHere.close();
	Reflect.deleteProperty(globalThis, 'showDirectoryPicker');
	session.clear();
});

describe('before a graph on this device is open', () => {
	it('offers both doors where this browser can hand a folder over', () => {
		picksUp(new Map(), 'garden');
		show();
		expect(labels()).toEqual(['Open a folder on this device', 'Open an archive']);
	});

	it('offers the archive alone where it cannot, with nothing said about the other', () => {
		show();
		expect(labels()).toEqual(['Open an archive']);
		expect(screen()).not.toContain('folder');
	});

	it('says the one consequence once', () => {
		picksUp(new Map(), 'garden');
		show();
		expect(screen()).toContain('Nothing in it is sent anywhere');
		expect(screen().match(/sent anywhere/g)).toHaveLength(1);
	});

	it('shows what went wrong with a file that is not a graph', async () => {
		initRuntime({
			apiHost: () => 'http://api.test',
			openFile: async () => new File([new Uint8Array([1, 2, 3])], 'holiday.sloppy')
		});
		show();
		press('Open an archive');
		await settle();
		expect(screen()).toContain("isn't a Sloppy graph");
	});
});

describe('while one is open', () => {
	it('names the folder, says nothing leaves, and offers to close it', async () => {
		picksUp(await aGraphOnTheDevice('The garden'), 'garden');
		show();
		press('Open a folder on this device');
		await settle();

		expect(screen()).toContain('garden is open');
		expect(screen()).toContain('nothing in it is sent anywhere');
		expect(labels()).toContain('Close');
	});

	it('says where the history of a folder is kept, and what waits until it is closed', async () => {
		picksUp(await aGraphOnTheDevice('The garden'), 'garden');
		show();
		press('Open a folder on this device');
		await settle();

		expect(screen()).toContain("Keeping versions of a folder as you go is the desktop app's to do");
		expect(screen()).toContain('are not offered while this graph is open');
		expect(screen()).toContain('Starting another graph and bringing one in from a file wait');
		expect(screen()).toContain('Signing out waits until you close this graph');
	});

	it('says which identity a graph opened here is written under', async () => {
		session.clear();
		picksUp(await aGraphOnTheDevice('The garden'), 'garden');
		show();
		press('Open a folder on this device');
		await settle();

		expect(screen()).toContain('the identity this browser made for itself');
		expect(screen()).toContain('Signing in waits until you close this graph');
	});

	it('offers a copy of an archive, and asks before closing one', async () => {
		initRuntime({
			apiHost: () => 'http://api.test',
			openFile: async () =>
				new File([pack(await aGraphOnTheDevice('The thesis')).slice()], 'thesis.sloppy')
		});
		show();
		press('Open an archive');
		await settle();

		expect(screen()).toContain('thesis.sloppy is open');
		expect(screen()).toContain('until you save a copy');
		expect(labels()).toContain('Save a copy');

		press('Close');
		await settle();
		expect(document.body.textContent).toContain('Close this graph?');
		expect(graphHere.open?.how).toBe('archive');
	});
});
