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

/** What the device was asked to bring over, and from where. */
const broughtOver: { url: string; into: string; credential?: Credential }[] = [];

/** The device's files, as `src-tauri` answers for them: one store keyed by the
 *  absolute path, and a folder somebody would pick. */
const held = new Map<string, string>();
let picks: string | null = '/Users/me/garden';
let picking: 'answers' | 'fails' = 'answers';
/** What each ask for a folder said it was for. */
const askedFor: (string | undefined)[] = [];
/** Each act asked of the history, with the folder it was asked about. */
const historyAsked: [string, string][] = [];
/** The folder each chat was started in. */
const chattedIn: string[] = [];
/** The copy standing for each folder's notes, as `draft.rs` answers them. */
const copies = new Map<string, Record<string, string>>();

vi.mock('@tauri-apps/api/core', () => ({
	// What a tool's answer is streamed back over, which outside a running app
	// is nothing more than the callback the shell sets on it.
	Channel: class {
		onmessage: (line: string) => void = () => {};
	},
	convertFileSrc: (path: string, scheme: string) => `${scheme}://localhost/${path}`,
	invoke: async (command: string, args?: Record<string, unknown>) => {
		const at = `${args?.root as string}/${args?.path as string}`;
		switch (command) {
			case 'app_data_path':
				return '/data';
			case 'pick_folder':
				askedFor.push(args?.asking as string | undefined);
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
			case 'files_clone': {
				const into = args?.into as string;
				const credential = args?.credential as Credential | null;
				// The copy is what refuses a folder somebody already keeps things in,
				// and it does so before it writes anything (`remotes.rs`).
				if ([...held.keys()].some((path) => path.startsWith(`${into}/`))) {
					throw 'There is already something in that folder. Choose an empty one.';
				}
				broughtOver.push({ url: args?.url as string, into, ...(credential ? { credential } : {}) });
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
				return null;
			}
			case 'draft_standing': {
				const standing = copies.get(args?.root as string);
				return standing ? [standing] : [];
			}
			case 'draft_start': {
				const id = args?.id as string;
				const made = {
					id,
					root: `/data/drafts/${id}`,
					vault: `/data/drafts/${id}/.sloppy`,
					branch: `sloppy/draft/${id}`,
					from: 'a1b2c3'
				};
				copies.set(args?.root as string, made);
				return made;
			}
			case 'chat_agents':
				return ['claude_code'];
			case 'chat_open':
				chattedIn.push((args?.asked as { root: string } | undefined)?.root as string);
				return null;
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

/** A project whose notes are in the container inside it, for somebody to pick. */
function projectAt(root: string): void {
	picks = root;
	held.set(
		`${root}/.sloppy/graph.json`,
		btoa(
			JSON.stringify({
				format: 1,
				graph: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
				name: 'The compiler',
				owner: 'did:syr:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
				project: '..'
			})
		)
	);
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
		chattedIn.length = 0;
		copies.clear();
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

	it('serves a project by the notes inside it, and reads their states there', async () => {
		await launch();
		projectAt('/Users/me/compiler');

		await registered.vault?.open();

		// The folder on the list is the project's own root, and the states read
		// are the notes' — the project's history, as the notes are in it.
		expect(registered.vault?.folder()).toBe('/Users/me/compiler');
		expect(servedFrom()).toBe('/Users/me/compiler');
		expect(await registered.history?.()?.currentCommit()).toBe('a1b2c3');
		expect(historyAsked).toContainEqual(['history_head', '/Users/me/compiler/.sloppy']);
	});

	it('chats with an agent on this computer in a copy of the project', async () => {
		await launch();
		projectAt('/Users/me/compiler');
		await registered.vault?.open();

		expect(await registered.chat?.agents()).toEqual(['claude_code']);
		await registered.chat?.open(
			{},
			() => {},
			async () => ({ said: '' })
		);

		// The copy is taken of the notes, and the agent is started in it rather
		// than in the folder somebody has open.
		const draft = await registered.chat?.drafts?.standing();
		expect(copies.get('/Users/me/compiler/.sloppy')).toBeDefined();
		expect(chattedIn).toEqual([draft?.root]);
		expect(chattedIn[0]).not.toBe('/Users/me/compiler');
	});

	it("has nowhere to start a chat about a graph that is nobody's project", async () => {
		await launch();

		await registered.vault?.open();

		await expect(
			registered.chat?.open(
				{},
				() => {},
				async () => ({ said: '' })
			)
		).rejects.toThrow('Open the project these notes are about first.');
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
		historyAsked.length = 0;
		chattedIn.length = 0;
		copies.clear();
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
		expect(await registered.history?.()?.currentCommit()).toBe('a1b2c3');
		expect(historyAsked).toEqual([['history_head', THESIS]]);
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

	it('are not the folder somebody already keeps things in', async () => {
		knows(THESIS);
		graphIn(THESIS, 'The thesis', '01ARZ3NDEKTSV4RRFFQ69G5FAW');
		await launch();
		picks = THESIS;

		await expect(
			registered.vault?.clone?.('https://somewhere.test/ada/garden.git')
		).rejects.toThrow('There is already something in that folder. Choose an empty one.');
		expect(broughtOver).toEqual([]);
		expect(servedFrom()).not.toBe(THESIS);
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

describe('the project whose notes this device opens', () => {
	const ADA = 'did:syr:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';
	const PROJECT = '/Users/me/engine';
	const CONTAINER = `${PROJECT}/.sloppy`;

	/** A graph in `folder`, as a vault holds one. */
	function graphIn(folder: string, name: string, project?: string): void {
		held.set(
			`${folder}/graph.json`,
			btoa(
				JSON.stringify({
					format: 1,
					graph: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
					name,
					owner: ADA,
					...(project === undefined ? {} : { project })
				})
			)
		);
	}

	/** What the graph in `folder` is called, read back off the device. */
	function named(folder: string): string | undefined {
		const bytes = held.get(`${folder}/graph.json`);
		return bytes ? (JSON.parse(atob(bytes)) as { name?: string }).name : undefined;
	}

	beforeEach(() => {
		held.clear();
		picks = PROJECT;
		picking = 'answers';
		historyAsked.length = 0;
		askedFor.length = 0;
		resetApi.mockClear();
	});

	it('is asked for as a project, and a folder for a graph as one', async () => {
		await launch();

		await registered.vault?.openProject?.();
		await registered.vault?.open?.();

		expect(askedFor).toEqual(['project', 'graph']);
	});

	it('is the folder somebody picked, and its notes are the ones kept inside it', async () => {
		graphIn(CONTAINER, 'Engine', '..');
		await launch();

		expect(await registered.vault?.openProject?.()).toBe(PROJECT);
		expect(servedFrom()).toBe(PROJECT);
		expect(registered.vault?.folder()).toBe(PROJECT);
		// The states read are the notes' own, which are the project's.
		expect(await registered.history?.()?.currentCommit()).toBe('a1b2c3');
		expect(historyAsked).toContainEqual(['history_head', CONTAINER]);
	});

	it('is the code a note in it points at', async () => {
		graphIn(CONTAINER, 'Engine', '..');
		await launch();
		await registered.vault?.openProject?.();

		expect((await registered.project?.())?.root).toBe(PROJECT);
	});

	it('is no code to point at where the folder is a graph of its own', async () => {
		graphIn(PROJECT, 'The garden');
		await launch();
		await registered.vault?.open?.();

		expect(await registered.project?.()).toBeUndefined();
	});

	it('is listed under its own folder, with the notes it keeps', async () => {
		graphIn(CONTAINER, 'Engine', '..');
		await launch();
		await registered.vault?.openProject?.();

		const [listed] = (await registered.vault?.known?.()) ?? [];

		expect(listed.root).toBe(PROJECT);
		expect(listed.graph?.name).toBe('Engine');
		expect(listed.graph?.project).toBe('..');
	});

	it('is opened again by its own folder', async () => {
		graphIn(CONTAINER, 'Engine', '..');
		await launch();
		await registered.vault?.openProject?.();

		await registered.vault?.openKnown?.(PROJECT);

		expect(servedFrom()).toBe(PROJECT);
	});

	it('is let go of by its own folder, and keeps the notes inside it', async () => {
		graphIn(CONTAINER, 'Engine', '..');
		await launch();
		await registered.vault?.openProject?.();

		await registered.vault?.forget?.(PROJECT);
		await launch();

		expect(await registered.vault?.known?.()).toEqual([]);
		expect(held.has(`${CONTAINER}/graph.json`)).toBe(true);
	});

	it('is where its notes are started, named for the project and not for them', async () => {
		await launch();

		expect(await registered.vault?.openProject?.()).toBe(PROJECT);
		expect(servedFrom()).toBe(PROJECT);
		expect(named(CONTAINER)).toBe('engine');
		expect(held.has(`${PROJECT}/graph.json`)).toBe(false);
	});

	// A folder somebody already keeps notes in is that folder's graph: starting a
	// second one in the sidecar beside its drawings and keys is not what "open a
	// project" means.
	it('is never a folder that already holds notes', async () => {
		graphIn(PROJECT, 'The garden');
		await launch();

		expect(await registered.vault?.openProject?.()).toBe(PROJECT);
		expect(servedFrom()).toBe(PROJECT);
		expect(held.has(`${CONTAINER}/graph.json`)).toBe(false);
	});

	it('is nothing where nobody names a folder', async () => {
		await launch();
		picks = null;

		expect(await registered.vault?.openProject?.()).toBeUndefined();
		expect(registered.vault?.folder()).toBeUndefined();
	});
});
