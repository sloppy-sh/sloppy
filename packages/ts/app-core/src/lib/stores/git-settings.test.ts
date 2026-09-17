// What a folder's versions are by, how they are signed, where else it is kept
// and what this device was given to get in there — driven the way the surface
// drives it, over a folder in memory.

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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initRuntime } from '../runtime.js';
import { gitSettings, onADesktop } from './git-settings.svelte.js';

const ROOT = '/Users/me/garden';
const DATA = '/data';

let store: Map<string, Uint8Array>;

function folder(): MemoryFiles {
	return new MemoryFiles({ root: ROOT, store, data: DATA });
}

/** This device's private data, which is where what it was told stays. */
function privately(): MemoryFiles {
	return new MemoryFiles({ root: DATA, store, data: DATA });
}

/** The shell a surface sees: the folder's history, and what this device keeps
 *  beside every folder. `holds` false is a platform that keeps neither. */
function shellKeeping(over: History | undefined, holds = true): void {
	initRuntime({
		apiHost: () => '',
		mode: () => 'local',
		history: () => over,
		gitDefaults: holds ? new DeviceGitDefaults(folder()) : undefined,
		credentials: holds ? new DeviceCredentials(folder()) : undefined
	});
}

/** A history that answers nothing about any of this, which is every platform
 *  that only keeps versions. */
function onlyVersions(): History {
	const kept = new MemoryHistory(folder()) as History;
	return {
		status: () => kept.status(),
		log: (limit, cursor) => kept.log(limit, cursor),
		commit: (message) => kept.commit(message),
		branches: () => kept.branches(),
		branch: (name) => kept.branch(name),
		switch: (name) => kept.switch(name),
		merge: (name) => kept.merge(name),
		resolve: (path, side) => kept.resolve(path, side),
		readAt: (commit) => kept.readAt(commit),
		currentCommit: () => kept.currentCommit()
	};
}

/** A shell that makes the key it signs with and answers its public half, the
 *  way one that can reach a disk does. */
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

beforeEach(() => {
	store = new Map();
	gitSettings.clear();
});

afterEach(() => {
	gitSettings.clear();
	initRuntime({
		apiHost: () => '',
		mode: () => 'hosted',
		history: () => undefined,
		gitDefaults: undefined,
		credentials: undefined
	});
});

describe('a platform that cannot be told any of it', () => {
	it('offers none of it where there is no history at all', async () => {
		shellKeeping(undefined);

		expect(gitSettings.offers).toBe(false);
		await gitSettings.read();
		expect(gitSettings.places).toEqual([]);
	});

	it('offers none of it where the history only keeps versions', async () => {
		shellKeeping(onlyVersions());

		expect(gitSettings.offers).toBe(false);
		expect(await gitSettings.setUser({ name: 'Ada', email: 'ada@example.com' })).toBe(false);
	});

	it('holds no way in where this device keeps none', () => {
		shellKeeping(new MemoryHistory(folder()), false);

		expect(gitSettings.offers).toBe(true);
		expect(gitSettings.holdsWaysIn).toBe(false);
	});
});

describe('who the versions kept here are by', () => {
	it('is nobody until somebody says', async () => {
		shellKeeping(new MemoryHistory(folder()));

		await gitSettings.read();

		expect(gitSettings.user).toBeUndefined();
	});

	it('is written on the folder and kept for the next one started here', async () => {
		const kept = new MemoryHistory(folder());
		shellKeeping(kept);

		expect(await gitSettings.setUser({ name: 'Ada', email: 'ada@example.com' })).toBe(true);

		expect(await kept.gitUser()).toEqual({ name: 'Ada', email: 'ada@example.com' });
		expect((await readGitDefaults(privately())).user).toEqual({
			name: 'Ada',
			email: 'ada@example.com'
		});
		expect(gitSettings.user).toEqual({ name: 'Ada', email: 'ada@example.com' });
	});

	it('writes it on the folder alone where this device keeps no default', async () => {
		const kept = new MemoryHistory(folder());
		shellKeeping(kept, false);

		expect(await gitSettings.setUser({ name: 'Ada', email: 'ada@example.com' })).toBe(true);

		expect(await kept.gitUser()).toEqual({ name: 'Ada', email: 'ada@example.com' });
		expect(store.has(`${DATA}/git.json`)).toBe(false);
	});
});

describe('how they are signed', () => {
	it('is not signed until somebody says', async () => {
		shellKeeping(new MemoryHistory(folder()));

		await gitSettings.read();

		expect(gitSettings.signing).toEqual({ kind: 'none' });
		expect(gitSettings.keptKey).toBeUndefined();
	});

	it('shows the public half of the key this app keeps, for a host to take', async () => {
		shellKeeping(new KeepsAKey(folder()));

		expect(await gitSettings.signWith({ kind: 'ssh', key: { kind: 'kept' } })).toBe(true);

		expect(gitSettings.keptKey).toBe('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 sloppy');
	});

	it('has no public half to show for a key somebody named', async () => {
		shellKeeping(new KeepsAKey(folder()));

		await gitSettings.signWith({ kind: 'ssh', key: { kind: 'file', path: '~/.ssh/id_ed25519' } });

		expect(gitSettings.keptKey).toBeUndefined();
		expect(gitSettings.signing).toEqual({
			kind: 'ssh',
			key: { kind: 'file', path: '~/.ssh/id_ed25519' }
		});
	});

	it('begins the next folder started here the same way', async () => {
		shellKeeping(new MemoryHistory(folder()));

		await gitSettings.signWith({ kind: 'openpgp', program: 'gpg2' });

		expect((await readGitDefaults(privately())).signing).toEqual({
			kind: 'openpgp',
			program: 'gpg2'
		});
	});
});

describe('where else the graph is kept', () => {
	it('is nowhere until one is named', async () => {
		shellKeeping(new MemoryHistory(folder()));

		await gitSettings.read();

		expect(gitSettings.places).toEqual([]);
	});

	it('names the host an address is at, so a way in can be held for it', async () => {
		shellKeeping(new MemoryHistory(folder()));

		await gitSettings.addPlace('origin', 'https://GitHub.com/ada/notes.git');

		expect(gitSettings.places).toEqual([
			{ name: 'origin', url: 'https://GitHub.com/ada/notes.git', host: 'github.com' }
		]);
	});

	it('has no host for a folder somewhere else on this same device', async () => {
		shellKeeping(new MemoryHistory(folder()));

		await gitSettings.addPlace('backup', '/Volumes/stick/notes');

		expect(gitSettings.places[0].host).toBeUndefined();
		expect(gitSettings.places[0].credential).toBeUndefined();
	});

	it('says what the history said when a name is taken', async () => {
		shellKeeping(new MemoryHistory(folder()));
		await gitSettings.addPlace('origin', 'https://example.com/ada/notes.git');

		expect(await gitSettings.addPlace('origin', 'https://elsewhere.example/ada.git')).toBe(false);

		expect(gitSettings.says).toBe('There is already one called origin.');
		expect(gitSettings.places).toHaveLength(1);
	});

	it('renames one and points it somewhere else', async () => {
		shellKeeping(new MemoryHistory(folder()));
		await gitSettings.addPlace('origin', 'https://example.com/ada/notes.git');

		await gitSettings.setPlaceAddress('origin', 'https://example.com/ada/garden.git');
		await gitSettings.renamePlace('origin', 'mine');

		expect(gitSettings.places).toEqual([
			{ name: 'mine', url: 'https://example.com/ada/garden.git', host: 'example.com' }
		]);
	});

	it('takes one away', async () => {
		shellKeeping(new MemoryHistory(folder()));
		await gitSettings.addPlace('origin', 'https://example.com/ada/notes.git');

		expect(await gitSettings.removePlace('origin')).toBe(true);

		expect(gitSettings.places).toEqual([]);
	});

	it('counts the places one way in serves', async () => {
		shellKeeping(new MemoryHistory(folder()));
		await gitSettings.addPlace('origin', 'https://example.com/ada/notes.git');
		await gitSettings.addPlace('thesis', 'https://example.com/ada/thesis.git');
		await gitSettings.addPlace('other', 'https://elsewhere.example/ada.git');

		expect(gitSettings.placesAt('example.com')).toBe(2);
		expect(gitSettings.placesAt('elsewhere.example')).toBe(1);
	});
});

describe('the way in this device was given', () => {
	it('stays on this device and never goes into the folder', async () => {
		shellKeeping(new MemoryHistory(folder()));
		await gitSettings.addPlace('origin', 'https://example.com/ada/notes.git');

		await gitSettings.holdWayIn('example.com', { kind: 'token', username: 'ada', token: 'abc123' });

		expect(await readCredentials(privately())).toEqual([
			{ host: 'example.com', credential: { kind: 'token', username: 'ada', token: 'abc123' } }
		]);
		expect([...store.keys()].filter((path) => path.startsWith(`${ROOT}/`))).toEqual([]);
	});

	it('is shown beside every place at that host', async () => {
		shellKeeping(new MemoryHistory(folder()));
		await gitSettings.addPlace('origin', 'https://example.com/ada/notes.git');
		await gitSettings.addPlace('thesis', 'https://example.com/ada/thesis.git');

		await gitSettings.holdWayIn('example.com', { kind: 'ssh', key: { kind: 'kept' } });

		expect(gitSettings.places.map((place) => place.credential)).toEqual([
			{ kind: 'ssh', key: { kind: 'kept' } },
			{ kind: 'ssh', key: { kind: 'kept' } }
		]);
	});

	it('is let go of when somebody says', async () => {
		shellKeeping(new MemoryHistory(folder()));
		await gitSettings.addPlace('origin', 'https://example.com/ada/notes.git');
		await gitSettings.holdWayIn('example.com', { kind: 'token', token: 'abc123' });

		expect(await gitSettings.forgetWayIn('example.com')).toBe(true);

		expect(gitSettings.places[0].credential).toBeUndefined();
		expect(await readCredentials(privately())).toEqual([]);
	});
});

describe('whether a program on this device can be run', () => {
	function saying(agent: string, touches = 0): void {
		Object.defineProperty(globalThis.navigator, 'userAgent', {
			configurable: true,
			value: agent
		});
		Object.defineProperty(globalThis.navigator, 'maxTouchPoints', {
			configurable: true,
			value: touches
		});
	}

	it('is a desktop where nothing says otherwise', () => {
		saying('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15');

		expect(onADesktop()).toBe(true);
	});

	it('is not a phone', () => {
		saying('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15', 5);

		expect(onADesktop()).toBe(false);

		saying('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36', 5);

		expect(onADesktop()).toBe(false);
	});

	it('is not a tablet that says it is a desktop', () => {
		saying('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 5);

		expect(onADesktop()).toBe(false);
	});
});
