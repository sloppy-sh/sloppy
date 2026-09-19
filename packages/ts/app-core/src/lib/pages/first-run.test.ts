import type { IdentityAccess, IdentityHere } from '@sloppy/local';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initRuntime, type KnownFolder, type VaultAccess } from '../runtime.js';
import { session } from '../stores/session.svelte.js';
import FirstRun from './first-run.svelte';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let opened: string[];

async function settle(): Promise<void> {
	for (let turn = 0; turn < 6; turn += 1) await new Promise((done) => setTimeout(done, 0));
	flushSync();
}

function show(missing = false): void {
	mounted = mount(FirstRun, {
		target,
		props: { missing, onopened: (folder) => opened.push(folder) }
	});
	flushSync();
}

function button(): HTMLButtonElement {
	const one = target.querySelector('button');
	if (!one) throw new Error('No offer on the page');
	return one;
}

/** The one line at the foot that opens who this device writes as. */
function whoDoor(): HTMLButtonElement {
	const one = target.querySelector<HTMLButtonElement>('button[aria-controls="who-writes-here"]');
	if (!one) throw new Error('Nothing at the foot says who writes here');
	return one;
}

/** A shell that keeps graphs in folders, answering `open` with `folder`. */
function shell(vault: Partial<VaultAccess>, identities?: Partial<IdentityAccess>): void {
	initRuntime({
		apiHost: () => '',
		mode: () => 'local',
		vault: {
			folder: () => undefined,
			graph: async () => undefined,
			asks: true,
			open: async () => undefined,
			...vault
		},
		...(identities ? { identities: doors(identities) } : {})
	});
}

function here(said: Partial<IdentityHere> = {}): IdentityHere {
	return {
		did: 'did:syr:z6Mkone',
		source: 'device',
		locked: false,
		lapsed: false,
		writing: true,
		carriable: true,
		...said
	};
}

function doors(said: Partial<IdentityAccess>): IdentityAccess {
	return {
		list: async () => [],
		makeOne: async () => here(),
		signIn: async () => {},
		finish: async () => undefined,
		bring: async () => here(),
		bringSealed: async () => here(),
		carryOut: async () => ({ name: 'sloppy-identity.json', body: new Uint8Array() }),
		writeAs: async () => {},
		...said
	};
}

beforeEach(() => {
	opened = [];
	target = document.createElement('div');
	document.body.append(target);
});

afterEach(() => {
	if (mounted) unmount(mounted);
	mounted = undefined;
	target.remove();
	initRuntime({ apiHost: () => '', mode: () => 'hosted', vault: undefined, identities: undefined });
});

describe('the first run of a graph on this device', () => {
	it('puts nothing in the way but the offer of a folder', () => {
		shell({});
		show();

		expect(button().textContent?.trim()).toBe('Choose a folder');
		// Nothing to fill in and nowhere else to go: one offer, and it is this.
		expect(target.querySelectorAll('button')).toHaveLength(1);
		expect(target.querySelector('input')).toBeNull();
	});

	it('says where the graph will be on a device that keeps them in one place', () => {
		shell({ asks: false });
		show();

		expect(button().textContent?.trim()).toBe('Start writing');
		// The folder is this app's own there: nobody can move it or back it up
		// beside their other folders, so nothing says they can.
		expect(target.textContent).not.toContain('move it');
		expect(target.textContent).toContain('What you write stays on this device');
	});

	it('says the folder is theirs where they chose it', () => {
		shell({ asks: true });
		show();

		expect(target.textContent).toContain('move it or back it up');
	});

	it('says the folder is not where it was rather than offering a first one', () => {
		shell({});
		show(true);

		expect(target.textContent).toContain('is not where it was');
		expect(target.textContent).not.toContain('Pick an empty one');
		expect(button().textContent?.trim()).toBe('Choose a folder');
	});

	it('hands the folder somebody names to the shell', async () => {
		const open = vi.fn(async () => '/Users/me/garden');
		shell({ open });
		show();

		button().click();
		await settle();

		expect(open).toHaveBeenCalledOnce();
		expect(opened).toEqual(['/Users/me/garden']);
	});

	it('stays where it is for somebody who names none', async () => {
		shell({ open: async () => undefined });
		show();

		button().click();
		await settle();

		expect(opened).toEqual([]);
		expect(button().disabled).toBe(false);
	});

	it('says what the shell said, which is the half that knows what went wrong', async () => {
		shell({
			open: async () => {
				throw 'Sloppy cannot write in that folder.';
			}
		});
		show();

		button().click();
		await settle();

		expect(target.querySelector('[role="alert"]')?.textContent).toContain(
			'Sloppy cannot write in that folder.'
		);
	});

	// There was no choice to make, so there is no other one to try.
	it('offers no other folder on a device that keeps its graphs in one place', async () => {
		shell({
			asks: false,
			open: async () => {
				throw new Error('EACCES');
			}
		});
		show();

		button().click();
		await settle();

		const said = target.querySelector('[role="alert"]');
		expect(said?.textContent).not.toContain('Try another one');
		expect(said?.textContent).toContain('this device');
	});

	it('says what to do next when a folder cannot be written in', async () => {
		shell({
			open: async () => {
				throw new Error('EACCES');
			}
		});
		show();

		button().click();
		await settle();

		const said = target.querySelector('[role="alert"]');
		expect(said?.textContent).toContain('Try another one');
		expect(said?.textContent).not.toContain('EACCES');
		expect(opened).toEqual([]);
	});
});

describe('opening a project on the first run', () => {
	function offer(words: string): HTMLButtonElement | null {
		return (
			[...target.querySelectorAll('button')].find((one) => one.textContent?.trim() === words) ??
			null
		);
	}

	it('is not offered where this device cannot reach a project', () => {
		shell({});
		show();

		expect(offer('Open a project')).toBeNull();
	});

	it('hands the project somebody names to the shell, and not the other folder', async () => {
		const open = vi.fn(async () => '/Users/me/garden');
		const openProject = vi.fn(async () => '/Users/me/sloppy');
		shell({ open, openProject });
		show();

		offer('Open a project')?.click();
		await settle();

		expect(openProject).toHaveBeenCalledOnce();
		expect(open).not.toHaveBeenCalled();
		expect(opened).toEqual(['/Users/me/sloppy']);
	});

	it('makes an identity here first, exactly as choosing a folder does', async () => {
		const makeOne = vi.fn(async () => here());
		shell({ openProject: async () => '/Users/me/sloppy' }, { makeOne });
		show();

		offer('Open a project')?.click();
		await settle();

		expect(makeOne).toHaveBeenCalledOnce();
	});

	it('stays where it is for somebody who names none', async () => {
		shell({ openProject: async () => undefined });
		show();

		offer('Open a project')?.click();
		await settle();

		expect(opened).toEqual([]);
		expect(offer('Open a project')?.disabled).toBe(false);
	});

	it('is the offer that says it is working, and the other one only waits', async () => {
		let named: ((root: string) => void) | undefined;
		shell({ openProject: () => new Promise<string>((settled) => (named = settled)) });
		show();

		offer('Open a project')?.click();
		await settle();

		expect(offer('Open a project')).toBeNull();
		expect(offer('One moment…')?.getAttribute('aria-busy')).toBe('true');
		expect(offer('Choose a folder')?.disabled).toBe(true);
		named?.('/Users/me/engine');
		await settle();
	});

	it('says what to do next when the project cannot be written in', async () => {
		shell({
			openProject: async () => {
				throw new Error('EACCES');
			}
		});
		show();

		offer('Open a project')?.click();
		await settle();

		const said = target.querySelector('[role="alert"]');
		expect(said?.textContent).toContain('Try another one');
		expect(said?.textContent).not.toContain('EACCES');
	});
});

describe('the three doors a first run offers', () => {
	function offers(): string[] {
		return [...target.querySelectorAll('button')].map((one) => one.textContent?.trim() ?? '');
	}

	it('keeps them behind one line until somebody goes looking', async () => {
		shell({}, {});
		show();
		await settle();

		expect(offers()).toEqual(['Choose a folder', 'Who you write as']);
		expect(target.querySelector('[data-surface="identities"]')).toBeNull();
		expect(whoDoor().getAttribute('aria-expanded')).toBe('false');
	});

	it('opens the ways in for somebody who asks', async () => {
		shell({}, {});
		show();
		await settle();

		whoDoor().click();
		await settle();

		expect(whoDoor().getAttribute('aria-expanded')).toBe('true');
		expect(target.querySelector('[data-surface="identities"]')).not.toBeNull();
		expect(offers()).toContain('Sign in with your identity');
		expect(offers()).toContain('Bring one from another device');
		expect(offers()).toContain('Bring one you keep under a passphrase');
	});

	it('makes an identity here before the folder, asking nothing', async () => {
		const makeOne = vi.fn(async () => here());
		shell({ open: async () => '/Users/me/garden' }, { makeOne });
		show();

		button().click();
		await settle();

		expect(makeOne).toHaveBeenCalledOnce();
		expect(opened).toEqual(['/Users/me/garden']);
	});

	// Tapped before the list has answered, which is the window a fast first tap
	// falls in on a device that already holds an identity.
	it('does not make a second one for a device that already holds one', async () => {
		const makeOne = vi.fn(async () => here());
		shell({ open: async () => '/Users/me/garden' }, { makeOne, list: async () => [here()] });
		show();

		button().click();
		await settle();

		expect(makeOne).not.toHaveBeenCalled();
		expect(opened).toEqual(['/Users/me/garden']);
	});

	it('makes none where the device would not say what it holds', async () => {
		const makeOne = vi.fn(async () => here());
		shell(
			{ open: async () => '/Users/me/garden' },
			{
				makeOne,
				list: async () => {
					throw new Error(
						"This device's identity could not be read, so nothing can be written under it."
					);
				}
			}
		);
		show();

		button().click();
		await settle();

		expect(makeOne).not.toHaveBeenCalled();
		expect(opened).toEqual([]);
		expect(target.querySelector('[role="alert"]')?.textContent).toContain('could not be read');
	});

	it('says who the writing will be, once somebody has signed in', async () => {
		shell({}, { list: async () => [here({ name: 'Ada Lovelace', source: 'delegated' })] });
		show();
		await settle();

		expect(target.textContent).toContain('writing as Ada Lovelace');
	});

	it('names an identity brought in under a passphrase rather than the one made here', async () => {
		shell(
			{},
			{ list: async () => [here({ source: 'sealed', locked: true, did: 'did:syr:z6Mkbrought' })] }
		);
		show();
		await settle();

		expect(target.textContent).not.toContain('writing as the identity on this device');
		expect(whoDoor().textContent).toContain('writing as');
	});

	it('says an identity held in Syner is one of the ones you can use', async () => {
		shell({}, {});
		show();
		await settle();

		whoDoor().click();
		await settle();
		const door = [...target.querySelectorAll('button')].find(
			(one) => one.textContent?.trim() === 'Sign in with your identity'
		);
		door?.click();
		await settle();

		expect(target.textContent).toContain('Syner');
	});

	it('takes somebody to where their identity lives', async () => {
		const signIn = vi.fn(async () => {});
		shell({}, { signIn });
		show();
		await settle();

		whoDoor().click();
		await settle();
		const door = [...target.querySelectorAll('button')].find(
			(one) => one.textContent?.trim() === 'Sign in with your identity'
		);
		door?.click();
		await settle();

		const field = target.querySelector<HTMLInputElement>('#identity-home');
		if (!field) throw new Error('nowhere to type an address');
		field.value = 'keys.example';
		field.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		target.querySelector('form')?.requestSubmit();
		await settle();

		expect(signIn).toHaveBeenCalledWith('keys.example');
	});

	it('offers none of it where the shell holds no identities', () => {
		shell({});
		show();

		expect(offers()).toEqual(['Choose a folder']);
	});
});

describe('a first run that did not get a folder', () => {
	it('makes one identity here, however many times the folder is turned down', async () => {
		let listed: IdentityHere[] = [];
		const makeOne = vi.fn(async () => {
			listed = [here()];
			return here();
		});
		shell({ open: async () => undefined }, { makeOne, list: async () => listed });
		show();
		await settle();

		button().click();
		await settle();
		button().click();
		await settle();

		expect(makeOne).toHaveBeenCalledOnce();
		expect(opened).toEqual([]);
	});
});

describe('a sign-in that lands while the first run is on screen', () => {
	afterEach(() => session.clear());

	it('says who the writing will be, without anybody reopening the app', async () => {
		let listed: IdentityHere[] = [];
		shell({}, { list: async () => listed });
		show();
		await settle();
		expect(target.textContent).toContain('Who you write as');

		listed = [here({ name: 'Ada Lovelace', source: 'delegated', instance: 'keys.example' })];
		session.adopt(
			{
				did: 'did:syr:z6Mkone',
				syr_instance_url: 'https://keys.example',
				delegate_public_key: 'zDelegate'
			},
			'a-token'
		);
		await settle();

		expect(target.textContent).toContain('writing as Ada Lovelace');
	});

	it('stops saying the device would not answer once it has', async () => {
		let answering = false;
		shell(
			{},
			{
				list: async () => {
					if (!answering) throw new Error('This device’s identities could not be read.');
					return [here({ name: 'Ada Lovelace', source: 'delegated' })];
				}
			}
		);
		show();
		await settle();
		expect(target.querySelector('[role="alert"]')?.textContent).toContain('could not be read');

		answering = true;
		session.adopt(
			{
				did: 'did:syr:z6Mkone',
				syr_instance_url: 'https://keys.example',
				delegate_public_key: 'zDelegate'
			},
			'a-token'
		);
		await settle();

		expect(target.querySelector('[role="alert"]')).toBeNull();
		expect(target.textContent).toContain('writing as Ada Lovelace');
	});
});

describe('the folders this device already knows', () => {
	const OWNER = 'did:syr:z6Mkone';
	const GARDEN = '/Users/me/garden';
	const ENGINE = '/Users/me/engine';
	const GONE = '/Volumes/stick/thesis';

	function known(): KnownFolder[] {
		return [
			{
				root: GARDEN,
				graph: { ref: `${OWNER}/one`, name: 'Garden', owner: OWNER },
				reachable: true
			},
			{
				root: ENGINE,
				graph: { ref: `${OWNER}/two`, name: 'Engine', owner: OWNER, project: ENGINE },
				reachable: true
			},
			{ root: GONE, reachable: false }
		];
	}

	function rows(): HTMLElement[] {
		return [...target.querySelectorAll('li')];
	}

	/** What each row calls the graph in it, which is its first line. */
	function named(): (string | undefined)[] {
		return rows().map((one) => one.querySelector('span')?.textContent?.trim());
	}

	function row(words: string): HTMLElement {
		const one = rows().find((each) => each.textContent?.includes(words));
		if (!one) throw new Error(`No row for ${words}`);
		return one;
	}

	it('lists them in the order the device gave them, which is newest first', async () => {
		shell({ known: async () => known(), openKnown: async () => {} });
		show();
		await settle();

		expect(named()).toEqual(['Garden', 'Engine', 'thesis']);
	});

	it('says which folder each one is in, and which of them is a project', async () => {
		shell({ known: async () => known(), openKnown: async () => {} });
		show();
		await settle();

		expect(row('Garden').textContent).toContain(GARDEN);
		expect(row('Garden').textContent).not.toContain('Project');
		expect(row('Engine').textContent).toContain(`Project · ${ENGINE}`);
	});

	it('shows no list at all on a device that knows no folder', async () => {
		shell({ known: async () => [] });
		show();
		await settle();

		expect(rows()).toEqual([]);
		expect(target.textContent).toContain('Pick an empty one');
	});

	it('shows no list where the shell keeps none', async () => {
		shell({});
		show();
		await settle();

		expect(rows()).toEqual([]);
		expect(button().textContent?.trim()).toBe('Choose a folder');
	});

	it('opens the folder whose row was pressed', async () => {
		const openKnown = vi.fn(async () => {});
		shell({ known: async () => known(), openKnown });
		show();
		await settle();

		row('Garden').querySelector('button')?.click();
		await settle();

		expect(openKnown).toHaveBeenCalledWith(GARDEN);
		expect(opened).toEqual([GARDEN]);
	});

	it('makes an identity here first, exactly as choosing a folder does', async () => {
		const makeOne = vi.fn(async () => here());
		shell({ known: async () => known(), openKnown: async () => {} }, { makeOne });
		show();
		await settle();

		row('Garden').querySelector('button')?.click();
		await settle();

		expect(makeOne).toHaveBeenCalledOnce();
		expect(opened).toEqual([GARDEN]);
	});

	it('says what to do next when a folder on the list will not open', async () => {
		shell({
			known: async () => known(),
			openKnown: async () => {
				throw new Error('ENOENT');
			}
		});
		show();
		await settle();

		row('Garden').querySelector('button')?.click();
		await settle();

		const said = target.querySelector('[role="alert"]');
		expect(said?.textContent).toContain('Try another one');
		expect(said?.textContent).not.toContain('ENOENT');
		expect(opened).toEqual([]);
	});

	it('says a folder is not where it was rather than offering to open it', async () => {
		shell({ known: async () => known(), openKnown: async () => {}, forget: async () => {} });
		show();
		await settle();

		expect(row('thesis').textContent).toContain('not where it was');
		expect(row('thesis').textContent).toContain(GONE);
		expect(row('thesis').querySelector('button')?.textContent?.trim()).toBe('Forget');
	});

	it('takes a folder that is not where it was off the list', async () => {
		let listed = known();
		const forget = vi.fn(async (root: string) => {
			listed = listed.filter((one) => one.root !== root);
		});
		shell({ known: async () => listed, openKnown: async () => {}, forget });
		show();
		await settle();

		row('thesis').querySelector('button')?.click();
		await settle();

		expect(forget).toHaveBeenCalledWith(GONE);
		expect(named()).toEqual(['Garden', 'Engine']);
	});

	it('leaves it on the list where the shell cannot forget one', async () => {
		shell({ known: async () => known(), openKnown: async () => {} });
		show();
		await settle();

		expect(row('thesis').querySelector('button')).toBeNull();
	});

	it('offers another folder beside the ones already here', async () => {
		shell({ known: async () => known(), openKnown: async () => {} });
		show();
		await settle();

		expect(target.textContent).toContain('Open another folder');
		expect(target.textContent).not.toContain('Pick an empty one');
	});
});
