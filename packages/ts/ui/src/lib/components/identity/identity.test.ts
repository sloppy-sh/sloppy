// @vitest-environment jsdom
import type { ComponentProps } from 'svelte';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery } from '../dom.test-support.js';
import Avatar from './avatar.svelte';
import PersonEditor from './person-editor.svelte';
import PersonHeader from './person-header.svelte';
import { nameOr, type Person, type PictureRole } from './person.js';

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
const source = () => target.querySelector<HTMLImageElement>('img.size-0');

let restore: Array<() => void> = [];

/** jsdom implements no 2D context, so a frame is drawn against a recorder. */
function stubCanvas(): Array<{ w: number; h: number }> {
	const drawn: Array<{ w: number; h: number }> = [];
	const was = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');
	Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
		configurable: true,
		writable: true,
		value: () => ({
			drawImage: (_: unknown, __: number, ___: number, w: number, h: number) => drawn.push({ w, h })
		})
	});
	restore.push(() => {
		if (was) Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', was);
	});
	return drawn;
}

/** jsdom loads nothing, so a picture has no size of its own to be sampled at. */
function stubIntrinsic(width: number, height: number): void {
	for (const [prop, value] of [
		['naturalWidth', width],
		['naturalHeight', height]
	] as const) {
		const was = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, prop);
		Object.defineProperty(HTMLImageElement.prototype, prop, {
			configurable: true,
			get: () => value
		});
		restore.push(() => {
			if (was) Object.defineProperty(HTMLImageElement.prototype, prop, was);
		});
	}
}

beforeEach(() => {
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	for (const undo of restore) undo();
	restore = [];
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
		const drawn = stubCanvas();
		stubIntrinsic(800, 400);
		showAvatar(SOMEBODY);
		expect(picture()).toBeNull();
		source()?.dispatchEvent(new Event('load'));
		flushSync();
		expect(drawn).toEqual([{ w: 80, h: 40 }]);
		expect(canvas()?.width).toBe(80);
		expect(target.textContent).not.toContain('AL');
	});

	it('keeps the initials while the frame is still blank', () => {
		stubMediaQuery(STILL);
		stubCanvas();
		showAvatar(SOMEBODY);
		expect(target.textContent).toContain('AL');
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

describe('the top of somebody’s page', () => {
	function showHeader(): void {
		mounted = mount(PersonHeader, { target, props: { person: SOMEBODY } });
		flushSync();
	}

	// The banner is the largest moving surface on the page, not the avatar.
	it('holds the banner still too where the reader asked for stillness', () => {
		stubMediaQuery(STILL);
		stubCanvas();
		showHeader();
		expect(target.querySelectorAll('canvas').length).toBe(2);
	});

	it('lets both pictures play where motion is welcome', () => {
		stubMediaQuery(MOVING);
		showHeader();
		expect(canvas()).toBeNull();
		expect(target.querySelectorAll('img').length).toBe(2);
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

	// On a phone the pickers are at the top of a form taller than the screen, so
	// a refusal at the foot of it is a refusal nobody reads.
	it('says a refused picture beside the picker that asked for it', () => {
		stubMediaQuery(MOVING);
		showEditor({
			refused: { picture: 'avatar', message: 'That picture could not be added. Try again.' }
		});
		const said = target.querySelector('[role="alert"]');
		expect(said?.textContent).toContain('That picture could not be added.');
		expect(said?.previousElementSibling?.textContent).toContain('Change picture');
	});

	it('says a refused save where the save was asked for', () => {
		stubMediaQuery(MOVING);
		showEditor({ refused: { picture: null, message: 'That could not be saved. Try again.' } });
		const said = target.querySelector('[role="alert"]');
		expect(said?.nextElementSibling?.textContent).toContain('Save');
	});

	it('will not pick a second picture while one is being added', () => {
		stubMediaQuery(MOVING);
		showEditor({ replacing: 'avatar' });
		const buttons = [...target.querySelectorAll('button')];
		expect(buttons.filter((b) => b.disabled).length).toBe(2);
		expect(target.textContent).toContain('Adding…');
	});
});

describe('what to call somebody', () => {
	it('is the name they chose, then the handle behind it', () => {
		expect(nameOr(SOMEBODY)).toBe('Ada Lovelace');
		expect(nameOr({ ...SOMEBODY, displayName: '  ' })).toBe('ada');
	});

	it('is Somebody where nobody has been resolved yet', () => {
		expect(nameOr(null)).toBe('Somebody');
	});
});
