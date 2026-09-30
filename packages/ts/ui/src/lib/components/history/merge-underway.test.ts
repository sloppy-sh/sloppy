// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import MergeUnderway, { type NoteInTwo } from './merge-underway.svelte';

const ORIGINS: NoteInTwo = {
	path: 'notes/01ARZ3NDEKTSV4RRFFQ69G5FAV.md',
	title: 'Origins',
	address: '1',
	isNote: true
};

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let chosen: string[];
let finished: number;
let stopped: number;
let stops: boolean;

function open(over: Record<string, unknown> = {}): void {
	mounted = mount(MergeUnderway, {
		target,
		props: {
			taking: 'an-argument',
			notes: [ORIGINS],
			onSettle: (path: string) => chosen.push(path),
			onFinish: () => (finished += 1),
			onStop: async () => {
				stopped += 1;
				return stops;
			},
			...over
		}
	});
	flushSync();
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 4; turn += 1) {
		flushSync();
		await new Promise((done) => setTimeout(done, 0));
	}
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
	chosen = [];
	finished = 0;
	stopped = 0;
	stops = true;
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
});

describe('a line part-way into the one being worked on', () => {
	it('names each note by its title and its number, and never by a path', () => {
		open();

		expect(screen()).toContain('Bringing in an-argument');
		expect(screen()).toContain('Origins');
		expect(screen()).toContain('1');
		expect(screen()).not.toContain('.md');

		control('Origins').click();

		expect(chosen).toEqual([ORIGINS.path]);
	});

	it('counts what is left in two versions, so the work left has a size', () => {
		open({ notes: [ORIGINS, { ...ORIGINS, path: 'notes/01B.md', title: 'A second thought' }] });

		expect(screen()).toContain('2 notes are in two versions');
		expect(screen()).toContain('A second thought');
	});

	it('names something that is not a note without showing what it is called', () => {
		open({ notes: [{ path: 'pictures/a-leaf.png', title: '', isNote: false }] });

		expect(screen()).toContain('Something else your graph keeps for you');
		expect(screen()).not.toContain('a-leaf');
	});

	it('waits on a note it is still reading rather than calling it something else', () => {
		open({ notes: [{ path: ORIGINS.path, title: '' }] });

		expect(screen()).toContain('Reading this one…');
		expect(screen()).not.toContain('Something else your graph keeps for you');
		expect(control('Reading this one').disabled).toBe(true);
	});

	it('offers to keep a version once nothing is left in two versions', () => {
		open({ notes: [] });

		expect(screen()).toContain('Every note is settled');
		expect(screen()).toContain('Keep a version and an-argument is in');

		control('Keep a version').click();

		expect(finished).toBe(1);
	});

	it('asks before it stops, and says what stopping leaves behind', async () => {
		open();

		control('Stop bringing it in').click();
		flushSync();

		expect(screen()).toContain('Stop bringing in an-argument?');
		expect(screen()).toContain('Your graph goes back the way it was before you started');
		expect(stopped).toBe(0);

		control('Stop it').click();
		await settle();

		expect(stopped).toBe(1);
		expect(screen()).not.toContain('Stop bringing in an-argument?');
	});

	it('stays put where somebody changes their mind', async () => {
		open();

		control('Stop bringing it in').click();
		flushSync();
		control('Keep going').click();
		await settle();

		expect(stopped).toBe(0);
		expect(screen()).not.toContain('Your graph goes back the way it was before you started');
	});

	it('holds the question open where stopping did not happen', async () => {
		stops = false;
		open({ says: 'Try that again in a moment.' });

		control('Stop bringing it in').click();
		flushSync();
		control('Stop it').click();
		await new Promise((done) => setTimeout(done, 0));
		flushSync();

		expect(stopped).toBe(1);
		expect(screen()).toContain('Try that again in a moment.');
	});
});
