// The offering surface over the graph that actually serves it: a folder on the
// device, opened under a second identity this device holds, with the real
// writing rule deciding what a write does —
// docs/ARCHITECTURE.md § "Whose writing a note carries".

import { holdDeviceIdentity, LocalApi, makeLocalIdentity, MemoryFiles } from '@sloppy/local';
import type { AmendmentView } from '@sloppy/types';
import { authorsOf, type DidSyr, type OwnedRef } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetApi } from '../api.js';
import { initRuntime } from '../runtime.js';
import { graphs } from '../stores/graphs.svelte.js';
import { nodes } from '../stores/nodes.svelte.js';
import { offers } from '../stores/offers.svelte.js';
import { peers } from '../stores/peers.svelte.js';
import { people } from '../stores/people.svelte.js';
import { session } from '../stores/session.svelte.js';
import NoteOnSurface from './note-in-panel.test-support.svelte';

const FOLDER = '/graphs/thesis';

/** The folder as one identity reaches it. Every client here reads and writes
 *  the same files and holds nothing of another's index, so what one asserts is
 *  what the folder says rather than what a write told it. */
function client(store: Map<string, Uint8Array>, writer?: DidSyr): LocalApi {
	const files = new MemoryFiles({ store, folder: FOLDER });
	return new LocalApi(files, writer === undefined ? {} : { writer });
}

/** The same folder, slow to say what is offered on a note — the window a title
 *  typed the moment the note opens falls into. */
class SlowToSayWhatIsOffered extends LocalApi {
	async listAmendments(note: OwnedRef): Promise<AmendmentView[]> {
		for (let turn = 0; turn < 12; turn += 1) await new Promise((wake) => setTimeout(wake));
		return super.listAmendments(note);
	}
}

/** Serve the app off this client, as the shell of a device with a folder open
 *  does, with nothing of the last reader held. */
async function readingAs(api: LocalApi): Promise<void> {
	initRuntime({
		apiHost: () => '',
		mode: () => 'local',
		createApi: () => api,
		vault: {
			folder: () => FOLDER,
			graph: () => api.graphHere(),
			open: async () => FOLDER,
			asks: false
		}
	});
	resetApi();
	nodes.clear();
	offers.clear();
	graphs.clear();
	peers.clear();
	people.hold(null);
	session.clear();
	await session.refresh();
	await people.read().catch(() => undefined);
	await graphs.load().catch(() => undefined);
}

function stubViewport(width = 390): void {
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			matches: /min-width:\s*(\d+)px/.test(query)
				? width >= Number(/min-width:\s*(\d+)px/.exec(query)![1])
				: false,
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
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 60; turn += 1) {
		await new Promise((wake) => setTimeout(wake));
		flushSync();
	}
}

const screen = () => document.body.textContent ?? '';
const titleField = () => document.body.querySelector<HTMLTextAreaElement>('[aria-label="Title"]');

function button(reads: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find((one) =>
		one.textContent?.includes(reads)
	);
	if (!found) throw new Error(`No "${reads}" button on screen`);
	return found;
}

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function put(of: OwnedRef): void {
	mounted = mount(NoteOnSurface, { target, props: { opened: of, fresh: false } });
	flushSync();
}

async function open(of: OwnedRef): Promise<void> {
	put(of);
	await settle();
}

function close(): void {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	document.body.innerHTML = '';
	target = document.createElement('div');
	document.body.appendChild(target);
}

/** Say what this change is, on the sheet that offers it. */
function say(said: string): void {
	const field = document.body.querySelector<HTMLInputElement>(
		'[aria-label="Say what you changed"]'
	);
	if (!field) throw new Error('The sheet offering the change has nothing to say it in');
	field.value = said;
	field.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

/** Type a title into the note on screen, the way a finger leaving the field
 *  ends it. */
async function retitle(said: string): Promise<void> {
	const field = titleField();
	if (!field) throw new Error('The note on screen has no title field');
	field.value = said;
	field.dispatchEvent(new Event('input', { bubbles: true }));
	field.dispatchEvent(new Event('blur', { bubbles: true }));
	await settle();
}

interface Folder {
	store: Map<string, Uint8Array>;
	/** Whose the folder is. */
	did: DidSyr;
	/** The other identity this device holds, which owns no folder here. */
	helperDid: DidSyr;
	/** A note anybody writing in this folder writes. */
	open: OwnedRef;
	/** One its owner keeps to themselves. */
	owned: OwnedRef;
}

async function folder(): Promise<Folder> {
	const store = new Map<string, Uint8Array>();
	const owner = client(store);
	await owner.createGraph({ title: 'Thesis' });
	const did = (await owner.me())!.did;
	await owner.updateProfile({ display_name: 'Ada Lovelace' });
	const open = await owner.createNode({ title: 'The opening' });
	const written = await owner.createNode({ title: 'The argument' });
	await owner.updateNode(written.ref, { owner: did });
	const second = await holdDeviceIdentity(
		new MemoryFiles({ store, folder: FOLDER }),
		makeLocalIdentity(),
		{ writing: false }
	);
	return { store, did, helperDid: second.did, open: open.ref, owned: written.ref };
}

beforeEach(() => {
	stubViewport();
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	close();
	target.remove();
});

describe('a folder opened under an identity that does not own it', () => {
	it('lands a write on an open note and joins whose writing it carries', async () => {
		const held = await folder();
		await readingAs(client(held.store, held.helperDid));
		await open(held.open);

		await retitle('The opening, clearer');

		const after = await client(held.store).getNode(held.open);
		expect(after?.title).toBe('The opening, clearer');
		expect(authorsOf(after!)).toEqual([held.did, held.helperDid]);
		expect(screen()).toContain('Written by');
	});

	it('keeps a write off a note its owner writes, and offers it instead', async () => {
		const held = await folder();
		await readingAs(client(held.store, held.helperDid));
		await open(held.owned);

		expect(screen()).toContain('Only Ada Lovelace writes this note.');
		expect(screen()).toContain('What you write here is offered to them.');

		await retitle('The argument, as I would have it');
		expect((await client(held.store).getNode(held.owned))?.title).toBe('The argument');

		button('Offer this change').click();
		await settle();
		expect(screen()).toContain('Ada Lovelace');
		button('Offer it').click();
		await settle();

		expect(screen()).toContain('Offered to Ada Lovelace. It shows once they take it.');
		const standing = await client(held.store).listAmendments(held.owned);
		expect(standing).toHaveLength(1);
		expect(standing[0].by).toBe(held.helperDid);
		expect(standing[0].title).toBe('The argument, as I would have it');
		expect((await client(held.store).getNode(held.owned))?.title).toBe('The argument');
	});

	// A title used to be dropped where it was typed before the change being
	// offered had opened, because there was nowhere yet to put it.
	it('holds a title typed before the change being offered has opened', async () => {
		const held = await folder();
		await readingAs(
			new SlowToSayWhatIsOffered(new MemoryFiles({ store: held.store, folder: FOLDER }), {
				writer: held.helperDid
			})
		);
		put(held.owned);
		// One turn in, the note is on screen and what is offered on it is not
		// known yet, which is the window the title was dropped in.
		await new Promise((wake) => setTimeout(wake));
		flushSync();
		const field = titleField();
		if (!field) throw new Error('The note on screen has no title field');
		expect(field.readOnly).toBe(true);
		field.value = 'Typed while it was still opening';
		field.dispatchEvent(new Event('input', { bubbles: true }));
		field.dispatchEvent(new Event('blur', { bubbles: true }));
		await settle();

		expect(titleField()?.readOnly).toBe(false);
		expect(titleField()?.value).toBe('Typed while it was still opening');
		expect(offers.draft(held.owned)?.title).toBe('Typed while it was still opening');
		expect(button('Offer this change')).toBeDefined();
	});
});

describe('the folder’s owner, reading it back', () => {
	it('takes the offered change in and says whose writing the note now carries', async () => {
		const held = await folder();
		await readingAs(client(held.store, held.helperDid));
		await open(held.owned);
		await retitle('The argument, as I would have it');
		button('Offer this change').click();
		await settle();
		say('Reads better this way');
		button('Offer it').click();
		await settle();
		close();

		await readingAs(client(held.store));
		await open(held.owned);

		expect(screen()).toContain('Offered changes (1)');
		button('Offered changes (1)').click();
		await settle();
		button('Reads better this way').click();
		await settle();
		// Whoever offered it is named the same way here as on the row that led
		// in, rather than becoming an anonymous somebody between the two.
		expect(screen()).not.toContain('Somebody’s change');
		button('Take it in').click();
		await settle();

		const after = await client(held.store).getNode(held.owned);
		expect(after?.title).toBe('The argument, as I would have it');
		expect(after?.contributors).toEqual([held.helperDid]);
		expect(authorsOf(after!)).toEqual([held.did]);
		expect(screen()).toContain('Ada Lovelace');
		expect(screen()).toContain('with');
	});
});
