import 'fake-indexeddb/auto';
import { DeviceGitDefaults, MemoryFiles, MemoryHistory } from '@sloppy/local';
import type { Tag } from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	initRuntime,
	type KnownFolder,
	type OpenTabs,
	type TabsAccess,
	type VaultAccess
} from '../runtime.js';
import { DID, ref, useFakeApi, VIEWER, type FakeApi } from './fake-api.test-support.js';
import { graphs } from './graphs.svelte.js';
import { type FolderView, prefs } from './prefs.svelte.js';
import { session } from './session.svelte.js';
import { tags } from './tags.svelte.js';
import { folderName, type TabPage, tabs } from './tabs.svelte.js';

const GARDEN = '/Users/me/Garden';
const THESIS = '/Users/me/thesis';
const COMPANY = '/Users/me/Company';

/** Only the first of the three is a folder a graph names itself in. */
const NAMED: Record<string, string | undefined> = { [GARDEN]: 'Garden' };

const READING: FolderView = {
	graph: null,
	alsoOnCanvas: [],
	tags: [],
	walking: false,
	folded: [],
	unfolded: []
};

/**
 * A shell holding several folders open, and the log the page's own acts are
 * written into beside the shell's — the order of the three is the whole of what
 * a switch promises.
 */
function shell(open: readonly string[], log: string[]) {
	const held = { open: [...open], active: open[0] as string | undefined };
	const told: ((tabs: OpenTabs) => void)[] = [];
	const say = () => {
		for (const hear of told) hear({ open: [...held.open], active: held.active });
	};
	const listed = (root: string): KnownFolder => {
		const name = NAMED[root];
		if (name === undefined) return { root, reachable: true };
		return { root, graph: { ref: ref(20), name, owner: DID }, reachable: true };
	};
	const vault: VaultAccess = {
		folder: () => held.active,
		graph: async () => (held.active === undefined ? undefined : ref(20)),
		asks: true,
		open: async () => held.active,
		known: async () => held.open.map(listed),
		async openKnown(root: string) {
			log.push(`served ${root}`);
			if (!held.open.includes(root)) held.open.push(root);
			held.active = root;
			say();
		}
	};
	const access: TabsAccess = {
		held: () => ({ open: [...held.open], active: held.active }),
		async close(root: string) {
			if (held.open.length < 2) throw new Error('Keep one folder open.');
			const at = held.open.indexOf(root);
			if (at < 0) return;
			held.open.splice(at, 1);
			if (held.active === root) held.active = held.open[Math.min(at, held.open.length - 1)];
			say();
		},
		changed(hear: (tabs: OpenTabs) => void) {
			told.push(hear);
			return () => {
				const at = told.indexOf(hear);
				if (at >= 0) told.splice(at, 1);
			};
		}
	};
	return { held, vault, access };
}

function serving(vault: VaultAccess, access?: TabsAccess): void {
	initRuntime({ apiHost: () => 'http://api.test', vault, tabs: access });
}

/** The page's two acts, written into the log the shell's are. */
function watching(log: string[]): TabPage {
	return {
		leaving: (root) => log.push(`leaving ${root}`),
		arrived: (root) => log.push(`arrived ${root}`)
	};
}

let api: FakeApi;
let log: string[];
let stopServing: (() => void) | null = null;

beforeEach(async () => {
	localStorage.clear();
	prefs.init();
	graphs.clear();
	tabs.clear();
	log = [];
	api = useFakeApi();
	api.on('GET /auth/me', () => VIEWER);
	await session.refresh();
});

afterEach(() => {
	stopServing?.();
	stopServing = null;
	tabs.clear();
	graphs.clear();
	session.clear();
	localStorage.clear();
	initRuntime({ apiHost: () => 'http://api.test', vault: undefined, tabs: undefined });
});

describe('the folders open at once', () => {
	it('are a strip only once there are two of them to tell apart', () => {
		const one = shell([GARDEN], log);
		serving(one.vault, one.access);
		tabs.boot();
		expect(tabs.shows).toBe(false);
		expect(tabs.rows).toHaveLength(1);

		tabs.clear();
		const two = shell([GARDEN, THESIS], log);
		serving(two.vault, two.access);
		tabs.boot();
		expect(tabs.shows).toBe(true);
	});

	it('are named by the graph in them, and by the folder where none names one', async () => {
		const open = shell([GARDEN, THESIS], log);
		serving(open.vault, open.access);
		await graphs.readFolders();
		tabs.boot();

		expect(tabs.rows).toEqual([
			{ root: GARDEN, name: 'Garden', active: true },
			{ root: THESIS, name: 'thesis', active: false }
		]);
	});

	it('is what a folder is called where this device can read no graph in it', () => {
		expect(folderName('/Users/me/thesis')).toBe('thesis');
		expect(folderName('C:\\Users\\me\\Garden')).toBe('Garden');
		expect(folderName('/')).toBe('/');
	});

	it('say which is in front, and nothing until the shell has been read', () => {
		const open = shell([GARDEN, THESIS], log);
		serving(open.vault, open.access);
		expect(tabs.open).toEqual([]);

		tabs.boot();

		expect(tabs.open).toEqual([GARDEN, THESIS]);
		expect(tabs.active).toBe(GARDEN);
	});

	it('are read once however many surfaces ask', () => {
		const open = shell([GARDEN, THESIS], log);
		serving(open.vault, open.access);
		tabs.boot();
		tabs.boot();
		expect(tabs.open).toEqual([GARDEN, THESIS]);
	});
});

describe('putting another folder in front', () => {
	it('snapshots what is being left, serves the other folder, then brings it back', async () => {
		const open = shell([GARDEN, THESIS], log);
		serving(open.vault, open.access);
		tabs.boot();
		stopServing = tabs.serves(watching(log));

		await tabs.switchTo(THESIS);

		expect(log).toEqual([`leaving ${GARDEN}`, `served ${THESIS}`, `arrived ${THESIS}`]);
		expect(tabs.active).toBe(THESIS);
	});

	it('is nothing at all for the folder already in front', async () => {
		const open = shell([GARDEN, THESIS], log);
		serving(open.vault, open.access);
		tabs.boot();
		stopServing = tabs.serves(watching(log));

		await tabs.switchTo(GARDEN);

		expect(log).toEqual([]);
	});

	it('arrives at whatever an opening put in front', async () => {
		const open = shell([GARDEN], log);
		serving(open.vault, open.access);
		tabs.boot();
		stopServing = tabs.serves(watching(log));

		const opened = await tabs.openWith(async () => {
			await open.vault.openKnown?.(COMPANY);
			return true;
		});

		expect(opened).toBe(true);
		expect(log).toEqual([`leaving ${GARDEN}`, `served ${COMPANY}`, `arrived ${COMPANY}`]);
	});

	it('arrives nowhere where nobody named a folder', async () => {
		const open = shell([GARDEN], log);
		serving(open.vault, open.access);
		tabs.boot();
		stopServing = tabs.serves(watching(log));

		const opened = await tabs.openWith(async () => false);

		expect(opened).toBe(false);
		expect(log).toEqual([`leaving ${GARDEN}`]);
	});

	// The strip stands above every page, so a reader is not on the reading
	// surface when they tap another folder.
	it('gives up what was read out of the folder that was, page or no page', async () => {
		const open = shell([GARDEN, THESIS], log);
		serving(open.vault, open.access);
		tabs.boot();
		tags.select(['seed' as Tag]);

		await tabs.switchTo(THESIS);

		expect(tags.selected).toEqual([]);
		expect(log).toEqual([`served ${THESIS}`]);
	});

	// Opening one is where this runs, not switching to one: a folder already
	// open on this device has been given it.
	it('gives a folder opened here what this device gives a new one', async () => {
		const open = shell([GARDEN], log);
		const files = new MemoryFiles({ root: GARDEN, store: new Map(), data: '/data' });
		const history = new MemoryHistory(files);
		const defaults = new DeviceGitDefaults(files);
		await defaults.write({ user: { name: 'Me', email: 'me@sloppy.test' } });
		initRuntime({
			apiHost: () => 'http://api.test',
			vault: open.vault,
			tabs: open.access,
			history: () => history,
			gitDefaults: defaults
		});
		tabs.boot();

		await tabs.openWith(async () => {
			await open.vault.openKnown?.(COMPANY);
			return true;
		});

		expect(await history.gitUser()).toEqual({ name: 'Me', email: 'me@sloppy.test' });
	});

	it('runs one switch at a time', async () => {
		const open = shell([GARDEN, THESIS, COMPANY], log);
		serving(open.vault, open.access);
		tabs.boot();
		stopServing = tabs.serves(watching(log));

		await Promise.all([tabs.switchTo(THESIS), tabs.switchTo(COMPANY)]);

		expect(log).toEqual([
			`leaving ${GARDEN}`,
			`served ${THESIS}`,
			`arrived ${THESIS}`,
			`leaving ${THESIS}`,
			`served ${COMPANY}`,
			`arrived ${COMPANY}`
		]);
	});
});

describe('taking a folder off', () => {
	it('gives up what was kept of how it was read, and arrives at the one left', async () => {
		const open = shell([GARDEN, THESIS], log);
		serving(open.vault, open.access);
		tabs.boot();
		stopServing = tabs.serves(watching(log));
		prefs.setView(GARDEN, READING);

		await tabs.close(GARDEN);

		expect(prefs.view(GARDEN)).toBeNull();
		expect(tabs.open).toEqual([THESIS]);
		expect(log).toEqual([`leaving ${GARDEN}`, `served ${THESIS}`, `arrived ${THESIS}`]);
	});

	// The shell puts the folder left in front, and the notes on screen are still
	// the closed folder's until that folder is entered.
	it('reads the folder left in front before the page comes back to it', async () => {
		const open = shell([GARDEN, THESIS], log);
		serving(open.vault, open.access);
		await graphs.readOpenFolder();
		tabs.boot();
		stopServing = tabs.serves(watching(log));

		await tabs.close(GARDEN);

		expect(graphs.openFolder).toBe(THESIS);
		expect(log.indexOf(`served ${THESIS}`)).toBeLessThan(log.indexOf(`arrived ${THESIS}`));
	});

	it('moves nobody where the folder taken off is not the one in front', async () => {
		const open = shell([GARDEN, THESIS], log);
		serving(open.vault, open.access);
		tabs.boot();
		stopServing = tabs.serves(watching(log));
		prefs.setView(THESIS, READING);

		await tabs.close(THESIS);

		expect(prefs.view(THESIS)).toBeNull();
		expect(tabs.active).toBe(GARDEN);
		expect(log).toEqual([]);
	});

	// The shell takes a tab off for itself where its folder was forgotten or has
	// gone, so what was kept of the reading cannot be the closer's to give up.
	it('gives it up for a folder the shell takes off itself', async () => {
		const open = shell([GARDEN, THESIS], log);
		serving(open.vault, open.access);
		tabs.boot();
		prefs.setView(THESIS, READING);

		await open.access.close(THESIS);

		expect(tabs.open).toEqual([GARDEN]);
		expect(prefs.view(THESIS)).toBeNull();
	});

	// The shell refuses it, so nothing of the folder's is given up either.
	it('keeps the only folder open, and how it was being read', async () => {
		const open = shell([GARDEN], log);
		serving(open.vault, open.access);
		tabs.boot();
		stopServing = tabs.serves(watching(log));
		prefs.setView(GARDEN, READING);

		await expect(tabs.close(GARDEN)).rejects.toThrow();

		expect(tabs.open).toEqual([GARDEN]);
		expect(prefs.view(GARDEN)).not.toBeNull();
		expect(log).toEqual([]);
	});
});

describe('a shell that opens one folder at a time', () => {
	it('puts nothing about tabs in front of anybody', async () => {
		const open = shell([GARDEN], log);
		serving(open.vault);
		await graphs.readOpenFolder();
		tabs.boot();

		expect(tabs.shows).toBe(false);
		expect(tabs.open).toEqual([]);
		expect(tabs.rows).toEqual([]);
	});

	it('still switches folders, which is how the picker does it', async () => {
		const open = shell([GARDEN], log);
		serving(open.vault);
		await graphs.readOpenFolder();
		tabs.boot();
		stopServing = tabs.serves(watching(log));

		await tabs.switchTo(THESIS);

		expect(log).toEqual([`leaving ${GARDEN}`, `served ${THESIS}`, `arrived ${THESIS}`]);
		expect(graphs.openFolder).toBe(THESIS);
	});

	it('takes no folder off, because it holds no list of them', async () => {
		const open = shell([GARDEN], log);
		serving(open.vault);
		await graphs.readOpenFolder();
		tabs.boot();
		stopServing = tabs.serves(watching(log));
		prefs.setView(GARDEN, READING);

		await tabs.close(GARDEN);

		expect(prefs.view(GARDEN)).not.toBeNull();
		expect(log).toEqual([]);
	});
});
