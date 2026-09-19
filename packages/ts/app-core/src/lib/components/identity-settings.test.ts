import { SloppyApiError } from '@sloppy/client';
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

/** The sheet asking for a passphrase stands outside this surface's own box. */
function asked(): HTMLInputElement | null {
	return document.querySelector<HTMLInputElement>('#identity-passphrase');
}

function type(said: string): void {
	const field = asked();
	if (!field) throw new Error('nowhere to type a passphrase');
	field.value = said;
	field.dispatchEvent(new Event('input', { bubbles: true }));
}

function answer(): void {
	asked()?.closest('form')?.requestSubmit();
}

beforeEach(() => {
	saved = [];
	brought = null;
	Element.prototype.hasPointerCapture = () => false;
	Element.prototype.setPointerCapture = () => {};
	Element.prototype.releasePointerCapture = () => {};
	Element.prototype.scrollIntoView = () => {};
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			matches: query.includes('min-width'),
			addEventListener: () => {},
			removeEventListener: () => {}
		})
	});
	Object.defineProperty(globalThis, 'ResizeObserver', {
		configurable: true,
		writable: true,
		value: class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	});
	target = document.createElement('div');
	document.body.append(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
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

	it('offers every way one arrives', () => {
		shell({});
		show();

		expect(offers()).toEqual([
			'Start a new one here',
			'Sign in with your identity',
			'Bring one from another device',
			'Bring one you keep under a passphrase'
		]);
	});

	it('leaves the making of one to the surface that already offers it', () => {
		shell({});
		show({ mints: false });

		expect(offers()).toEqual([
			'Sign in with your identity',
			'Bring one from another device',
			'Bring one you keep under a passphrase'
		]);
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

	it('says an identity held in Syner comes in this way', async () => {
		shell({});
		show();
		await settle();

		press('Sign in with your identity');
		await settle();

		expect(target.textContent).toContain('Syner');
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
	it('holds one kept under a passphrase with nothing asked of anybody', async () => {
		const bringSealed = vi.fn(async () => here({ source: 'sealed', locked: true }));
		brought = new File([new Uint8Array([1, 2, 3])], 'identity.sigil');
		shell({ bringSealed });
		show();
		await settle();

		press('Bring one you keep under a passphrase');
		await settle();

		expect(bringSealed).toHaveBeenCalledOnce();
		expect(asked()).toBeNull();
	});

	it('says a locked one is written as now and asked about later', async () => {
		shell({ list: async () => [here({ source: 'sealed', locked: true, name: 'Ada' })] });
		show();
		await settle();

		expect(target.textContent).toContain('On this device, locked');
		expect(target.textContent).toContain('You can write as this one now');
		expect(offers()).toContain('Save a copy to move it');
	});

	it('asks for the passphrase at the moment the copy is made, and not before', async () => {
		const carryOut = vi.fn(async () => ({ name: CARRIED_FILE, body: new Uint8Array([1, 2, 3]) }));
		shell({ list: async () => [here({ source: 'sealed', locked: true })], carryOut });
		show();
		await settle();

		expect(asked()).toBeNull();

		press('Save a copy to move it');
		await settle();
		type('the whole hill');
		await settle();
		answer();
		await settle();

		expect(carryOut).toHaveBeenCalledWith('did:syr:z6Mkone', 'the whole hill');
		expect(saved.map((one) => one.name)).toEqual(['sloppy-identity.json']);
		expect(asked()).toBeNull();
	});

	it('says what to try where the passphrase does not open it', async () => {
		const carryOut = vi.fn(async () => {
			throw new SloppyApiError(400, 'POST /identities 400', {
				detail: 'That passphrase did not open it. Try it again.'
			});
		});
		shell({ list: async () => [here({ source: 'sealed', locked: true })], carryOut });
		show();
		await settle();

		press('Save a copy to move it');
		await settle();
		type('the wrong hill');
		await settle();
		answer();
		await settle();

		expect(saved).toEqual([]);
		expect(asked()).not.toBeNull();
		expect(asked()?.value).toBe('');
		expect(document.querySelector('[role="alert"]')?.textContent).toContain('Try it again');
	});

	it('asks for a passphrase rather than trying without one', async () => {
		const carryOut = vi.fn(async () => ({ name: CARRIED_FILE, body: new Uint8Array([1, 2, 3]) }));
		shell({ list: async () => [here({ source: 'sealed', locked: true })], carryOut });
		show();
		await settle();

		press('Save a copy to move it');
		await settle();
		answer();
		await settle();

		expect(carryOut).not.toHaveBeenCalled();
		expect(document.querySelector('[role="alert"]')?.textContent).toContain('Type the passphrase');
	});

	it('says what is already written keeps the name it was written under', async () => {
		shell({ list: async () => [here()] });
		show();
		await settle();

		expect(target.textContent?.replace(/\s+/g, ' ')).toContain(
			'what you have already written keeps the name it was written under'
		);
	});
});
