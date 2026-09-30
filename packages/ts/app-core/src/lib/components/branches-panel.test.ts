// The lines of work a folder holds: the row is how somebody works on one, and
// the two acts beside it stay their own.

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BranchesPanel, { type LineRow } from './branches-panel.svelte';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let workedOn: string[];
let broughtIn: string[];
let dropped: string[];

const line = (over: Partial<LineRow> = {}): LineRow => ({
	name: 'main',
	head: 'c1',
	here: true,
	elsewhere: false,
	...over
});

function show(over: { lines?: LineRow[] } = {}): void {
	mounted = mount(BranchesPanel, {
		target,
		props: {
			lines: over.lines ?? [line()],
			anyVersion: true,
			onStartLine: () => Promise.resolve(true),
			onWorkOn: (name: string) => {
				workedOn.push(name);
				return Promise.resolve(true);
			},
			onBringIn: (name: string) => {
				broughtIn.push(name);
				return Promise.resolve(true);
			},
			onDrop: (name: string) => {
				dropped.push(name);
				return Promise.resolve(true);
			},
			onStartFrom: () => Promise.resolve(true)
		}
	});
	flushSync();
}

const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

function row(name: string): HTMLElement {
	const found = target.querySelector<HTMLElement>(`[data-line="${name}"]`);
	if (!found) throw new Error(`No row for ${name}`);
	return found;
}

function inRow(name: string, labelled: string): HTMLButtonElement {
	const found = [...row(name).querySelectorAll('button')].find(
		(one) => (one.textContent ?? '').replace(/\s+/g, ' ').trim() === labelled
	);
	if (!found) throw new Error(`Nothing in ${name} is labelled "${labelled}"`);
	return found;
}

beforeEach(() => {
	workedOn = [];
	broughtIn = [];
	dropped = [];
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
});

describe('a line of work in the list', () => {
	// The row is the act: somebody who taps the name of a line expects to be
	// working on it, and a row that answers nothing is a row they tap twice.
	it('works on the line when the row itself is tapped', () => {
		show({ lines: [line(), line({ name: 'an-older-thought', head: 'c0', here: false })] });

		inRow('an-older-thought', 'an-older-thought').click();
		flushSync();

		expect(workedOn).toEqual(['an-older-thought']);
	});

	// The two acts stand inside the row and are not it: tapping one must not
	// also move the folder onto the line it was about to merge or let go.
	it('keeps the acts beside the row from working on it as well', () => {
		show({ lines: [line(), line({ name: 'an-older-thought', head: 'c0', here: false })] });

		inRow('an-older-thought', 'Bring it in').click();
		flushSync();
		inRow('an-older-thought', 'Let it go').click();
		flushSync();

		expect(broughtIn).toEqual(['an-older-thought']);
		expect(dropped).toEqual(['an-older-thought']);
		expect(workedOn).toEqual([]);
	});

	// An act that could only be refused is not an act to offer.
	it('offers nothing on the line the folder is already on', () => {
		show({ lines: [line()] });

		expect(row('main').querySelectorAll('button')).toHaveLength(0);
		expect(screen()).toContain('You are working on this one.');
	});

	// Where the folder is on no line, no line may claim it.
	it('lets no row claim the folder while it is on none', () => {
		show({
			lines: [line({ here: false }), line({ name: 'an-older-thought', head: 'c0', here: false })]
		});

		expect(screen()).not.toContain('You are working on this one.');

		inRow('main', 'main').click();
		flushSync();

		expect(workedOn).toEqual(['main']);
	});

	// A row that moves the whole folder has to say so to somebody who cannot see
	// it, beside two smaller acts that already name themselves.
	it('names what tapping a row does', () => {
		show({ lines: [line(), line({ name: 'an-older-thought', head: 'c0', here: false })] });

		expect(inRow('an-older-thought', 'an-older-thought').getAttribute('aria-label')).toBe(
			'Work on an-older-thought'
		);
	});
});
