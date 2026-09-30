// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import BinSheet, { type BinnedNote } from './bin-sheet.svelte';

const ORIGINS: BinnedNote = {
	ref: 'did:syr:z6Mk/01ARZ3NDEKTSV4RRFFQ69G5FAV',
	address: '1a',
	graph: 'The thesis',
	title: 'Origins',
	notes: 3,
	within: '20 days left'
};

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let putBack: string[];

function open(over: Record<string, unknown> = {}): void {
	putBack = [];
	mounted = mount(BinSheet, {
		target,
		props: {
			open: true,
			notes: [ORIGINS],
			keptForDays: 30,
			onRestore: async (ref: string) => {
				putBack.push(ref);
				return true;
			},
			...over
		}
	});
	flushSync();
}

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

beforeEach(() => {
	stubMediaQuery((query) => query.includes('max-width'));
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

describe('what you deleted', () => {
	it('names a note by its number and title, says which graph and how long is left', () => {
		open();

		expect(screen()).toContain('1a');
		expect(screen()).toContain('Origins');
		expect(screen()).toContain('The thesis');
		expect(screen()).toContain('3 notes');
		expect(screen()).toContain('20 days left');
	});

	// The number the promise is made in is the one the sweep reads.
	it('says how long anything deleted is kept, in the number it is kept for', () => {
		open({ keptForDays: 30 });

		expect(screen()).toContain('last 30 days');
	});

	it('reads a note with no number by its title alone', () => {
		open({ notes: [{ ...ORIGINS, address: undefined }] });

		expect(screen()).toContain('Origins');
		expect(screen()).not.toContain('1a');
	});

	it('calls a note nobody titled something a person can still act on', () => {
		open({ notes: [{ ...ORIGINS, title: '   ' }] });

		expect(screen()).toContain('Untitled');
	});

	it('puts one back where it was', () => {
		open();

		const control = [...document.body.querySelectorAll('button')].find((one) =>
			one.textContent?.includes('Put it back')
		);
		control?.click();
		flushSync();

		expect(putBack).toEqual([ORIGINS.ref]);
	});

	// An empty bin is a promise kept, not a blank page.
	it('says what an empty one means rather than showing nothing', () => {
		open({ notes: [] });

		expect(screen()).toContain('Nothing here');
		expect(screen()).toContain('30 days before it goes for good');
	});

	it('shows the refusal in its own words where putting one back did not happen', () => {
		open({ says: 'That note could not be put back.' });

		expect(screen()).toContain('That note could not be put back.');
	});

	it('offers no way back where a reader is only visiting', () => {
		open({ onRestore: undefined });

		expect(screen()).toContain('Origins');
		expect(screen()).not.toContain('Put it back');
	});
});
