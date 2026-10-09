// Where somebody copies the look they are wearing, saves it, opens one and
// pastes one in — DESIGN.md § "A look is a file".

import { LookSchema } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initRuntime } from '../runtime.js';
import { prefs } from '../stores/prefs.svelte.js';
import LookFile from './look-file.svelte';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let clipboard: string[];
let saved: { name: string; body: Blob }[];
/** What the next "Open a look…" hands back, or null for somebody who chose
 *  nothing. */
let offered: File | null;

function show(): void {
	mounted = mount(LookFile, { target });
	flushSync();
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 8; turn += 1) await new Promise((done) => setTimeout(done, 0));
	flushSync();
}

function labels(): string[] {
	return [...target.querySelectorAll('button')].map((one) => one.textContent?.trim() ?? '');
}

function press(label: string): void {
	const one = [...target.querySelectorAll('button')].find(
		(button) => button.textContent?.trim() === label
	);
	if (!one) throw new Error(`No button reads ${JSON.stringify(label)}: ${labels().join(' · ')}`);
	one.click();
	flushSync();
}

function paste(text: string): void {
	const box = target.querySelector<HTMLTextAreaElement>('#look-pasted');
	if (!box) throw new Error('No box to paste a look into');
	box.value = text;
	box.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

function screen(): string {
	return (target.textContent ?? '').replace(/\s+/g, ' ');
}

function aFile(text: string): File {
	return new File([text], 'a-look.json', { type: 'application/json' });
}

beforeEach(() => {
	localStorage.clear();
	document.getElementById('sloppy-look')?.remove();
	clipboard = [];
	saved = [];
	offered = null;
	vi.stubGlobal('matchMedia', (query: string) => ({
		matches: false,
		media: query,
		addEventListener: () => {},
		removeEventListener: () => {}
	}));
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: {
			writeText: async (text: string) => {
				clipboard.push(text);
			}
		}
	});
	initRuntime({
		apiHost: () => 'http://api.test',
		saveFile: async (name, body) => {
			saved.push({ name, body });
		},
		openFile: async () => offered
	});
	prefs.init();
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.getElementById('sloppy-look')?.remove();
	initRuntime({ apiHost: () => '', saveFile: undefined, openFile: undefined });
	vi.unstubAllGlobals();
});

describe('handing the look over', () => {
	it('puts it on the clipboard, and says so once', async () => {
		prefs.set('style', 'hardline');
		show();
		press('Copy');
		await settle();
		expect(clipboard).toHaveLength(1);
		const read = LookSchema.safeParse(JSON.parse(clipboard[0]));
		expect(read.success && read.data).toMatchObject({ based_on: 'paper', style: 'hardline' });
		expect(labels()).toContain('Copied');
	});

	it('leaves the rest of how Sloppy is kept off the clipboard', async () => {
		show();
		press('Copy');
		await settle();
		expect(JSON.parse(clipboard[0])).not.toHaveProperty('preferences');
	});

	it('saves the look alone, named for it', async () => {
		show();
		press('Save a look…');
		await settle();
		expect(saved).toHaveLength(1);
		expect(saved[0].name).toBe('paper.json');
		const read = LookSchema.safeParse(JSON.parse(await saved[0].body.text()));
		expect(read.success && read.data.based_on).toBe('paper');
		expect(read.success && read.data.preferences).toBeUndefined();
	});

	it('saves the settings beside it where that is what was asked for', async () => {
		prefs.set('tagOrder', 'name');
		show();
		press('Save my settings…');
		await settle();
		expect(saved[0].name).toBe('paper-settings.json');
		const read = LookSchema.safeParse(JSON.parse(await saved[0].body.text()));
		expect(read.success && read.data.preferences).toMatchObject({ tagOrder: 'name' });
	});

	it('offers neither save where this app has no way to hand a file over', () => {
		initRuntime({ apiHost: () => 'http://api.test', saveFile: null });
		show();
		expect(labels()).not.toContain('Save a look…');
		expect(labels()).not.toContain('Save my settings…');
		expect(labels()).toContain('Copy');
	});

	it('stands beside the box for a person to write their own rules in', () => {
		show();
		expect(target.querySelector('#your-own-css')).not.toBeNull();
	});

	it('offers no opening where this app has no way to ask for a file', () => {
		initRuntime({ apiHost: () => 'http://api.test', openFile: null });
		show();
		expect(labels()).not.toContain('Open a look…');
	});
});

describe('taking one in', () => {
	it('wears the look in a file somebody opens', async () => {
		show();
		offered = aFile(JSON.stringify({ name: 'Midnight Ink', based_on: 'graphite', style: 'bevel' }));
		press('Open a look…');
		await settle();
		expect(prefs.current.look).toBe('graphite');
		expect(prefs.current.style).toBe('bevel');
		expect(screen()).toContain('Now wearing Midnight Ink.');
	});

	it('changes nothing where somebody opens the file dialog and chooses nothing', async () => {
		show();
		press('Open a look…');
		await settle();
		expect(prefs.current.look).toBe('paper');
		expect(screen()).not.toContain('Now wearing');
	});

	it('turns down a file that is not a look, and changes nothing', async () => {
		prefs.set('style', 'hardline');
		show();
		offered = aFile('this is not a look at all');
		press('Open a look…');
		await settle();
		expect(screen()).toContain('That is not a look');
		expect(prefs.current.style).toBe('hardline');
	});

	it('turns down a file that is JSON but not a look', async () => {
		show();
		offered = aFile(JSON.stringify({ theme: 'dark', accent: 'rose' }));
		press('Open a look…');
		await settle();
		expect(screen()).toContain('That is not a look');
		expect(prefs.current.look).toBe('paper');
	});

	it('wears one pasted in, and empties the box', async () => {
		show();
		paste(JSON.stringify({ name: 'Midnight Ink', based_on: 'dark', density: 'compact' }));
		press('Use this look');
		await settle();
		expect(prefs.current.look).toBe('dark');
		expect(prefs.current.density).toBe('compact');
		expect(target.querySelector<HTMLTextAreaElement>('#look-pasted')?.value).toBe('');
	});

	it('leaves what was pasted in the box where it is turned down', async () => {
		show();
		paste('{ "name": "Phoning home", "css": "@import url(https://x.test/a.css)" }');
		press('Use this look');
		await settle();
		expect(screen()).toContain('cannot load anything from the web');
		expect(target.querySelector<HTMLTextAreaElement>('#look-pasted')?.value).not.toBe('');
		expect(prefs.current.css).toBe('');
	});

	it('moves the rest of how Sloppy is kept where the look carries it', async () => {
		show();
		paste(JSON.stringify({ name: 'Mine', preferences: { tagOrder: 'name' } }));
		press('Use this look');
		await settle();
		expect(prefs.current.tagOrder).toBe('name');
	});

	it('has nothing to use until something is pasted', () => {
		show();
		const use = [...target.querySelectorAll('button')].find(
			(one) => one.textContent?.trim() === 'Use this look'
		);
		expect(use?.disabled).toBe(true);
	});
});
