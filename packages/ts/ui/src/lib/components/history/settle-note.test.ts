// @vitest-environment jsdom
import type { BlockDocument } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import SettleNote, { type SectionInTwo } from './settle-note.svelte';

function words(said: string): BlockDocument {
	return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: said }] }] };
}

const SECTIONS: SectionInTwo[] = [
	{ ulid: '01A', here: words('The seed of it all'), there: words('The seed of the argument') },
	{ ulid: '01B', here: words('And what grew') }
];

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let whole: string[];
let taken: string[][];

function open(): void {
	mounted = mount(SettleNote, {
		target,
		props: {
			open: true,
			title: 'Origins',
			address: '1',
			line: 'an-argument',
			sections: SECTIONS,
			onKeepHere: async () => {
				whole.push('here');
			},
			onTakeThere: async () => {
				whole.push('there');
			},
			onSettleSections: async (take: ReadonlySet<string>) => {
				taken.push([...take]);
			}
		}
	});
	flushSync();
}

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

function control(labelled: string): HTMLButtonElement {
	const found = [...document.body.querySelectorAll('button')].find((one) =>
		one.textContent?.includes(labelled)
	);
	if (!found) throw new Error(`Nothing on the screen is labelled "${labelled}"`);
	return found;
}

beforeEach(() => {
	stubMediaQuery((query) => query.includes('max-width'));
	stubResizeObserver();
	whole = [];
	taken = [];
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
});

describe('a note two lines of work both wrote in', () => {
	it('is taken whole from one side', () => {
		open();

		control("Take an-argument's").click();

		expect(whole).toEqual(['there']);
	});

	it('shows both versions of each section, and takes the ones chosen', async () => {
		open();

		control('Choose section by section').click();
		flushSync();

		expect(screen()).toContain('The seed of it all');
		expect(screen()).toContain('The seed of the argument');
		expect(screen()).toContain('Not in this one at all.');

		const takeTheirs = [...document.body.querySelectorAll('button')].filter((one) =>
			one.textContent?.includes("Take an-argument's")
		);
		takeTheirs[0].click();
		flushSync();
		control('Settle this note').click();
		await new Promise((done) => setTimeout(done, 0));

		expect(taken).toEqual([['01A']]);
	});
});
