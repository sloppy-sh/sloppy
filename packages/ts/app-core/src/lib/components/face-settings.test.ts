// The three faces as somebody sets them — DESIGN.md § Typography.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FACES, prefs } from '../stores/prefs.svelte.js';
import FaceSettings from './face-settings.svelte';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function show(): void {
	mounted = mount(FaceSettings, { target });
	flushSync();
}

function choices(role: string): HTMLInputElement[] {
	return [...target.querySelectorAll<HTMLInputElement>(`input[name="face-${role}"]`)];
}

function pick(role: string, value: string): void {
	const found = choices(role).find((one) => one.value === value);
	if (!found) throw new Error(`No "${value}" among the faces for ${role}`);
	found.click();
	flushSync();
}

function type(family: string): void {
	const input = target.querySelector<HTMLInputElement>('input:not([type="radio"])');
	if (!input) throw new Error('No field for a family of their own');
	input.value = family;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
	target
		.querySelector('form')
		?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	flushSync();
}

beforeEach(() => {
	localStorage.clear();
	prefs.init();
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted);
	mounted = undefined;
	target.remove();
});

describe('the faces somebody sets', () => {
	it('offers each of the three every face, and one more for a family of their own', () => {
		show();
		for (const role of ['ui', 'heading', 'mono']) {
			expect(choices(role).map((one) => one.value)).toEqual([...FACES, '…']);
		}
		for (const row of ['The app', 'Headings', 'Code and addresses']) {
			expect(target.textContent).toContain(row);
		}
	});

	it('reads the role somebody picks a face for in it, and nothing beside it', () => {
		show();
		pick('heading', 'atkinson');

		expect(prefs.current.fonts).toEqual({
			ui: 'system',
			heading: 'atkinson',
			mono: 'system'
		});
		expect(document.documentElement.style.getPropertyValue('--font-heading')).toContain(
			'Atkinson Hyperlegible'
		);
		expect(document.documentElement.style.getPropertyValue('--font-sans')).toBe('');
	});

	it('keeps a family somebody names, and shows it where they named it', () => {
		show();
		pick('mono', '…');
		type('Iosevka Etoile');

		expect(prefs.current.fonts.mono).toBe('Iosevka Etoile');
		expect(document.documentElement.style.getPropertyValue('--font-mono')).toContain(
			'Iosevka Etoile'
		);
		expect(target.textContent).toContain('Iosevka Etoile');
		// The row stands on the family rather than on a face nobody picked.
		const standing = choices('mono').find((one) => one.checked);
		expect(standing?.value).toBe('…');
	});

	it('says what a name that is not one needs, and changes nothing', () => {
		show();
		pick('ui', 'inter');
		pick('ui', '…');
		type('Inter; position: fixed');

		expect(prefs.current.fonts.ui).toBe('inter');
		expect(target.querySelector('[role="alert"]')?.textContent).toContain('not the name of a face');
		expect(document.documentElement.style.getPropertyValue('--font-sans')).toContain('Inter');
	});

	it('comes back to a face this build ships from a family of somebody’s own', () => {
		show();
		pick('ui', '…');
		type('Iosevka Etoile');
		pick('ui', 'system');

		expect(prefs.current.fonts.ui).toBe('system');
		expect(document.documentElement.style.getPropertyValue('--font-sans')).toBe('');
		expect(target.textContent).not.toContain('Iosevka Etoile');
	});

	// A face offered here is one the app holds itself: choosing one must not send
	// a reader's request to somebody else's machine. A family named without
	// quotes is the device's own to answer, and nothing is shipped for it.
	it('offers no face this app does not hold itself', () => {
		const shells = ['web', 'native'].map((shell) =>
			readFileSync(resolve(process.cwd(), `../../../apps/sloppy/${shell}/src/fonts.css`), 'utf8')
		);
		show();
		const families = new Set<string>();
		for (const face of FACES) {
			for (const [role, token] of [
				['ui', '--font-sans'],
				['mono', '--font-mono']
			] as const) {
				pick(role, face);
				const stack = document.documentElement.style.getPropertyValue(token);
				for (const [, family] of stack.matchAll(/'([^']+)'/g)) families.add(family);
			}
		}
		expect(families.size).toBeGreaterThan(0);
		for (const css of shells) {
			for (const family of families) {
				expect(css, `a shell does not hold ${family}`).toContain(`font-family: '${family}'`);
			}
		}
	});
});
