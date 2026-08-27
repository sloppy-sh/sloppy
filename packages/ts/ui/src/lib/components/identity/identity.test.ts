// @vitest-environment jsdom
import type { ComponentProps } from 'svelte';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery } from '../dom.test-support.js';
import Avatar from './avatar.svelte';
import PersonEditor from './person-editor.svelte';
import type { Person, PictureRole } from './person.js';

const SOMEBODY: Person = {
	displayName: 'Ada Lovelace',
	handle: 'ada',
	bio: 'Notes on the engine.',
	avatar: '/api/proxy?ref=avatar',
	banner: '/api/proxy?ref=banner'
};

const STILL = (query: string) => query.includes('prefers-reduced-motion');
const MOVING = () => false;

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function showAvatar(person: Person): void {
	mounted = mount(Avatar, { target, props: { person } });
	flushSync();
}

function showEditor(props: Partial<ComponentProps<typeof PersonEditor>> = {}): void {
	mounted = mount(PersonEditor, {
		target,
		props: {
			person: SOMEBODY,
			onPicture: () => {},
			onSave: () => {},
			onCancel: () => {},
			...props
		}
	});
	flushSync();
}

const picture = () => target.querySelector<HTMLImageElement>('img:not(.size-0)');
const canvas = () => target.querySelector('canvas');

beforeEach(() => {
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
});

describe('a person’s picture', () => {
	it('stands in with their initials until one loads', () => {
		stubMediaQuery(MOVING);
		showAvatar({ ...SOMEBODY, avatar: null });
		expect(target.textContent).toContain('AL');
		expect(picture()).toBeNull();
	});

	it('falls back to their handle when they have chosen no name', () => {
		stubMediaQuery(MOVING);
		showAvatar({ ...SOMEBODY, displayName: null, avatar: null });
		expect(target.textContent).toContain('AD');
	});

	it('draws the picture itself while motion is welcome', () => {
		stubMediaQuery(MOVING);
		showAvatar(SOMEBODY);
		expect(picture()?.src).toContain('avatar');
		expect(canvas()).toBeNull();
	});

	// An `<img>` cannot be paused, so stillness is a sampled frame or nothing.
	it('samples the picture into a frame when the reader asked for stillness', () => {
		stubMediaQuery(STILL);
		showAvatar(SOMEBODY);
		expect(canvas()).not.toBeNull();
	});

	// A picture with any transparency would otherwise have letters showing
	// through it for as long as it is on screen.
	it('takes the initials away once the picture is drawn', () => {
		stubMediaQuery(MOVING);
		showAvatar(SOMEBODY);
		expect(target.textContent).toContain('AL');
		picture()?.dispatchEvent(new Event('load'));
		flushSync();
		expect(target.textContent).not.toContain('AL');
	});

	it('shows the initials when the picture will not load', () => {
		stubMediaQuery(MOVING);
		showAvatar(SOMEBODY);
		picture()?.dispatchEvent(new Event('error'));
		flushSync();
		expect(picture()).toBeNull();
		expect(target.textContent).toContain('AL');
	});
});

describe('changing how you appear', () => {
	function chose(role: PictureRole, file: File): void {
		const inputs = [...target.querySelectorAll<HTMLInputElement>('input[type="file"]')];
		const input = role === 'banner' ? inputs[0] : inputs[1];
		if (!input) throw new Error(`No ${role} picker on screen`);
		Object.defineProperty(input, 'files', { configurable: true, value: [file] });
		input.dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();
	}

	const field = (id: string) => target.querySelector<HTMLInputElement>(`#${id}`);

	it('hands a chosen picture back with what it is for', () => {
		stubMediaQuery(MOVING);
		const picked: Array<[PictureRole, string]> = [];
		showEditor({ onPicture: (role, file) => picked.push([role, file.name]) });
		chose('avatar', new File(['x'], 'face.png', { type: 'image/png' }));
		chose('banner', new File(['x'], 'wide.png', { type: 'image/png' }));
		expect(picked).toEqual([
			['avatar', 'face.png'],
			['banner', 'wide.png']
		]);
	});

	it('starts from what the store already holds, and saves what was typed', () => {
		stubMediaQuery(MOVING);
		let saved: { displayName: string; bio: string } | null = null;
		showEditor({ onSave: (edits) => (saved = edits) });
		const name = field('person-name');
		expect(name?.value).toBe('Ada Lovelace');
		if (!name) throw new Error('No name field on screen');
		name.value = 'Ada';
		name.dispatchEvent(new Event('input'));
		flushSync();
		target.querySelector('form')?.requestSubmit();
		flushSync();
		expect(saved).toEqual({ displayName: 'Ada', bio: 'Notes on the engine.' });
	});

	it('opens the picker the button is for', () => {
		stubMediaQuery(MOVING);
		showEditor();
		const opened: string[] = [];
		for (const [index, input] of [
			...target.querySelectorAll<HTMLInputElement>('input[type="file"]')
		].entries()) {
			input.click = () => opened.push(index === 0 ? 'banner' : 'avatar');
		}
		for (const label of ['Change picture', 'Change banner']) {
			[...target.querySelectorAll('button')].find((b) => b.textContent?.includes(label))?.click();
		}
		expect(opened).toEqual(['avatar', 'banner']);
	});

	it('will not pick a second picture while one is being added', () => {
		stubMediaQuery(MOVING);
		showEditor({ replacing: 'avatar' });
		const buttons = [...target.querySelectorAll('button')];
		expect(buttons.filter((b) => b.disabled).length).toBe(2);
		expect(target.textContent).toContain('Adding…');
	});
});
