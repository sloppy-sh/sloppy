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

function field(role: string): HTMLInputElement | null {
	const row = choices(role)[0]?.closest('fieldset');
	return row?.querySelector<HTMLInputElement>('input:not([type="radio"])') ?? null;
}

function fill(role: string, family: string): void {
	const input = field(role);
	if (!input) throw new Error(`No field for a family of their own under ${role}`);
	input.value = family;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

function type(role: string, family: string): void {
	fill(role, family);
	field(role)
		?.closest('form')
		?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	flushSync();
}

function nevermind(role: string): void {
	const row = choices(role)[0]?.closest('fieldset');
	const out = [...(row?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
		(one) => one.textContent?.trim() === 'Never mind'
	);
	if (!out) throw new Error(`No way back out of the field under ${role}`);
	out.click();
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
	it('offers each of the three every face but its own, and one more for a family of their own', () => {
		show();
		// The app is already set in Inter, so offering it beside Default would
		// be the same choice twice; no other role is set in a face it ships.
		expect(choices('ui').map((one) => one.value)).toEqual([
			...FACES.filter((face) => face !== 'inter'),
			'…'
		]);
		for (const role of ['heading', 'mono']) {
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
		type('mono', 'Iosevka Etoile');

		expect(prefs.current.fonts.mono).toBe('Iosevka Etoile');
		expect(document.documentElement.style.getPropertyValue('--font-mono')).toContain(
			'Iosevka Etoile'
		);
		expect(target.textContent).toContain('Iosevka Etoile');
		// The row stands on the family rather than on a face nobody picked.
		const standing = choices('mono').find((one) => one.checked);
		expect(standing?.value).toBe('…');
	});

	// A name somebody typed is theirs to correct: a pill that is already on
	// cannot be chosen again, so the field it was typed in stays open.
	it('corrects a family somebody mistyped, where they typed it', () => {
		show();
		pick('mono', '…');
		type('mono', 'Iosevkaa Etoile');
		expect(field('mono')?.value).toBe('Iosevkaa Etoile');

		type('mono', 'Iosevka Etoile');

		expect(prefs.current.fonts.mono).toBe('Iosevka Etoile');
		expect(document.documentElement.style.getPropertyValue('--font-mono')).toContain(
			'Iosevka Etoile'
		);
		expect(target.textContent).not.toContain('Iosevkaa Etoile');
	});

	it('comes back out of the field to the face that is kept', () => {
		show();
		pick('ui', 'atkinson');
		pick('ui', '…');
		nevermind('ui');

		expect(field('ui')).toBeNull();
		expect(choices('ui').find((one) => one.checked)?.value).toBe('atkinson');

		pick('heading', '…');
		type('heading', 'Iosevka Etoile');
		fill('heading', 'Iosevkaa');
		nevermind('heading');

		expect(field('heading')?.value).toBe('Iosevka Etoile');
		expect(prefs.current.fonts.heading).toBe('Iosevka Etoile');
	});

	it('says what a name that is not one needs, and changes nothing', () => {
		show();
		pick('ui', 'atkinson');
		pick('ui', '…');
		type('ui', 'Inter; position: fixed');

		expect(prefs.current.fonts.ui).toBe('atkinson');
		expect(target.querySelector('[role="alert"]')?.textContent).toContain('not the name of a face');
		expect(document.documentElement.style.getPropertyValue('--font-sans')).toContain(
			'Atkinson Hyperlegible'
		);
	});

	it('comes back to a face this build ships from a family of somebody’s own', () => {
		show();
		pick('ui', '…');
		type('ui', 'Iosevka Etoile');
		pick('ui', 'system');

		expect(prefs.current.fonts.ui).toBe('system');
		expect(document.documentElement.style.getPropertyValue('--font-sans')).toBe('');
		expect(target.textContent).not.toContain('Iosevka Etoile');
	});

	// A face reads best as itself, and what sets these four apart is what they
	// letter an operator as, so each name carries one.
	it('writes the operators after the name of a face that letters them', () => {
		show();
		const shown = (value: string): string =>
			choices('mono')
				.find((one) => one.value === value)
				?.closest('label')
				?.textContent?.trim() ?? '';

		for (const [face, name] of [
			['firacode', 'Fira Code'],
			['cascadiacode', 'Cascadia Code'],
			['victormono', 'Victor Mono'],
			['iosevka', 'Iosevka']
		] as const) {
			expect(shown(face)).toBe(`${name} -> != =>`);
		}
		expect(shown('inter')).toBe('Inter');
		expect(shown('atkinson')).toBe('Atkinson Hyperlegible');
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
				['heading', '--font-heading'],
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
