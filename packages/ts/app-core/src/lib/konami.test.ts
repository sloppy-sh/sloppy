import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchForKonami } from './konami.js';

const CODE = [
	'ArrowUp',
	'ArrowUp',
	'ArrowDown',
	'ArrowDown',
	'ArrowLeft',
	'ArrowRight',
	'ArrowLeft',
	'ArrowRight',
	'b',
	'a'
];

let stop: (() => void) | undefined;

afterEach(() => {
	stop?.();
	stop = undefined;
	document.body.innerHTML = '';
});

function watch(): () => number {
	const entered = vi.fn();
	stop = watchForKonami(entered);
	return () => entered.mock.calls.length;
}

function press(key: string, into?: Element, modifier?: 'metaKey' | 'ctrlKey' | 'altKey'): void {
	const event = new KeyboardEvent('keydown', {
		key,
		bubbles: true,
		...(modifier === undefined ? {} : { [modifier]: true })
	});
	(into ?? window).dispatchEvent(event);
}

function enter(keys: readonly string[] = CODE, into?: Element): void {
	for (const key of keys) press(key, into);
}

describe('the code', () => {
	it('answers once it is finished, and again the next time', () => {
		const times = watch();
		enter();
		expect(times()).toBe(1);
		enter();
		expect(times()).toBe(2);
	});

	it('takes the letters whichever case they are typed in', () => {
		const times = watch();
		enter([...CODE.slice(0, 8), 'B', 'A']);
		expect(times()).toBe(1);
	});

	it('begins again on a wrong key', () => {
		const times = watch();
		enter(CODE.slice(0, 6));
		press('x');
		enter(CODE.slice(6));
		expect(times()).toBe(0);
	});

	it('reads a wrong key that begins the code as a start', () => {
		const times = watch();
		enter(['ArrowUp', 'ArrowUp', 'ArrowUp', ...CODE.slice(1)]);
		expect(times()).toBe(1);
	});

	it('is not tripped by what somebody typed into a field or into their writing', () => {
		const times = watch();
		const field = document.createElement('input');
		const writing = document.createElement('div');
		writing.setAttribute('contenteditable', 'true');
		document.body.append(field, writing);

		enter(CODE, field);
		expect(times()).toBe(0);
		enter(CODE, writing);
		expect(times()).toBe(0);
		enter();
		expect(times()).toBe(1);
	});

	it('leaves a chord to whatever binds it', () => {
		const times = watch();
		enter(CODE.slice(0, 4));
		press('ArrowLeft', undefined, 'metaKey');
		enter(CODE.slice(4));
		expect(times()).toBe(1);
	});

	it('hears nothing once it has been stopped', () => {
		const times = watch();
		stop?.();
		enter();
		expect(times()).toBe(0);
	});
});
