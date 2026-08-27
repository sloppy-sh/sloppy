import type { OwnedRef } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodes } from '../stores/nodes.svelte.js';
import { session } from '../stores/session.svelte.js';
import {
	DID,
	node,
	ref,
	useFakeApi,
	VIEWER,
	type FakeApi
} from '../stores/fake-api.test-support.js';
import NoteInModal from './note-in-modal.test-support.svelte';

const FIRST = ref(1);
const SECOND = ref(2);

const PHONE = () => true;
const WIDE = () => false;

function path(of: OwnedRef): string {
	const cut = of.lastIndexOf('/');
	return `/nodes/${encodeURIComponent(of.slice(0, cut))}/${encodeURIComponent(of.slice(cut + 1))}`;
}

function stubViewport(matches: () => boolean): void {
	Object.defineProperty(globalThis, 'matchMedia', {
		configurable: true,
		writable: true,
		value: () => ({
			matches: matches(),
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

/** Past the frame the modal claims focus on, and the one the caret follows in. */
async function settle(): Promise<void> {
	for (let frame = 0; frame < 4; frame += 1) await new Promise(requestAnimationFrame);
}

const focused = () => document.activeElement as HTMLElement | null;
const title = () => document.body.querySelector<HTMLTextAreaElement>('[aria-label="Title"]');

function button(labelled: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find((b) =>
		b.textContent?.includes(labelled)
	);
	if (!found) throw new Error(`No "${labelled}" button on screen`);
	return found;
}

let api: FakeApi;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

beforeEach(() => {
	nodes.clear();
	api = useFakeApi();
	const written = [node(1, '1'), node(2, '1a', { origin: FIRST, parent: FIRST })];
	api.on('POST /nodes', () => written.shift());
	for (const of of [FIRST, SECOND]) {
		api.on(`GET ${path(of)}`, () => node(of === FIRST ? 1 : 2, of === FIRST ? '1' : '1a'));
		api.on(`GET ${path(of)}/blocks`, () => []);
	}
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	session.clear();
	target.remove();
	document.body.innerHTML = '';
});

async function openWritten(at: () => boolean): Promise<OwnedRef> {
	stubViewport(at);
	const written = await nodes.create({});
	mounted = mount(NoteInModal, { target, props: { opened: written.ref } });
	flushSync();
	await settle();
	return written.ref;
}

describe.each([
	['on a phone', PHONE],
	['at desktop width', WIDE]
])('a note just written, %s', (_where, at) => {
	it('opens with the caret in its title', async () => {
		await openWritten(at);
		expect(focused()).toBe(title());
	});

	it('hands the caret on to the next note written from inside it', async () => {
		await openWritten(at);

		const write = button('Write a note under this');
		write.focus();
		write.click();
		await settle();

		expect(focused()).toBe(title());
		expect(title()?.value).toBe('');
	});
});

describe('a note opened to read', () => {
	it('keeps the caret out of its title', async () => {
		stubViewport(PHONE);
		await nodes.create({});
		mounted = mount(NoteInModal, { target, props: { opened: FIRST, fresh: false } });
		flushSync();
		await settle();

		expect(title()).not.toBeNull();
		expect(focused()).not.toBe(title());
	});

	it('does not call writing it could not read nothing at all', async () => {
		stubViewport(WIDE);
		await nodes.create({});
		api.on(`GET ${path(FIRST)}/blocks`, () => {
			throw new Error('unreachable');
		});

		mounted = mount(NoteInModal, { target, props: { opened: FIRST, fresh: false } });
		flushSync();
		await settle();

		expect(document.body.textContent).toContain('Close it and open it again');
		expect(document.body.textContent).not.toContain('Nothing written here yet');
	});
});

describe('what a note is written with', () => {
	function labelled(label: string): HTMLButtonElement | undefined {
		return [...document.body.querySelectorAll('button')].find(
			(b) => b.getAttribute('aria-label') === label
		);
	}

	async function openToWrite(): Promise<void> {
		stubViewport(WIDE);
		session.adopt(VIEWER, 'a-session');
		await nodes.create({});
		mounted = mount(NoteInModal, { target, props: { opened: FIRST, fresh: false } });
		flushSync();
		await settle();
		document.body
			.querySelector('.sloppy-prose')
			?.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
		flushSync();
	}

	it('offers a picture, and what the person already has', async () => {
		api.on('GET /media/uploads', () => [
			{ upload_id: `${DID}/01OLD`, filename: 'kite.png', mime_type: 'image/png', size: 9 }
		]);
		await openToWrite();

		labelled('Picture')?.click();
		flushSync();
		await settle();
		flushSync();

		expect(document.body.querySelector('input[type="file"]')).not.toBeNull();
		expect(labelled('kite.png')).toBeDefined();
	});

	it('offers the emoji this person uploaded, not only the Unicode set', async () => {
		api.on('GET /emoji/me', () => [
			{ emoji_id: `${DID}/01E`, did: DID, shortcode: 'parrot', kind: 'emoji', src: '/proxy?ref=p' }
		]);
		await openToWrite();

		labelled('Emoji')?.click();
		flushSync();
		await settle();
		flushSync();

		expect(document.body.textContent).toContain('Yours');
		expect(labelled('parrot')).toBeDefined();
	});
});
