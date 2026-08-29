// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import TemplatePicker from './template-picker.svelte';
import type { NoteTemplate, TemplateId } from './templates.js';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let picked: (NoteTemplate | null)[];

function open(props: { suggested?: TemplateId; existing?: boolean } = {}) {
	mounted = mount(TemplatePicker, {
		target,
		props: { open: true, ...props, onpick: (t: NoteTemplate | null) => picked.push(t) }
	});
	flushSync();
}

const rows = () =>
	[...document.body.querySelectorAll('li button')].map((row) =>
		row.querySelector('span')?.textContent?.trim()
	);

beforeEach(() => {
	picked = [];
	stubMediaQuery(() => true);
	stubResizeObserver();
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
});

describe('offering a note a shape', () => {
	it('offers the note as it already is, first', () => {
		open();
		expect(rows()[0]).toBe('Just a note');
	});

	it('answers that offer with nothing to write', () => {
		open();
		const plain = [...document.body.querySelectorAll('li button')][0] as HTMLButtonElement;
		plain.click();
		expect(picked).toEqual([null]);
	});

	it('puts the shape that fits this note above the rest, and keeps the rest', () => {
		open({ suggested: 'synthesis' });
		expect(rows()[1]).toBe('Synthesis');
		expect(rows()).toHaveLength(6);
	});

	// The note on screen may hold writing that has not been saved yet, so the copy
	// promises where the sections land without claiming the note is empty.
	it('says where the sections land in a note that is already open', () => {
		open({ existing: true });
		expect(document.body.textContent).toContain(
			'The sections land under anything already in this note.'
		);
	});

	it('offers a note about to be written a shape to start from', () => {
		open();
		expect(document.body.textContent).toContain('Start from a shape');
		expect(document.body.textContent).not.toContain('already in this note');
	});
});
