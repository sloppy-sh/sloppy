import { CARRIED_FILE, type IdentityAccess, type IdentityHere } from '@sloppy/local';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initRuntime } from '../runtime.js';
import IdentitySettings from './identity-settings.svelte';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let saved: { name: string; body: Blob }[];
let brought: File | null;

async function settle(): Promise<void> {
	for (let turn = 0; turn < 6; turn += 1) await new Promise((done) => setTimeout(done, 0));
	flushSync();
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
		carryOut: async () => ({ name: CARRIED_FILE, body: new Uint8Array([1, 2, 3]) }),
		writeAs: async () => {},
		...said
	};
}

function shell(identities?: Partial<IdentityAccess>): void {
	initRuntime({
		apiHost: () => '',
		mode: () => 'local',
		saveFile: async (name, body) => {
			saved.push({ name, body });
		},
		openFile: async () => brought,
		...(identities ? { identities: doors(identities) } : { identities: undefined })
	});
}

function show(props: { mints?: boolean } = {}): void {
	mounted = mount(IdentitySettings, { target, props });
	flushSync();
}

function offers(): string[] {
	return [...target.querySelectorAll('button')].map((one) => one.textContent?.trim() ?? '');
}

function press(label: string): void {
	const one = [...target.querySelectorAll('button')].find(
		(button) => button.textContent?.trim() === label
	);
	if (!one) throw new Error(`No "${label}" on the page`);
	one.click();
}

beforeEach(() => {
	saved = [];
	brought = null;
	target = document.createElement('div');
	document.body.append(target);
});

afterEach(() => {
	if (mounted) unmount(mounted);
	mounted = undefined;
	target.remove();
	initRuntime({
		apiHost: () => '',
		mode: () => 'hosted',
		identities: undefined,
		saveFile: undefined,
		openFile: undefined
	});
});

describe('the identities a device holds', () => {
	it('is nothing at all where the shell keeps none', () => {
		shell();
		show();

		expect(target.querySelector('[data-surface="identities"]')).toBeNull();
	});

	it('offers all three ways one arrives', () => {
		shell({});
		show();

		expect(offers()).toEqual([
			'Start a new one here',
			'Sign in with your identity',
			'Bring one from another device'
		]);
	});

	it('leaves the making of one to the surface that already offers it', () => {
		shell({});
		show({ mints: false });

		expect(offers()).not.toContain('Start a new one here');
	});

	it('says which one the writing here carries', async () => {
		shell({
			list: async () => [
				here({ did: 'did:syr:z6Mkone', name: 'Ada', instance: 'keys.example', writing: true }),
				here({ did: 'did:syr:z6Mktwo', writing: false })
			]
		});
		show();
		await settle();

		expect(target.textContent).toContain('Ada');
		expect(target.textContent).toContain('keys.example');
		expect(target.textContent).toContain('Writing here');
		expect(offers()).toContain('Write as this one');
	});

	// Two made here read the same otherwise, and one of them is about to be
	// handed to another device.
	it('tells two identities made here apart', async () => {
		shell({
			list: async () => [
				here({ did: 'did:syr:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK' }),
				here({ did: 'did:syr:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG', writing: false })
			]
		});
		show();
		await settle();

		expect(target.textContent).toContain('z6MkhaXg…2doK');
		expect(target.textContent).toContain('z6Mkjchh…jVJG');
		expect(target.textContent).toContain('Made on this device');
	});

	it('writes as the one somebody picks from then on', async () => {
		const writeAs = vi.fn(async () => {});
		shell({
			list: async () => [here({ did: 'did:syr:z6Mktwo', writing: false })],
			writeAs
		});
		show();
		await settle();

		press('Write as this one');
		await settle();

		expect(writeAs).toHaveBeenCalledWith('did:syr:z6Mktwo');
	});

	it('takes somebody to where their identity lives', async () => {
		const signIn = vi.fn(async () => {});
		shell({ signIn });
		show();
		await settle();

		press('Sign in with your identity');
		await settle();
		const field = target.querySelector<HTMLInputElement>('#identity-home');
		if (!field) throw new Error('nowhere to type an address');
		field.value = ' keys.example ';
		field.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		target.querySelector('form')?.requestSubmit();
		await settle();

		expect(signIn).toHaveBeenCalledWith('keys.example');
	});

	it('asks for an address rather than leaving for nowhere', async () => {
		const signIn = vi.fn(async () => {});
		shell({ signIn });
		show();
		await settle();

		press('Sign in with your identity');
		await settle();
		target.querySelector('form')?.requestSubmit();
		await settle();

		expect(signIn).not.toHaveBeenCalled();
		expect(target.querySelector('[role="alert"]')?.textContent).toContain('web address');
	});

	it('says what the store said when it could not be reached', async () => {
		shell({
			signIn: async () => {
				throw new Error('boom');
			}
		});
		show();
		await settle();

		press('Sign in with your identity');
		await settle();
		const field = target.querySelector<HTMLInputElement>('#identity-home');
		if (field) {
			field.value = 'keys.example';
			field.dispatchEvent(new Event('input', { bubbles: true }));
		}
		await settle();
		target.querySelector('form')?.requestSubmit();
		await settle();

		expect(target.querySelector('[role="alert"]')).not.toBeNull();
	});

	it('hands over a copy of an identity made here, named so a person knows what it is', async () => {
		shell({ list: async () => [here()] });
		show();
		await settle();

		expect(target.textContent).toContain('writes as you');
		press('Save a copy to move it');
		await settle();

		expect(saved.map((one) => one.name)).toEqual(['sloppy-identity.json']);
	});

	it('has no copy to offer of one a store keeps', async () => {
		shell({ list: async () => [here({ source: 'delegated', carriable: false })] });
		show();
		await settle();

		expect(offers()).not.toContain('Save a copy to move it');
		expect(target.textContent).not.toContain('writes as you');
	});

	it('reads an identity out of a file another device wrote', async () => {
		const bring = vi.fn(async () => here());
		brought = new File([new Uint8Array([1, 2, 3])], 'sloppy-identity.json');
		shell({ bring });
		show();
		await settle();

		press('Bring one from another device');
		await settle();

		expect(bring).toHaveBeenCalledOnce();
	});

	it('says an identity signed out of its store is still held', async () => {
		shell({
			list: async () => [here({ source: 'delegated', carriable: false, lapsed: true, name: 'Ada' })]
		});
		show();
		await settle();

		expect(target.textContent).toContain('Sign in again');
		expect(target.textContent).toContain('still yours');
	});
});
