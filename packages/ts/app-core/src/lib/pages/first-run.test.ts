import type { IdentityAccess, IdentityHere } from '@sloppy/local';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initRuntime, type VaultAccess } from '../runtime.js';
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

describe('the three doors a first run offers', () => {
	function offers(): string[] {
		return [...target.querySelectorAll('button')].map((one) => one.textContent?.trim() ?? '');
	}

	it('offers the other two beside the one that asks nothing', () => {
		shell({}, {});
		show();

		expect(offers()).toEqual([
			'Choose a folder',
			'Sign in with your identity',
			'Bring one from another device'
		]);
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

	it('says who the writing will be, once somebody has signed in', async () => {
		shell({}, { list: async () => [here({ name: 'Ada Lovelace', source: 'delegated' })] });
		show();
		await settle();

		expect(target.textContent).toContain('writing as Ada Lovelace');
	});

	it('takes somebody to where their identity lives', async () => {
		const signIn = vi.fn(async () => {});
		shell({}, { signIn });
		show();
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
		expect(target.textContent).toContain('Starting here gives you');

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
});
