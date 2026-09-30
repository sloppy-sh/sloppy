// @vitest-environment jsdom
import type { OwnedRef } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Refusal } from '$lib/refusal.js';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import GraphsSheet from './graphs-sheet.svelte';

const HOME = 'did:syr:z6MkAda/00000000000000000000000000' as OwnedRef;
const GARDEN = 'did:syr:z6MkAda/01ARZ3NDEKTSV4RRFFQ69G5FAV' as OwnedRef;

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let closed: OwnedRef[];
let shown: number;

async function settle(): Promise<void> {
	for (let at = 0; at < 4; at++) {
		flushSync();
		await new Promise((done) => setTimeout(done, 0));
	}
	flushSync();
}

async function open(
	onRemove: (ref: OwnedRef) => Promise<void> = () => Promise.resolve(),
	publishedFrom: ReadonlySet<OwnedRef> | undefined = undefined
): Promise<void> {
	if (mounted) unmount(mounted, { outro: false });
	document.body.innerHTML = '';
	target = document.createElement('div');
	document.body.appendChild(target);
	closed = [];
	shown = 0;
	mounted = mount(GraphsSheet, {
		target,
		props: {
			open: true,
			graphs: [
				{ ref: HOME, title: 'My graph' },
				{ ref: GARDEN, title: 'Garden' }
			],
			current: HOME,
			home: HOME,
			alsoUp: new Set<OwnedRef>(),
			publishedFrom,
			onEnter: () => {},
			onToggle: () => {},
			onOpen: () => Promise.resolve(),
			onRename: () => Promise.resolve(),
			onRemove: (ref: OwnedRef) => {
				closed.push(ref);
				return onRemove(ref);
			},
			onShow: () => {
				shown += 1;
			}
		}
	});
	await settle();
}

const find = (label: string): HTMLElement | null =>
	document.querySelector<HTMLElement>(`[aria-label="${label}"]`);

/** The button in the question a destructive act is asked through. */
const confirm = (words: string): HTMLElement | null =>
	[...document.querySelectorAll<HTMLElement>('button')].find(
		(button) => button.textContent?.trim() === words
	) ?? null;

beforeEach(() => {
	// The sheet at the width a desktop reader has, which is a centred dialog.
	stubMediaQuery((query) => query.includes('min-width'));
	stubResizeObserver();
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	document.body.innerHTML = '';
});

describe('the graphs sheet', () => {
	it('asks for what it lists when it opens', async () => {
		await open();
		expect(shown).toBe(1);
	});

	it('offers no way to start a graph where this app has nowhere to put one', async () => {
		await open();
		expect(document.body.textContent).toContain('A new graph');

		if (mounted) unmount(mounted, { outro: false });
		document.body.innerHTML = '';
		target = document.createElement('div');
		document.body.appendChild(target);
		mounted = mount(GraphsSheet, {
			target,
			props: {
				open: true,
				graphs: [{ ref: HOME, title: 'My graph' }],
				current: HOME,
				home: HOME,
				alsoUp: new Set<OwnedRef>(),
				onEnter: () => {},
				onToggle: () => {},
				onRename: () => Promise.resolve()
			}
		});
		await settle();

		expect(document.body.textContent).not.toContain('A new graph');
	});

	// AI.md § "The Genealogy Is the Protocol": a branch whose number went to
	// another note waits under its title, with nothing standing where one was.
	it('offers no way to close the graph somebody started with', async () => {
		await open();
		expect(find('Close My graph')).toBeNull();
		expect(find('Close Garden')).not.toBeNull();
	});

	it('asks before closing a graph, naming what goes and what stays out', async () => {
		await open();

		find('Close Garden')?.click();
		await settle();

		const text = document.body.textContent ?? '';
		expect(text).toContain('Close Garden?');
		expect(text).toContain('they cannot be put back');
		expect(text).toContain('Whoever already has a branch you published from it keeps their copy');
		expect(closed).toEqual([]);
	});

	it('leaves out what a peer keeps where nothing went out of that graph', async () => {
		await open(undefined, new Set([HOME]));

		find('Close Garden')?.click();
		await settle();

		const text = document.body.textContent ?? '';
		expect(text).toContain('they cannot be put back');
		expect(text).not.toContain('keeps their copy');
	});

	it('says what a peer keeps where a branch went out of that graph', async () => {
		await open(undefined, new Set([GARDEN]));

		find('Close Garden')?.click();
		await settle();

		expect(document.body.textContent).toContain(
			'Whoever already has a branch you published from it keeps their copy'
		);
	});

	it('holds a graph name to the length one can be saved at', async () => {
		await open();

		const naming = [...document.querySelectorAll<HTMLInputElement>('input')].filter(
			(input) => input.maxLength === 512
		);
		expect(naming.length).toBe(1);

		find('Rename Garden')?.click();
		await settle();

		expect(
			[...document.querySelectorAll<HTMLInputElement>('input')].filter(
				(input) => input.maxLength === 512
			).length
		).toBe(2);
	});

	it('offers the graph’s own settings behind one door, and puts a refused choice back', async () => {
		let refuse = true;
		if (mounted) unmount(mounted, { outro: false });
		document.body.innerHTML = '';
		target = document.createElement('div');
		document.body.appendChild(target);
		mounted = mount(GraphsSheet, {
			target,
			props: {
				open: true,
				graphs: [
					{ ref: HOME, title: 'My graph' },
					{ ref: GARDEN, title: 'Garden' }
				],
				current: HOME,
				home: HOME,
				alsoUp: new Set<OwnedRef>(),
				onEnter: () => {},
				onToggle: () => {},
				onOpen: () => Promise.resolve(),
				onRename: () => Promise.resolve(),
				onOwnership: () =>
					refuse ? Promise.reject(new Refusal('That did not save.')) : Promise.resolve()
			}
		});
		await settle();

		find('Settings for Garden')?.click();
		await settle();

		const owned = document.querySelector<HTMLButtonElement>('[role="switch"]');
		if (!owned) throw new Error('The graph offers no choice about what a new note carries');
		expect(owned.getAttribute('aria-checked')).toBe('false');

		owned.click();
		await settle();

		expect(owned.getAttribute('aria-checked')).toBe('false');
		expect(document.body.textContent).toContain('That did not save.');

		refuse = false;
		owned.click();
		await settle();

		expect(owned.getAttribute('aria-checked')).toBe('true');
	});

	it('closes it once the question is answered', async () => {
		await open();

		find('Close Garden')?.click();
		await settle();
		confirm('Close it')?.click();
		await settle();

		expect(closed).toEqual([GARDEN]);
	});

	it('says why one did not close, in the words it was refused in', async () => {
		await open(() => Promise.reject(new Refusal('That graph is not here.')));

		find('Close Garden')?.click();
		await settle();
		confirm('Close it')?.click();
		await settle();

		const said = [...document.querySelectorAll('[role="alert"]')].map((one) => one.textContent);
		expect(said).toEqual(['That graph is not here.']);

		confirm('Cancel')?.click();
		await settle();
		expect(document.querySelector('[role="alert"]')).toBeNull();
	});

	// A bug on the way to the store says nothing anybody could act on, so the
	// sheet says what it always says instead of what broke.
});

describe('the graphs sheet where a graph is a folder on this device', () => {
	const GARDEN_FOLDER = '/Users/me/garden';
	const THESIS_FOLDER = '/Users/me/thesis';
	const GONE_FOLDER = '/Users/me/gone';

	let opened: string[];
	let forgotten: string[];
	let brought: string[];
	let started: number;
	let projects: number;

	async function openFolders(
		over: {
			onClone?: boolean;
			open?: string;
			refuse?: string;
			project?: string;
			opensProjects?: boolean;
		} = {}
	): Promise<void> {
		if (mounted) unmount(mounted, { outro: false });
		document.body.innerHTML = '';
		target = document.createElement('div');
		document.body.appendChild(target);
		opened = [];
		forgotten = [];
		brought = [];
		started = 0;
		projects = 0;
		mounted = mount(GraphsSheet, {
			target,
			props: {
				open: true,
				graphs: [
					{
						ref: HOME,
						title: 'My graph',
						folder: GARDEN_FOLDER,
						...(over.project === undefined ? {} : { project: over.project })
					},
					{ ref: GARDEN, title: 'The thesis', folder: THESIS_FOLDER, by: 'Ada Lovelace' },
					{ title: 'gone', folder: GONE_FOLDER }
				],
				current: HOME,
				home: HOME,
				openFolder: over.open ?? GARDEN_FOLDER,
				alsoUp: new Set<OwnedRef>(),
				onEnter: () => {},
				onToggle: () => {},
				onOpen: () => Promise.resolve(),
				onRename: () => Promise.resolve(),
				onRemove: (ref: OwnedRef) => {
					closed.push(ref);
					return over.refuse === undefined
						? Promise.resolve()
						: Promise.reject(new Refusal(over.refuse));
				},
				onOpenFolder: (folder: string) => {
					opened.push(folder);
					return Promise.resolve();
				},
				onForget: (folder: string) => {
					forgotten.push(folder);
					return Promise.resolve();
				},
				onStart: () => {
					started += 1;
					return Promise.resolve();
				},
				...(over.opensProjects === false
					? {}
					: {
							onOpenProject: () => {
								projects += 1;
								return Promise.resolve();
							}
						}),
				...(over.onClone === false
					? {}
					: {
							onClone: (url: string) => {
								brought.push(url);
								return Promise.resolve();
							}
						})
			}
		});
		await settle();
	}

	beforeEach(() => {
		closed = [];
	});

	it('lists every folder as a graph, with whose it is and which one has moved', async () => {
		await openFolders();

		const text = document.body.textContent ?? '';
		expect(text).toContain('My graph');
		expect(text).toContain('The thesis');
		expect(text).toContain('Ada Lovelace');
		expect(text).toContain('gone');
		expect(text).toContain('not where it was');
	});

	it('opens the folder a graph is in rather than moving into the graph', async () => {
		await openFolders();

		[...document.querySelectorAll<HTMLButtonElement>('button')]
			.find((one) => one.textContent?.includes('The thesis'))
			?.click();
		await settle();

		expect(opened).toEqual([THESIS_FOLDER]);
	});

	it('forgets a folder that is not the one open, and never that one', async () => {
		await openFolders();

		expect(find('Forget My graph')).toBeNull();
		find('Forget gone')?.click();
		await settle();

		expect(forgotten).toEqual([GONE_FOLDER]);
	});

	it('offers no way to forget the folder whose name is being typed', async () => {
		await openFolders();

		find('Rename The thesis')?.click();
		await settle();

		expect(find('Forget The thesis')).toBeNull();
		expect(find('Forget gone')).not.toBeNull();
	});

	// Emptying a folder is an act in the folder that is open, so that is the one
	// row it is offered on.
	it('offers to close the folder that is open, and no other', async () => {
		await openFolders();

		expect(find('Close My graph')).not.toBeNull();
		expect(find('Close The thesis')).toBeNull();
		expect(find('Close gone')).toBeNull();
	});

	// Ending a graph is its owner's, and the folder is what says whose it is.
	it('says whose a folder is where somebody else asks to close it', async () => {
		await openFolders({
			open: THESIS_FOLDER,
			refuse: "This graph is Ada Lovelace's. Only they can close it."
		});

		find('Close The thesis')?.click();
		await settle();
		confirm('Close it')?.click();
		await settle();

		expect(document.body.textContent).toContain("This graph is Ada Lovelace's.");
	});

	it('starts a graph by asking for a folder, not by asking for a name', async () => {
		await openFolders();

		expect(document.body.textContent).not.toContain('A new graph');
		confirm('Choose a folder')?.click();
		await settle();

		expect(started).toBe(1);
	});

	it("opens a project by asking for the project's own folder", async () => {
		await openFolders();

		confirm('Choose a project')?.click();
		await settle();

		expect(projects).toBe(1);
		expect(started).toBe(0);
	});

	it('offers no project where this device cannot reach one', async () => {
		await openFolders({ opensProjects: false });

		expect(confirm('Choose a project')).toBeNull();
		expect(document.body.textContent).not.toContain('Open a project');
	});

	it('names the project a row holds the notes of, beside the graph', async () => {
		await openFolders({ project: 'sloppy' });

		const row = [...document.querySelectorAll<HTMLElement>('button')].find((one) =>
			one.textContent?.includes('My graph')
		);
		expect(row?.textContent).toContain('sloppy');
	});

	// A project's notes are named after its folder, so a row that said only the
	// folder would be the commonest row saying nothing.
	it('still says a row is a project where the graph carries the same name', async () => {
		await openFolders({ project: 'My graph' });

		const row = [...document.querySelectorAll<HTMLElement>('button')].find((one) =>
			one.textContent?.includes('My graph')
		);
		expect(row?.textContent).toContain('Project');
		expect(row?.textContent).not.toContain('Project ·');
	});

	it("names no project on a row that is nobody's", async () => {
		await openFolders();

		const row = [...document.querySelectorAll<HTMLElement>('button')].find((one) =>
			one.textContent?.includes('My graph')
		);
		expect(row?.textContent?.trim()).toBe('My graph');
	});

	it('brings one from an address somebody types', async () => {
		await openFolders();

		const address = [...document.querySelectorAll<HTMLInputElement>('input')].find(
			(input) => input.placeholder === 'https://…'
		);
		if (!address) throw new Error('There is nowhere to type an address');
		address.value = 'https://somewhere.test/ada/garden.git';
		address.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		confirm('Bring it here')?.click();
		await settle();

		expect(brought).toEqual(['https://somewhere.test/ada/garden.git']);
	});

	it('says nothing about an address on a device that cannot reach one', async () => {
		await openFolders({ onClone: false });

		expect(document.body.textContent).not.toContain('Bring one from an address');
	});

	it('is in the folder that is open rather than the first row holding its graph', async () => {
		await openFolders({ open: THESIS_FOLDER });

		const rows = [...document.querySelectorAll('li button[aria-current="true"]')];
		expect(rows).toHaveLength(1);
		expect(rows[0].textContent).toContain('The thesis');
		expect(find('Forget My graph')).not.toBeNull();
		expect(find('Forget The thesis')).toBeNull();
	});

	it('offers one removal on a row that is not open, and it leaves the folder alone', async () => {
		await openFolders();

		expect(find('Close The thesis')).toBeNull();
		expect(find('Close gone')).toBeNull();
		expect(find('Forget The thesis')).not.toBeNull();
		expect(document.body.textContent).toContain(
			'Forgetting a folder takes it off this list and leaves everything in it where it is.'
		);
	});
});

describe('two folders holding one graph', () => {
	const ONE = '/Users/me/garden';
	const COPY = '/Users/me/garden-copy';

	let opened: string[];
	let forgotten: string[];

	async function openBoth(): Promise<void> {
		if (mounted) unmount(mounted, { outro: false });
		document.body.innerHTML = '';
		target = document.createElement('div');
		document.body.appendChild(target);
		opened = [];
		forgotten = [];
		mounted = mount(GraphsSheet, {
			target,
			props: {
				open: true,
				graphs: [
					{ ref: HOME, title: 'Garden', folder: ONE, folderName: 'garden' },
					{ ref: HOME, title: 'Garden', folder: COPY, folderName: 'garden-copy' }
				],
				current: HOME,
				home: HOME,
				openFolder: COPY,
				alsoUp: new Set<OwnedRef>(),
				onEnter: () => {},
				onToggle: () => {},
				onOpen: () => Promise.resolve(),
				onRename: () => Promise.resolve(),
				onOpenFolder: (folder: string) => {
					opened.push(folder);
					return Promise.resolve();
				},
				onForget: (folder: string) => {
					forgotten.push(folder);
					return Promise.resolve();
				},
				onRemove: (ref: OwnedRef) => {
					closed.push(ref);
					return Promise.resolve();
				}
			}
		});
		await settle();
	}

	beforeEach(() => {
		closed = [];
	});

	it('tells the two rows apart by the folder each one is', async () => {
		await openBoth();

		const rows = [...document.querySelectorAll('li')].map((one) => one.textContent ?? '');
		expect(rows[0]).toContain('garden');
		expect(rows[1]).toContain('garden-copy');
	});

	it('is in the one folder that is open', async () => {
		await openBoth();

		const here = [...document.querySelectorAll('li button[aria-current="true"]')];
		expect(here).toHaveLength(1);
		expect(here[0].textContent).toContain('garden-copy');
	});

	it('forgets the folder that is not open, and opens it by its own row', async () => {
		await openBoth();

		expect(find('Forget Garden in garden')).not.toBeNull();
		expect(find('Forget Garden in garden-copy')).toBeNull();
		find('Forget Garden in garden')?.click();
		await settle();
		expect(forgotten).toEqual([ONE]);

		[...document.querySelectorAll<HTMLButtonElement>('li button')]
			.find((one) => one.textContent?.includes('garden') && !one.textContent?.includes('copy'))
			?.click();
		await settle();
		expect(opened).toEqual([ONE]);
	});

	// Naming a graph and emptying it are acts in the folder that is open, so
	// they are that row's; nothing is offered on a row that cannot say which of
	// the two it would reach.
	it('keeps the acts on the row of the folder that is open', async () => {
		await openBoth();

		const rows = [...document.querySelectorAll('li')];
		expect(rows[1].querySelector('[aria-label="Rename Garden"]')).not.toBeNull();
		expect(rows[1].querySelector('[aria-label="Close Garden"]')).not.toBeNull();
		expect(rows[0].querySelector('[aria-label="Rename Garden"]')).toBeNull();
		expect(rows[0].querySelector('[aria-label="Close Garden"]')).toBeNull();
	});

	it('puts neither of them up beside the other, which one canvas cannot tell apart', async () => {
		await openBoth();

		expect(find('Show Garden beside this one')).toBeNull();
	});

	it('closes the folder that is open', async () => {
		await openBoth();

		find('Close Garden')?.click();
		await settle();
		confirm('Close it')?.click();
		await settle();

		expect(closed).toEqual([HOME]);
	});
});
