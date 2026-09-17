// Settings, where a folder is told who its versions are by, how they are
// signed, where else it is kept and how this device gets in there.

import {
	DeviceCredentials,
	DeviceGitDefaults,
	MemoryFiles,
	MemoryHistory,
	readCredentials,
	readGitDefaults,
	type History,
	type SigningConfig
} from '@sloppy/local';
import type { OwnedRef } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initRuntime } from '../runtime.js';
import { gitSettings } from '../stores/git-settings.svelte.js';
import { graphs } from '../stores/graphs.svelte.js';
import { prefs } from '../stores/prefs.svelte.js';
import HistorySettings from './history-settings.svelte';

const ROOT = '/Users/me/garden';
const ELSEWHERE = '/Users/me/thesis';
const DATA = '/data';

const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';

let store: Map<string, Uint8Array>;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function folder(root = ROOT): MemoryFiles {
	return new MemoryFiles({ root, store, data: DATA });
}

function privately(): MemoryFiles {
	return new MemoryFiles({ root: DATA, store, data: DATA });
}

/** A shell that makes the key it signs with and answers its public half. */
class KeepsAKey extends MemoryHistory {
	private held?: string;

	override async setSigning(config: SigningConfig): Promise<void> {
		if (config.kind === 'ssh' && config.key.kind === 'kept') {
			this.held ??= 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 sloppy';
		}
		await super.setSigning(config);
	}

	override async signing(): Promise<SigningConfig> {
		const config = await super.signing();
		if (config.kind !== 'ssh' || config.key.kind !== 'kept' || this.held === undefined) {
			return config;
		}
		return { ...config, publicKey: this.held };
	}
}

function shellKeeping(over: History | undefined, holds = true): void {
	initRuntime({
		apiHost: () => '',
		mode: () => 'local',
		history: () => over,
		gitDefaults: holds ? new DeviceGitDefaults(folder()) : undefined,
		credentials: holds ? new DeviceCredentials(folder()) : undefined
	});
}

function onDevice(agent: string): void {
	Object.defineProperty(globalThis.navigator, 'userAgent', { configurable: true, value: agent });
	Object.defineProperty(globalThis.navigator, 'maxTouchPoints', { configurable: true, value: 0 });
}

function show(): void {
	mounted = mount(HistorySettings, { target });
	flushSync();
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 8; turn += 1) await new Promise((done) => setTimeout(done, 0));
	flushSync();
}

function surface(): HTMLElement | null {
	return target.querySelector('[data-surface="history-settings"]');
}

function screen(): string {
	return document.body.textContent ?? '';
}

function press(label: string): void {
	const one = [...document.body.querySelectorAll('button')].find(
		(button) => button.textContent?.trim() === label
	);
	if (!one) throw new Error(`No "${label}" on the page`);
	one.click();
}

/** A control named rather than worded: an icon carries the act and the name is
 *  what says it. */
function called(label: string): boolean {
	return document.body.querySelector(`button[aria-label="${label}"]`) !== null;
}

function offers(label: string): boolean {
	return [...document.body.querySelectorAll('button')].some(
		(button) => button.textContent?.trim() === label
	);
}

function type(id: string, said: string): void {
	const field = target.querySelector<HTMLInputElement>(`#${CSS.escape(id)}`);
	if (!field) throw new Error(`Nowhere to type ${id}`);
	field.value = said;
	field.dispatchEvent(new Event('input', { bubbles: true }));
}

function pick(group: string, value: string): void {
	const one = target.querySelector<HTMLInputElement>(
		`input[type="radio"][name="${group}"][value="${value}"]`
	);
	if (!one) throw new Error(`No "${value}" to choose under ${group}`);
	one.click();
}

function alerts(): string[] {
	return [...document.body.querySelectorAll('[role="alert"]')].map(
		(one) => one.textContent?.trim() ?? ''
	);
}

beforeEach(() => {
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
	});
	onDevice(DESKTOP);
	store = new Map();
	gitSettings.clear();
	target = document.createElement('div');
	document.body.append(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	gitSettings.clear();
	graphs.clear();
	target.remove();
	document.body.innerHTML = '';
	initRuntime({
		apiHost: () => '',
		mode: () => 'hosted',
		history: () => undefined,
		gitDefaults: undefined,
		credentials: undefined
	});
});

describe('a platform that can be told none of it', () => {
	it('puts nothing in front of anybody', async () => {
		shellKeeping(undefined);
		show();
		await settle();

		expect(surface()).toBeNull();
	});
});

describe('who the versions kept here are by', () => {
	it('says the graph owner stands in until somebody says', async () => {
		shellKeeping(new MemoryHistory(folder()));
		show();
		await settle();

		expect(screen()).toContain("it is your graph's owner");
	});

	it('writes them on the folder and keeps them for the next one', async () => {
		const kept = new MemoryHistory(folder());
		shellKeeping(kept);
		show();
		await settle();

		type('history-by-name', 'Ada Lovelace');
		type('history-by-email', 'ada@example.com');
		press("Save who they're by");
		await settle();

		expect(await kept.gitUser()).toEqual({ name: 'Ada Lovelace', email: 'ada@example.com' });
		expect((await readGitDefaults(privately())).user).toEqual({
			name: 'Ada Lovelace',
			email: 'ada@example.com'
		});
		expect(screen()).not.toContain("it is your graph's owner");
	});

	it('asks for both rather than keeping versions in half a name', async () => {
		const kept = new MemoryHistory(folder());
		shellKeeping(kept);
		show();
		await settle();

		type('history-by-name', 'Ada Lovelace');
		press("Save who they're by");
		await settle();

		expect(await kept.gitUser()).toBeUndefined();
		expect(alerts().join(' ')).toContain('email');
	});

	it('shows who a folder already says they are by', async () => {
		const kept = new MemoryHistory(folder());
		await kept.setGitUser({ name: 'Ada Lovelace', email: 'ada@example.com' });
		shellKeeping(kept);
		show();
		await settle();

		expect(target.querySelector<HTMLInputElement>('#history-by-name')?.value).toBe('Ada Lovelace');
		expect(target.querySelector<HTMLInputElement>('#history-by-email')?.value).toBe(
			'ada@example.com'
		);
	});
});

describe('how the versions kept here are signed', () => {
	it('signs with a key this app keeps, and hands over its public half', async () => {
		const kept = new KeepsAKey(folder());
		shellKeeping(kept);
		show();
		await settle();

		pick('signing', 'kept');
		await settle();

		expect(await kept.signing()).toMatchObject({ kind: 'ssh', key: { kind: 'kept' } });
		expect(screen()).toContain('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 sloppy');
		expect(screen()).toContain('GitHub or GitLab');
		expect(called('Copy the key')).toBe(true);
	});

	it('says a key is being made where the shell has not handed over its public half', async () => {
		const kept = new MemoryHistory(folder());
		shellKeeping(kept);
		show();
		await settle();

		pick('signing', 'kept');
		await settle();

		expect(screen()).toContain('Sloppy is making a key for this folder.');
		expect(called('Copy the key')).toBe(false);
	});

	it('signs with a key somebody names, and asks where it is first', async () => {
		const kept = new MemoryHistory(folder());
		shellKeeping(kept);
		show();
		await settle();

		pick('signing', 'file');
		await settle();
		press('Sign with this key');
		await settle();

		expect(await kept.signing()).toEqual({ kind: 'none' });
		expect(alerts().join(' ')).toContain('where the key is');

		type('history-key-file', '~/.ssh/id_ed25519');
		press('Sign with this key');
		await settle();

		expect(await kept.signing()).toEqual({
			kind: 'ssh',
			key: { kind: 'file', path: '~/.ssh/id_ed25519' }
		});
	});

	it('stops signing them when somebody says', async () => {
		const kept = new KeepsAKey(folder());
		await kept.setSigning({ kind: 'ssh', key: { kind: 'kept' } });
		shellKeeping(kept);
		show();
		await settle();

		pick('signing', 'none');
		await settle();

		expect(await kept.signing()).toEqual({ kind: 'none' });
		expect(called('Copy the key')).toBe(false);
	});

	it('leaves the program and the key to this device where neither is named', async () => {
		const kept = new MemoryHistory(folder());
		shellKeeping(kept);
		show();
		await settle();

		pick('signing', 'openpgp');
		await settle();
		press('Sign with this program');
		await settle();

		expect(await kept.signing()).toEqual({ kind: 'openpgp' });
	});

	it('falls back to what the folder says when the key cannot be made', async () => {
		const kept = new MemoryHistory(folder());
		kept.setSigning = async () => {
			throw new Error('No room left on this device.');
		};
		shellKeeping(kept);
		show();
		await settle();

		pick('signing', 'kept');
		await settle();

		expect(alerts().join(' ')).toContain('No room left on this device.');
		const off = target.querySelector<HTMLInputElement>('input[name="signing"][value="none"]');
		expect(off?.checked).toBe(true);
	});

	it('says an OpenPGP program takes a desktop, on a phone', async () => {
		onDevice(PHONE);
		shellKeeping(new MemoryHistory(folder()));
		show();
		await settle();

		expect(screen()).toContain('takes a desktop');
		const openpgp = target.querySelector<HTMLInputElement>('input[type="radio"][value="openpgp"]');
		expect(openpgp?.disabled).toBe(true);
	});

	it('offers it where a program can be run', async () => {
		shellKeeping(new MemoryHistory(folder()));
		show();
		await settle();

		expect(screen()).not.toContain('takes a desktop');
		const openpgp = target.querySelector<HTMLInputElement>('input[type="radio"][value="openpgp"]');
		expect(openpgp?.disabled).toBe(false);
	});
});

describe('where else the graph is kept', () => {
	it('names one, and calls it origin where nobody says', async () => {
		const kept = new MemoryHistory(folder());
		shellKeeping(kept);
		show();
		await settle();

		press('Add somewhere else');
		await settle();
		type('history-new-place-url', 'https://example.com/ada/notes.git');
		press('Keep it there too');
		await settle();

		expect(await kept.remotes()).toEqual([
			{ name: 'origin', url: 'https://example.com/ada/notes.git' }
		]);
		expect(screen()).toContain('https://example.com/ada/notes.git');
	});

	it('asks for an address rather than naming nowhere', async () => {
		const kept = new MemoryHistory(folder());
		shellKeeping(kept);
		show();
		await settle();

		press('Add somewhere else');
		await settle();
		press('Keep it there too');
		await settle();

		expect(await kept.remotes()).toEqual([]);
		expect(alerts().join(' ')).toContain('address');
	});

	it('says what the history said when the name is taken', async () => {
		const kept = new MemoryHistory(folder());
		await kept.addRemote('origin', 'https://example.com/ada/notes.git');
		shellKeeping(kept);
		show();
		await settle();

		press('Add somewhere else');
		await settle();
		type('history-new-place-name', 'origin');
		type('history-new-place-url', 'https://elsewhere.example/ada.git');
		press('Keep it there too');
		await settle();

		expect(alerts().join(' ')).toContain('There is already one called origin.');
	});

	it('changes what it is called and where it is', async () => {
		const kept = new MemoryHistory(folder());
		await kept.addRemote('origin', 'https://example.com/ada/notes.git');
		shellKeeping(kept);
		show();
		await settle();

		press('Change it');
		await settle();
		type('history-place-name-origin', 'mine');
		type('history-place-url-origin', 'https://example.com/ada/garden.git');
		press('Save this place');
		await settle();

		expect(await kept.remotes()).toEqual([
			{ name: 'mine', url: 'https://example.com/ada/garden.git' }
		]);
	});

	it('stops keeping it there once the question is answered', async () => {
		const kept = new MemoryHistory(folder());
		await kept.addRemote('origin', 'https://example.com/ada/notes.git');
		shellKeeping(kept);
		show();
		await settle();

		press('Remove it');
		await settle();
		expect(screen()).toContain('Stop keeping it at origin?');

		press('Stop keeping it there');
		await settle();

		expect(await kept.remotes()).toEqual([]);
	});

	it('asks to stop keeping it there with nothing of an earlier refusal in the question', async () => {
		const kept = new MemoryHistory(folder());
		await kept.addRemote('origin', 'https://example.com/ada/notes.git');
		shellKeeping(kept);
		show();
		await settle();

		press('Add somewhere else');
		await settle();
		type('history-new-place-name', 'origin');
		type('history-new-place-url', 'https://elsewhere.example/ada.git');
		press('Keep it there too');
		await settle();
		expect(alerts().join(' ')).toContain('There is already one called origin.');

		press('Remove it');
		await settle();

		const question = document.body.querySelector('[role="dialog"]')?.textContent ?? '';
		expect(question).toContain('Stop keeping it at origin?');
		expect(question).not.toContain('There is already one called origin.');
	});

	it('asks about it without dressing it as something that cannot be undone', async () => {
		const kept = new MemoryHistory(folder());
		await kept.addRemote('origin', 'https://example.com/ada/notes.git');
		shellKeeping(kept);
		show();
		await settle();

		press('Remove it');
		await settle();

		const yes = [...document.body.querySelectorAll('button')].find(
			(one) => one.textContent?.trim() === 'Stop keeping it there'
		);
		expect(yes).toBeDefined();
		expect(yes?.className).not.toContain('bg-destructive');
	});

	it('offers to let go of the way into a host once nothing is kept there', async () => {
		const kept = new MemoryHistory(folder());
		await kept.addRemote('origin', 'https://example.com/ada/notes.git');
		shellKeeping(kept);
		show();
		await settle();
		press('Add a way in');
		await settle();
		type('history-token-origin', 'abc123');
		press('Save the way in');
		await settle();

		press('Remove it');
		await settle();
		press('Stop keeping it there');
		await settle();

		expect(screen()).toContain('Forget the way into example.com?');

		press('Forget it');
		await settle();

		expect(await readCredentials(privately())).toEqual([]);
	});

	it('holds on to it where the person says so, and where a second place is still there', async () => {
		const kept = new MemoryHistory(folder());
		await kept.addRemote('origin', 'https://example.com/ada/notes.git');
		await kept.addRemote('thesis', 'https://example.com/ada/thesis.git');
		shellKeeping(kept);
		show();
		await settle();
		press('Add a way in');
		await settle();
		type('history-token-origin', 'abc123');
		press('Save the way in');
		await settle();

		press('Remove it');
		await settle();
		press('Stop keeping it there');
		await settle();

		expect(screen()).not.toContain('Forget the way into example.com?');

		press('Remove it');
		await settle();
		press('Stop keeping it there');
		await settle();
		expect(screen()).toContain('Forget the way into example.com?');

		press('Hold on to it');
		await settle();

		expect(await readCredentials(privately())).toEqual([
			{ host: 'example.com', credential: { kind: 'token', token: 'abc123' } }
		]);
	});

	it('says there is nowhere else yet before one is named', async () => {
		shellKeeping(new MemoryHistory(folder()));
		show();
		await settle();

		expect(target.querySelectorAll('li')).toHaveLength(0);
		expect(offers('Add somewhere else')).toBe(true);
	});
});

describe('the way in this device holds', () => {
	it('keeps a token on this device and nothing in the folder', async () => {
		const kept = new MemoryHistory(folder());
		await kept.addRemote('origin', 'https://example.com/ada/notes.git');
		shellKeeping(kept);
		show();
		await settle();

		expect(screen()).toContain('Sloppy has no way into example.com yet.');

		press('Add a way in');
		await settle();
		type('history-token-origin', 'abc123');
		type('history-username-origin', 'ada');
		press('Save the way in');
		await settle();

		expect(await readCredentials(privately())).toEqual([
			{ host: 'example.com', credential: { kind: 'token', username: 'ada', token: 'abc123' } }
		]);
		expect([...store.keys()].filter((path) => path.startsWith(`${ROOT}/`))).toEqual([]);
		expect(screen()).toContain('Sloppy can get into example.com.');
	});

	it('takes the key this app keeps instead of a token', async () => {
		const kept = new MemoryHistory(folder());
		await kept.addRemote('origin', 'https://example.com/ada/notes.git');
		shellKeeping(kept);
		show();
		await settle();

		press('Add a way in');
		await settle();
		pick('way-origin', 'ssh');
		await settle();
		press('Save the way in');
		await settle();

		expect(await readCredentials(privately())).toEqual([
			{ host: 'example.com', credential: { kind: 'ssh', key: { kind: 'kept' } } }
		]);
	});

	it('asks where a key somebody names is before holding it', async () => {
		const kept = new MemoryHistory(folder());
		await kept.addRemote('origin', 'https://example.com/ada/notes.git');
		shellKeeping(kept);
		show();
		await settle();

		press('Add a way in');
		await settle();
		pick('way-origin', 'ssh');
		await settle();
		pick('key-origin', 'file');
		await settle();
		press('Save the way in');
		await settle();

		expect(await readCredentials(privately())).toEqual([]);
		expect(alerts().join(' ')).toContain('where the key is');

		type('history-way-key-origin', '~/.ssh/id_ed25519');
		press('Save the way in');
		await settle();

		expect(await readCredentials(privately())).toEqual([
			{
				host: 'example.com',
				credential: { kind: 'ssh', key: { kind: 'file', path: '~/.ssh/id_ed25519' } }
			}
		]);
	});

	it('lets go of one when somebody says', async () => {
		const kept = new MemoryHistory(folder());
		await kept.addRemote('origin', 'https://example.com/ada/notes.git');
		shellKeeping(kept);
		show();
		await settle();

		press('Add a way in');
		await settle();
		type('history-token-origin', 'abc123');
		press('Save the way in');
		await settle();

		press('Change the way in');
		await settle();
		press('Forget it');
		await settle();

		expect(await readCredentials(privately())).toEqual([]);
		expect(screen()).toContain('Sloppy has no way into example.com yet.');
	});

	it('says one way in reaches every place at that host', async () => {
		const kept = new MemoryHistory(folder());
		await kept.addRemote('origin', 'https://example.com/ada/notes.git');
		await kept.addRemote('thesis', 'https://example.com/ada/thesis.git');
		shellKeeping(kept);
		show();
		await settle();

		press('Add a way in');
		await settle();

		expect(screen()).toContain('Everywhere you keep your graph at example.com is reached with it.');
	});

	it('offers none for a folder somewhere else on this same device', async () => {
		const kept = new MemoryHistory(folder());
		await kept.addRemote('stick', '/Volumes/stick/notes');
		shellKeeping(kept);
		show();
		await settle();

		expect(offers('Add a way in')).toBe(false);
		expect(screen()).not.toContain('no way into');
	});

	it('offers none where this device holds none at all', async () => {
		const kept = new MemoryHistory(folder());
		await kept.addRemote('origin', 'https://example.com/ada/notes.git');
		shellKeeping(kept, false);
		show();
		await settle();

		expect(offers('Add a way in')).toBe(false);
	});
});

describe('another folder opening', () => {
	/** As the shell does when somebody opens a second folder: the history in
	 *  front of them is that folder's, and so is the graph. */
	function opening(first: History): (next: History, graph: OwnedRef) => Promise<void> {
		let open = first;
		let here = 'did:plc:one/01AAAAAAAAAAAAAAAAAAAAAAAA' as OwnedRef;
		initRuntime({
			apiHost: () => '',
			mode: () => 'local',
			history: () => open,
			vault: {
				folder: () => ROOT,
				graph: async () => here,
				open: async () => ROOT,
				asks: true
			},
			gitDefaults: new DeviceGitDefaults(folder()),
			credentials: new DeviceCredentials(folder())
		});
		return async (next, graph) => {
			open = next;
			here = graph;
			await graphs.readOpenFolder(true);
		};
	}

	it('leaves nothing typed for the folder before in front of the next one', async () => {
		const openAnother = opening(new MemoryHistory(folder()));
		show();
		await settle();

		type('history-by-name', 'Ada Lovelace');
		type('history-by-email', 'ada@example.com');
		pick('signing', 'file');
		await settle();
		type('history-key-file', '~/.ssh/id_ed25519');
		await settle();

		await openAnother(
			new MemoryHistory(folder(ELSEWHERE)),
			'did:plc:two/01BBBBBBBBBBBBBBBBBBBBBBBB' as OwnedRef
		);
		await settle();

		expect(target.querySelector<HTMLInputElement>('#history-by-name')?.value).toBe('');
		expect(target.querySelector<HTMLInputElement>('#history-by-email')?.value).toBe('');
		expect(screen()).toContain("it is your graph's owner");
		const off = target.querySelector<HTMLInputElement>('input[name="signing"][value="none"]');
		expect(off?.checked).toBe(true);
		expect(target.querySelector('#history-key-file')).toBeNull();
	});

	it('leaves what is being typed alone when the rest of Settings changes', async () => {
		const kept = new MemoryHistory(folder());
		await kept.addRemote('origin', 'https://example.com/ada/notes.git');
		shellKeeping(kept);
		show();
		await settle();

		type('history-by-name', 'Ada Lovelace');
		type('history-by-email', 'ada@example.com');
		press('Add a way in');
		await settle();
		type('history-token-origin', 'a-token');

		prefs.set('theme', prefs.current.theme === 'paper' ? 'graphite' : 'paper');
		await settle();

		expect(target.querySelector<HTMLInputElement>('#history-by-name')?.value).toBe('Ada Lovelace');
		expect(target.querySelector<HTMLInputElement>('#history-by-email')?.value).toBe(
			'ada@example.com'
		);
		expect(target.querySelector<HTMLInputElement>('#history-token-origin')?.value).toBe('a-token');
	});

	it('shows the next folder its own way of signing', async () => {
		const signed = new MemoryHistory(folder(ELSEWHERE));
		await signed.setSigning({ kind: 'ssh', key: { kind: 'file', path: '~/.ssh/thesis' } });
		const openAnother = opening(new MemoryHistory(folder()));
		show();
		await settle();

		await openAnother(signed, 'did:plc:two/01BBBBBBBBBBBBBBBBBBBBBBBB' as OwnedRef);
		await settle();

		const file = target.querySelector<HTMLInputElement>('input[name="signing"][value="file"]');
		expect(file?.checked).toBe(true);
		expect(target.querySelector<HTMLInputElement>('#history-key-file')?.value).toBe(
			'~/.ssh/thesis'
		);
	});
});
