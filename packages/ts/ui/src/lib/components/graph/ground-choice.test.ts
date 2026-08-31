// @vitest-environment jsdom
import type { GraphGround } from '@sloppy/graph';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import GroundChoice from './ground-choice.svelte';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let chosen: GraphGround[];

function open(value: GraphGround = 'dots') {
	chosen = [];
	mounted = mount(GroundChoice, {
		target,
		props: { value, onchange: (ground: GraphGround) => chosen.push(ground) }
	});
	flushSync();
	target.querySelector('button')?.click();
	flushSync();
}

const rows = () => [...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];

beforeEach(() => {
	stubResizeObserver();
	stubMediaQuery(() => false);
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
});

describe('choosing the ground', () => {
	it('offers every ground, with the one in use marked', () => {
		open('lines');

		expect(rows().map((row) => row.textContent?.trim())).toEqual(['Plain', 'Dots', 'Lines']);
		expect(rows().map((row) => row.getAttribute('aria-checked'))).toEqual([
			'false',
			'false',
			'true'
		]);
	});

	it('hands back the one that was picked', () => {
		open('dots');
		rows()[0].click();
		flushSync();

		expect(chosen).toEqual(['none']);
	});

	// DESIGN.md § Layout: the graph's chrome is thumb-sized, and this control is
	// on the phone as much as on the desk.
	it('offers rows a thumb can land on', () => {
		open();
		expect(target.querySelector('button')?.className).toContain('size-9');
		for (const row of rows()) expect(row.className).toContain('min-h-11');
	});
});
