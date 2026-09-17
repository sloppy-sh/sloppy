import type { AppRuntime } from '@sloppy/app-core';
import type { Credential } from '@sloppy/local';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('PUBLIC_ENABLE_LOCAL_MODE', 'true');

let registered: Partial<AppRuntime> = {};
const resetApi = vi.fn();
vi.mock('@sloppy/app-core', () => ({
	initRuntime: (rt: Partial<AppRuntime>) => {
		registered = rt;
	},
	resetApi: () => resetApi(),
	session: { clear: vi.fn() }
}));

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('./deep-link', () => ({ SIGN_IN_CALLBACK: 'sloppy://auth/callback' }));

/** What the device's files were asked to bring over, and from where. */
const broughtOver: { url: string; into: string; credential?: Credential }[] = [];

/** A device that can bring a folder over. The act itself puts the graph that
 *  was kept at the address into the folder it was given. */
vi.mock('./files', async (importOriginal) => {
	const real = await importOriginal<typeof import('./files')>();
	return {
		...real,
		tauriFiles: (...args: Parameters<typeof real.tauriFiles>) =>
			Object.assign(real.tauriFiles(...args), {
				clone: async (url: string, into: string, credential?: Credential) => {
					broughtOver.push({ url, into, ...(credential ? { credential } : {}) });
					held.set(
						`${into}/graph.json`,
						btoa(
							JSON.stringify({
								format: 1,
								graph: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
								name: 'The garden',
								owner: 'did:syr:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
							})
						)
					);
				}
			})
	};
});

/** The device's files, as `src-tauri` answers for them: one store keyed by the
 *  absolute path, and a folder somebody would pick. */
const held = new Map<string, string>();
let picks: string | null = '/Users/me/garden';
let picking: 'answers' | 'fails' = 'answers';
/** Each act asked of the history, with the folder it was asked about. */
const historyAsked: [string, string][] = [];

vi.mock('@tauri-apps/api/core', () => ({
	convertFileSrc: (path: string, scheme: string) => `${scheme}://localhost/${path}`,
	invoke: async (command: string, args?: Record<string, unknown>) => {
		const at = `${args?.root as string}/${args?.path as string}`;
		switch (command) {
			case 'app_data_path':
				return '/data';
			case 'pick_folder':
				if (picking === 'fails') throw new Error('the folder could not be opened');
				return picks;
			case 'files_read':
				return held.get(at) ?? null;
			case 'files_write':
				held.set(at, args?.bytes as string);
				return null;
			case 'files_exists':
				return held.has(at);
			case 'history_head':
				historyAsked.push([command, args?.root as string]);
				return 'a1b2c3';
			case 'files_list': {
				const under = `${args?.root as string}/`;
				return [...held.keys()]
					.filter((path) => path.startsWith(under))
					.map((path) => path.slice(under.length));
			}
			default:
				return null;
		}
	}
}));

/** A graph written in `folder`, as the app writes one once it is opened. */
function wroteIn(folder: string): void {
	held.set(`${folder}/graph.json`, '');
}

/** A launch of the app on `platform`, as the Tauri CLI spells it: fresh module
 *  state, `initNativeRuntime` called the way the root layout calls it. */
async function launch(platform = 'desktop'): Promise<typeof import('./runtime.js')> {
	vi.stubEnv('PUBLIC_ENABLE_LOCAL_MODE', 'true');
	vi.stubEnv('TAURI_ENV_PLATFORM', platform);
	vi.resetModules();
	const shell = await import('./runtime.js');
	shell.initNativeRuntime();
	return shell;
}

/** Where the api reads a graph out of right now. */
function servedFrom(): string {
	return (registered.createApi?.() as unknown as { files: { root: string } }).files.root;
}

describe('the native shell in local mode', () => {
	beforeEach(() => {
		held.clear();
		picks = '/Users/me/garden';
		picking = 'answers';
		historyAsked.length = 0;
		resetApi.mockClear();
	});

	it('serves the graph off this device, with no server to reach', async () => {
		await launch();

		expect(registered.mode?.()).toBe('local');
		expect(registered.vault).toBeDefined();
	});

	it('has no folder to open on a device that has never had one', async () => {
		const shell = await launch();

		expect(await shell.openRememberedVault()).toBeUndefined();
		expect(registered.vault?.folder()).toBeUndefined();
	});

	it('opens the folder somebody names and serves the graph out of it', async () => {
		await launch();

		expect(await registered.vault?.open()).toBe('/Users/me/garden');
		expect(registered.vault?.folder()).toBe('/Users/me/garden');
		expect(servedFrom()).toBe('/Users/me/garden');
		expect(resetApi).toHaveBeenCalled();
	});

	it('opens that same folder again the next time the app starts', async () => {
		await launch();
		await registered.vault?.open();
		wroteIn('/Users/me/garden');

		const again = await launch();
		expect(registered.vault?.folder()).toBeUndefined();
		expect(await again.openRememberedVault()).toBe('/Users/me/garden');
		expect(servedFrom()).toBe('/Users/me/garden');
	});

	it('offers a folder rather than an empty graph where the last one has been moved', async () => {
		await launch();
		await registered.vault?.open();
		wroteIn('/Users/me/garden');

		for (const path of [...held.keys()]) {
			if (path.startsWith('/Users/me/garden')) held.delete(path);
		}
		const again = await launch();

		expect(await again.openRememberedVault()).toBeUndefined();
		expect(again.vaultIsMissing()).toBe(true);
		expect(registered.vault?.folder()).toBeUndefined();
	});

	// Every read of it would land in a graph that is not there.
	it('offers a folder rather than one that holds files but no graph', async () => {
		await launch();
		await registered.vault?.open();
		wroteIn('/Users/me/garden');

		held.delete('/Users/me/garden/graph.json');
		held.set('/Users/me/garden/README.md', '');
		const again = await launch();

		expect(await again.openRememberedVault()).toBeUndefined();
		expect(again.vaultIsMissing()).toBe(true);
	});

	it('answers with the graph in the folder it has open', async () => {
		const shell = await launch();
		await registered.vault?.open();

		const here = await registered.vault?.graph();

		expect(here).toMatch(/^did:syr:[^/]+\/[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(await shell.openRememberedVault()).toBe('/Users/me/garden');
	});

	it('answers with the graph in the folder opened next', async () => {
		await launch();
		await registered.vault?.open();
		const first = await registered.vault?.graph();

		picks = '/Users/me/thesis';
		await registered.vault?.open();

		expect(await registered.vault?.graph()).not.toBe(first);
	});

	// app-core asks for one again only after `resetApi`, which is what a switch,
	// a merge or a settled conflict leaves behind.
	it('reads the folder again rather than the graph it read before the history moved it', async () => {
		await launch();
		await registered.vault?.open();

		const before = registered.createApi?.() as unknown as { files: { root: string } };
		const after = registered.createApi?.() as unknown as { files: { root: string } };

		expect(after).not.toBe(before);
		expect(after.files.root).toBe('/Users/me/garden');
		expect(before.files.root).toBe('/Users/me/garden');
	});

	it('has no graph to name before a folder is open', async () => {
		await launch();

		expect(await registered.vault?.graph()).toBeUndefined();
	});

	it('has nothing to say about a folder on a device that has never had one', async () => {
		const shell = await launch();

		expect(await shell.openRememberedVault()).toBeUndefined();
		expect(shell.vaultIsMissing()).toBe(false);
	});

	it('leaves the folder alone where somebody named none', async () => {
		await launch();
		await registered.vault?.open();
		picks = null;

		expect(await registered.vault?.open()).toBeUndefined();
		expect(registered.vault?.folder()).toBe('/Users/me/garden');
	});

	it('has no states to read before a folder is open', async () => {
		await launch();

		expect(registered.history?.()).toBeUndefined();
	});

	it('reads the states of the folder it has open', async () => {
		await launch();
		await registered.vault?.open();

		expect(await registered.history?.()?.currentCommit()).toBe('a1b2c3');
		expect(historyAsked).toContainEqual(['history_head', '/Users/me/garden']);
	});

	it('asks where a desktop can ask', async () => {
		await launch();

		expect(registered.vault?.asks).toBe(true);
	});

	it('opens the one folder a phone keeps its graphs in without asking', async () => {
		const shell = await launch('ios');

		expect(registered.vault?.asks).toBe(false);
		expect(await shell.openRememberedVault()).toBe('/Users/me/garden');
		expect(servedFrom()).toBe('/Users/me/garden');
	});

	// The app's own documents folder moves with the app, so a path written down
	// before it moved is a graph nobody can find.
	it('asks a phone where its documents are again rather than remembering where they were', async () => {
		const first = await launch('ios');
		await first.openRememberedVault();

		picks = '/var/containers/2/Documents';
		const again = await launch('ios');

		expect(await again.openRememberedVault()).toBe('/var/containers/2/Documents');
		expect(servedFrom()).toBe('/var/containers/2/Documents');
	});

	it('offers a folder on a phone whose own one could not be opened', async () => {
		picking = 'fails';
		const shell = await launch('ios');

		expect(await shell.openRememberedVault()).toBeUndefined();
		expect(registered.vault?.folder()).toBeUndefined();
	});
});

describe('which identity the shell serves a folder under', () => {
	const MINE = 'did:syr:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';
	const THEIRS = 'did:syr:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG';
	const NOBODY_HERE = 'did:syr:z6MkfZ6S4NSVCRNSg8pcwn9jrWbCNoFejYHqJVFYnfChiFga';

	function graphIn(folder: string, owner: string): void {
		held.set(
			`${folder}/graph.json`,
			btoa(
				JSON.stringify({
					format: 1,
					graph: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
					name: 'A graph',
					owner
				})
			)
		);
	}

	function holds(dids: string[], writing: string): void {
		held.set(
			'/data/identities.json',
			btoa(
				JSON.stringify({
					identities: dids.map((did) => ({
						did,
						public_key: 'zPublic',
						source: 'device',
						seed: `${did}.key`
					})),
					writing
				})
			)
		);
	}

	/** Whose writing the api serves this folder under. */
	function writingAs(): Promise<string> {
		return (registered.createApi?.() as unknown as { writer: Promise<string> }).writer;
	}

	beforeEach(() => {
		held.clear();
		picks = '/Users/me/garden';
		picking = 'answers';
	});

	it('writes as the folder owner where this device holds that identity', async () => {
		holds([MINE, THEIRS], MINE);
		graphIn('/Users/me/garden', THEIRS);
		await launch();

		await registered.vault?.open();

		expect(await writingAs()).toBe(THEIRS);
	});

	it('writes as the one chosen here in a folder belonging to somebody else', async () => {
		holds([MINE], MINE);
		graphIn('/Users/me/garden', THEIRS);
		await launch();

		await registered.vault?.open();

		expect(await writingAs()).toBe(MINE);
	});

	it('settles it again when the identities on the device change', async () => {
		holds([MINE], MINE);
		graphIn('/Users/me/garden', NOBODY_HERE);
		await launch();
		await registered.vault?.open();
		expect(await writingAs()).toBe(MINE);

		holds([MINE, THEIRS], MINE);
		await registered.identities?.writeAs(THEIRS);

		expect(await writingAs()).toBe(THEIRS);
	});

	it('offers the identities this device holds', async () => {
		holds([MINE], MINE);
		await launch();

		expect((await registered.identities?.list())?.map((one) => one.did)).toEqual([MINE]);
	});
});

describe('the folders this device keeps its graphs in', () => {
	const ADA = 'did:syr:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';
	const GARDEN = '/Users/me/garden';
	const THESIS = '/Users/me/thesis';
	const BROUGHT = '/Users/me/brought';

	function graphIn(folder: string, name: string, graph: string): void {
		held.set(`${folder}/graph.json`, btoa(JSON.stringify({ format: 1, graph, name, owner: ADA })));
	}

	/** Folders this device has opened before, oldest first. */
	function knows(...folders: string[]): void {
		held.set(
			'/data/vaults.json',
			btoa(
				JSON.stringify(
					folders.map((root, put) => ({
						root,
						created_at: new Date(put + 1).toISOString(),
						updated_at: new Date(put + 1).toISOString()
					}))
				)
			)
		);
	}

	/** Two folders this device has opened, each holding its own graph. */
	function knowsBoth(): void {
		knows(GARDEN, THESIS);
		graphIn(GARDEN, 'The garden', '01ARZ3NDEKTSV4RRFFQ69G5FAV');
		graphIn(THESIS, 'The thesis', '01ARZ3NDEKTSV4RRFFQ69G5FAW');
	}

	beforeEach(() => {
		held.clear();
		picks = GARDEN;
		picking = 'answers';
		broughtOver.length = 0;
		resetApi.mockClear();
	});

	it('are listed as the graphs they hold, the one opened last first', async () => {
		knowsBoth();
		await launch();

		const known = await registered.vault?.known?.();

		expect(known?.map((one) => one.graph?.name)).toEqual(['The thesis', 'The garden']);
		expect(known?.map((one) => one.root)).toEqual([THESIS, GARDEN]);
		expect(known?.[0].graph?.ref).toBe(`${ADA}/01ARZ3NDEKTSV4RRFFQ69G5FAW`);
		expect(known?.[0].graph?.owner).toBe(ADA);
	});

	it('keep one that is not where it was, with nothing in it to open', async () => {
		knows(GARDEN);
		await launch();

		const [gone] = (await registered.vault?.known?.()) ?? [];

		expect(gone.root).toBe(GARDEN);
		expect(gone.reachable).toBe(false);
		expect(gone.graph).toBeUndefined();
	});

	it('are opened by naming one, which is the graph in front of somebody then', async () => {
		knowsBoth();
		await launch();

		await registered.vault?.openKnown?.(THESIS);

		expect(registered.vault?.folder()).toBe(THESIS);
		expect(servedFrom()).toBe(THESIS);
		expect(resetApi).toHaveBeenCalled();
		// And it is the folder the next launch opens.
		expect(await (await launch()).openRememberedVault()).toBe(THESIS);
	});

	it('read the one opened again as the newest, wherever it was written down', async () => {
		knowsBoth();
		await launch();

		await registered.vault?.openKnown?.(GARDEN);

		expect((await registered.vault?.known?.())?.map((one) => one.root)).toEqual([GARDEN, THESIS]);
	});

	it('lose one that is forgotten, and keep everything inside it', async () => {
		knowsBoth();
		await launch();

		await registered.vault?.forget?.(GARDEN);

		expect((await registered.vault?.known?.())?.map((one) => one.root)).toEqual([THESIS]);
		expect(held.has(`${GARDEN}/graph.json`)).toBe(true);
	});

	it('gain the one somebody starts, which is opened straight away', async () => {
		knows(THESIS);
		graphIn(THESIS, 'The thesis', '01ARZ3NDEKTSV4RRFFQ69G5FAW');
		await launch();
		picks = GARDEN;

		expect(await registered.vault?.start?.()).toBe(GARDEN);
		expect(servedFrom()).toBe(GARDEN);
	});

	// The one act that needs a credential is the one it is handed to, and what a
	// person keeps their folders on is nowhere near the folders themselves.
	it('reach the hosts this device was given something for', async () => {
		held.set(
			'/data/credentials.json',
			btoa(
				JSON.stringify([
					{ host: 'somewhere.test', credential: { kind: 'token', token: 'a-token' } }
				])
			)
		);
		await launch();

		expect(await registered.credentials?.forUrl('https://somewhere.test/ada/garden.git')).toEqual({
			kind: 'token',
			token: 'a-token'
		});
		expect(
			await registered.credentials?.forUrl('https://elsewhere.test/ada/garden.git')
		).toBeUndefined();
	});

	it('gain the one brought from an address, into a folder somebody names', async () => {
		knows(THESIS);
		graphIn(THESIS, 'The thesis', '01ARZ3NDEKTSV4RRFFQ69G5FAW');
		await launch();
		picks = BROUGHT;

		const into = await registered.vault?.clone?.('https://somewhere.test/ada/garden.git', {
			kind: 'token',
			token: 'a-token'
		});

		expect(into).toBe(BROUGHT);
		expect(broughtOver).toEqual([
			{
				url: 'https://somewhere.test/ada/garden.git',
				into: BROUGHT,
				credential: { kind: 'token', token: 'a-token' }
			}
		]);
		expect(servedFrom()).toBe(BROUGHT);
		expect((await registered.vault?.known?.())?.map((one) => one.graph?.name)).toEqual([
			'The garden',
			'The thesis'
		]);
	});

	it('gain nothing where nobody says where to put what is brought over', async () => {
		knows(THESIS);
		graphIn(THESIS, 'The thesis', '01ARZ3NDEKTSV4RRFFQ69G5FAW');
		await launch();
		picks = null;

		expect(
			await registered.vault?.clone?.('https://somewhere.test/ada/garden.git')
		).toBeUndefined();
		expect(broughtOver).toEqual([]);
	});

	it('are one folder and no list of them where a device keeps its graphs in one place', async () => {
		await launch('ios');

		expect(registered.vault?.known).toBeUndefined();
		expect(registered.vault?.openKnown).toBeUndefined();
		expect(registered.vault?.forget).toBeUndefined();
		expect(registered.vault?.start).toBeUndefined();
		expect(registered.vault?.clone).toBeUndefined();
	});
});
