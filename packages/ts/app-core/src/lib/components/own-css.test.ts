// Rules of a person's own, kept as they type and withheld from the page where
// they would reach the web — DESIGN.md § "A look is a file".

import { LOOK_CSS_MAX } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prefs } from '../stores/prefs.svelte.js';
import OwnCss from './own-css.svelte';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function show(): void {
	mounted = mount(OwnCss, { target });
	flushSync();
}

function field(): HTMLTextAreaElement {
	const found = target.querySelector<HTMLTextAreaElement>('#your-own-css');
	if (!found) throw new Error('No box for a person to write their own rules in');
	return found;
}

function type(said: string): void {
	const box = field();
	box.value = said;
	box.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

/** Long enough for the box to settle, and a turn for the page to catch up. */
async function settles(): Promise<void> {
	await new Promise((done) => setTimeout(done, 600));
	flushSync();
}

function screen(): string {
	return (target.textContent ?? '').replace(/\s+/g, ' ');
}

/** The look's own rules as they stand on the page, or null where none do. */
function onThePage(): string | null {
	return document.getElementById('sloppy-look')?.textContent ?? null;
}

beforeEach(() => {
	localStorage.clear();
	document.getElementById('sloppy-look')?.remove();
	vi.stubGlobal('matchMedia', (query: string) => ({
		matches: false,
		media: query,
		addEventListener: () => {},
		removeEventListener: () => {}
	}));
	prefs.init();
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.getElementById('sloppy-look')?.remove();
	vi.unstubAllGlobals();
});

describe('a person writing their own rules', () => {
	it('opens on the ones they already have', () => {
		prefs.set('css', '.a { color: red }');
		show();
		expect(field().value).toBe('.a { color: red }');
	});

	it('keeps them once the typing stops, and they reach the page', async () => {
		show();
		type('.sloppy-prose h2 { letter-spacing: .02em }');
		expect(prefs.current.css).toBe('');
		await settles();
		expect(prefs.current.css).toBe('.sloppy-prose h2 { letter-spacing: .02em }');
		expect(onThePage()).toBe('.sloppy-prose h2 { letter-spacing: .02em }');
	});

	it('says a look cannot reach the web, and keeps what they wrote in front of them', async () => {
		show();
		type('@import url(https://x.test/a.css)');
		expect(screen()).toContain('A look cannot load anything from the web');
		await settles();
		expect(prefs.current.css).toBe('@import url(https://x.test/a.css)');
		expect(onThePage()).toBeNull();
	});

	it('takes in the rules a look arriving from elsewhere brought', () => {
		show();
		prefs.set('css', '.from-a-file { color: blue }');
		flushSync();
		expect(field().value).toBe('.from-a-file { color: blue }');
	});

	it('says the room left only once there is little of it', async () => {
		show();
		type('.a { color: red }');
		await settles();
		expect(screen()).not.toContain('characters left');
		type(`/*${'a'.repeat(LOOK_CSS_MAX - 8)}*/`);
		expect(screen()).toContain('4 characters left');
		await settles();
	});

	it('takes no more than a look can carry', () => {
		show();
		expect(field().maxLength).toBe(LOOK_CSS_MAX);
	});
});
