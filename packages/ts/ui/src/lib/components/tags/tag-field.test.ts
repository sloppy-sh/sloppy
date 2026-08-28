// @vitest-environment jsdom
import type { Tag } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import TagField from './tag-field.svelte';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let saved: Tag[][];
let refuse: (() => never) | null;

function render(props: { tags?: Tag[]; suggestions?: Tag[] } = {}) {
	mounted = mount(TagField, {
		target,
		props: {
			tags: [],
			onchange: (next: Tag[]) => {
				saved.push(next);
				refuse?.();
			},
			...props
		}
	});
	flushSync();
	return target.querySelector('input') as HTMLInputElement;
}

const chips = () =>
	[...target.querySelectorAll('button[aria-label^="Remove "]')].map(
		(button) => button.getAttribute('aria-label')?.slice('Remove '.length) ?? ''
	);

const options = () =>
	[...target.querySelectorAll('[role="option"]')].map((li) => li.textContent?.trim());

const alert = () => target.querySelector('[role="alert"]')?.textContent;

/** A key the way the field receives one, so the handler's guards are exercised. */
function press(field: HTMLInputElement, key: string): void {
	field.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
	flushSync();
}

function type(field: HTMLInputElement, text: string): void {
	field.value = text;
	field.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

beforeEach(() => {
	saved = [];
	refuse = null;
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
});

describe('writing a tag', () => {
	it('commits what was typed on Enter, and empties the field', () => {
		const field = render();
		type(field, 'biology');
		press(field, 'Enter');
		expect(saved).toEqual([['biology']]);
		expect(field.value).toBe('');
	});

	// Enter alone ends a tag, so the space bar is free to type one.
	it('takes a tag of more than one word', () => {
		const field = render({ tags: ['biology'] as Tag[] });
		type(field, 'machine learning');
		press(field, 'Enter');
		expect(saved).toEqual([['biology', 'machine learning']]);
	});

	it('does not commit on the space bar', () => {
		const field = render();
		type(field, 'machine');
		press(field, ' ');
		expect(saved).toEqual([]);
	});

	// `TagsSchema` is a set: the API stores one copy, so the field shows one.
	it('folds case and accepts a tag once', () => {
		const field = render({ tags: ['biology'] as Tag[] });
		type(field, 'Biology');
		press(field, 'Enter');
		expect(saved).toEqual([]);
		expect(field.value).toBe('');
	});

	it('sorts what it sends, so two notes with the same tags agree byte for byte', () => {
		const field = render({ tags: ['seed'] as Tag[] });
		type(field, 'biology');
		press(field, 'Enter');
		expect(saved).toEqual([['biology', 'seed']]);
	});

	// DESIGN.md § Forms: the field and the API validate the same object, so the
	// sentence a person reads here is the one the server would have sent.
	it("refuses a tag in the schema's own words, and keeps what was pasted", () => {
		const field = render();
		type(field, 'bio\u200blogy');
		press(field, 'Enter');
		expect(saved).toEqual([]);
		expect(alert()).toBe('A tag cannot hold hidden characters.');
		expect(field.value).toBe('bio\u200blogy');
	});

	// In the same task as the blur, so whatever the tap that caused it goes on to
	// do — opening another note, closing this one — cannot get there first.
	it('commits what is left in the field the moment it loses focus', () => {
		const field = render();
		type(field, 'method');
		field.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
		expect(saved).toEqual([['method']]);
	});

	it('does nothing on Enter with an empty field', () => {
		const field = render({ tags: ['seed'] as Tag[] });
		press(field, 'Enter');
		expect(saved).toEqual([]);
	});
});

describe('taking a tag off', () => {
	it('removes the one whose chip was clicked', () => {
		render({ tags: ['biology', 'seed'] as Tag[] });
		const remove = target.querySelector('button[aria-label="Remove biology"]') as HTMLButtonElement;
		remove.click();
		flushSync();
		expect(saved).toEqual([['seed']]);
	});

	it('removes the last on Backspace in an empty field, and only then', () => {
		const field = render({ tags: ['biology', 'seed'] as Tag[] });
		type(field, 'me');
		press(field, 'Backspace');
		expect(saved).toEqual([]);
		type(field, '');
		press(field, 'Backspace');
		expect(saved).toEqual([['biology']]);
	});
});

describe('completing from what is already in the graph', () => {
	const suggestions = ['biology', 'biochemistry', 'seed'] as Tag[];

	it('offers nothing until something is typed', () => {
		render({ suggestions });
		expect(options()).toEqual([]);
	});

	it('offers what matches, minus what the note already carries', () => {
		const field = render({ tags: ['biology'] as Tag[], suggestions });
		type(field, 'bio');
		expect(options()).toEqual(['biochemistry']);
	});

	// The word being typed is what Enter is for; a completion is offered, never
	// substituted. Without this, "work" cannot be written where "working" exists.
	it('commits what was typed even where a longer tag completes it', () => {
		const field = render({ suggestions });
		type(field, 'bio');
		expect(options()).toEqual(['biology', 'biochemistry']);
		press(field, 'Enter');
		expect(saved).toEqual([['bio']]);
	});

	it('commits the one the arrow keys chose', () => {
		const field = render({ suggestions });
		type(field, 'bio');
		press(field, 'ArrowDown');
		press(field, 'ArrowDown');
		press(field, 'Enter');
		expect(saved).toEqual([['biochemistry']]);
	});

	// So the arrows can be walked off the list without retyping the word.
	it('steps off the end of the list back onto the typed word', () => {
		const field = render({ suggestions });
		type(field, 'bio');
		press(field, 'ArrowUp');
		press(field, 'ArrowDown');
		press(field, 'Enter');
		expect(saved).toEqual([['bio']]);
	});

	it('agrees with the blur, which commits the typed word too', () => {
		const field = render({ suggestions });
		type(field, 'bio');
		field.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
		expect(saved).toEqual([['bio']]);
	});

	it('commits the one that was clicked', () => {
		const field = render({ suggestions });
		type(field, 'bio');
		(target.querySelector('[role="option"] button') as HTMLButtonElement).click();
		flushSync();
		expect(saved).toEqual([['biology']]);
	});

	// Otherwise the blur that tapping one causes would commit the half-typed
	// word first, and the note would come away with two tags instead of one.
	it('keeps the caret in the field when one is tapped', () => {
		const field = render({ suggestions });
		type(field, 'bio');
		const option = target.querySelector('[role="option"] button') as HTMLButtonElement;
		const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
		option.dispatchEvent(down);
		flushSync();

		expect(down.defaultPrevented).toBe(true);
		option.click();
		flushSync();
		expect(saved).toEqual([['biology']]);
	});

	it('puts the list away on Escape without losing what was typed', () => {
		const field = render({ suggestions });
		type(field, 'bio');
		press(field, 'Escape');
		expect(options()).toEqual([]);
		expect(saved).toEqual([]);
		expect(field.value).toBe('bio');
	});

	// The field lives inside a note, and the note closes on Escape. The keystroke
	// that dismisses the list is spent doing that and nothing else.
	it('keeps the Escape that dismissed the list to itself, and only that one', () => {
		const field = render({ suggestions });
		const heard: string[] = [];
		const listen = (event: Event) => heard.push((event as KeyboardEvent).key);
		document.addEventListener('keydown', listen);
		try {
			type(field, 'bio');
			press(field, 'Escape');
			expect(heard).toEqual([]);
			press(field, 'Escape');
			expect(heard).toEqual(['Escape']);
		} finally {
			document.removeEventListener('keydown', listen);
		}
	});
});

describe('when the save is refused', () => {
	it('puts the chips back and says so', () => {
		refuse = () => {
			throw new Error('nope');
		};
		const field = render({ tags: ['seed'] as Tag[] });
		type(field, 'biology');
		press(field, 'Enter');
		flushSync();
		expect(alert()).toBeTruthy();
		expect(chips()).toEqual(['seed']);
	});
});
