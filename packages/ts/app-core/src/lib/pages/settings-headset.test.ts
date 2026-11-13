import type { ServeReach, Serving } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initRuntime, type ServeAccess } from '../runtime.js';
import { SERVED_ELSEWHERE, serving } from '../stores/serving.svelte.js';
import HeadsetSettings from './settings-headset.svelte';

const SERVING: Serving = {
	id: 'desk-id',
	ticket: 'endpointaddressofthedesk',
	name: 'The study',
	reach: 'local',
	paired: [
		{ id: 'quest', name: 'Quest', paired_at: Date.UTC(2026, 10, 1) },
		{ id: 'quiet', paired_at: Date.UTC(2026, 10, 2) }
	],
	connections: 2
};

function desk() {
	const asked: { reach: ServeReach; relay?: string }[] = [];
	let held: Serving | undefined;
	let stopped = 0;
	const access: ServeAccess = {
		pair: async () => {
			if (!held) throw new Error('Turn on Serve to a headset first, then pair one.');
			held = { ...held, pairing: { code: '042917', until: Date.now() + 120_000 } };
			return held;
		},
		start: async (reach, relay) => {
			asked.push(relay === undefined ? { reach } : { reach, relay });
			held = { ...SERVING, reach, ...(relay === undefined ? {} : { relay }) };
			return held;
		},
		stop: async () => {
			stopped++;
			held = undefined;
		},
		status: async () => held,
		forget: async (id) => {
			if (held) held = { ...held, paired: held.paired.filter((one) => one.id !== id) };
		},
		calls: () => () => {},
		answer: async () => {},
		notify: async () => {},
		closed: () => () => {}
	};
	return {
		access,
		asked,
		stopped: () => stopped,
		spend: () => {
			if (held) held = { ...held, pairing: undefined };
		}
	};
}

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

async function settle(): Promise<void> {
	for (let turn = 0; turn < 8; turn += 1) {
		await new Promise((done) => setTimeout(done, 0));
		flushSync();
	}
}

function button(named: string): HTMLButtonElement {
	const found = [...target.querySelectorAll('button')].find(
		(one) => one.textContent?.trim() === named || one.getAttribute('aria-label') === named
	);
	if (!found) throw new Error(`No "${named}" button on screen`);
	return found;
}

function show(access?: ServeAccess): void {
	initRuntime({ apiHost: () => 'http://api.test', serve: access });
	mounted = mount(HeadsetSettings, { target });
	flushSync();
}

async function turnOn(): Promise<void> {
	target.querySelector<HTMLButtonElement>('#serve-on')?.click();
	await settle();
}

function pickReach(reach: ServeReach): void {
	const radio = target.querySelector<HTMLInputElement>(
		`input[name="serve-reach"][value="${reach}"]`
	);
	if (!radio) throw new Error(`No ${reach} choice`);
	radio.click();
}

beforeEach(() => {
	localStorage.clear();
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(async () => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	await serving.stop();
	initRuntime({ apiHost: () => 'http://api.test', serve: undefined });
	localStorage.clear();
	target.remove();
});

describe('serving to a headset from Settings', () => {
	it('says where serving is done, where this platform cannot serve', () => {
		show(undefined);

		expect(target.textContent).toContain(SERVED_ELSEWHERE);
		expect(target.querySelector('#serve-on')).toBeNull();
	});

	it('is off until turned on, then shows who is reading and who has paired, and no code', async () => {
		const listening = desk();
		show(listening.access);
		expect(target.textContent).toContain('Nothing here can be read from a headset');
		expect(target.textContent).not.toContain('Pair a headset');

		await turnOn();

		expect(listening.asked).toEqual([{ reach: 'local' }]);
		expect(target.textContent).not.toContain('0 4 2 9 1 7');
		expect(target.textContent).toContain('needs a code, once');
		expect(target.textContent).toContain('It finds this desk as The study.');
		expect(target.textContent).toContain('2 headsets are reading now');
		expect(target.textContent).toContain('Quest');
		expect(target.textContent).toContain('A headset');
		expect(target.querySelector('svg[role="img"]')).toBeNull();
	});

	it('shows a code with its time left once asked, until the desk shows none', async () => {
		const listening = desk();
		vi.useFakeTimers({ toFake: ['setInterval'] });
		try {
			show(listening.access);
			await turnOn();

			button('Pair a headset').click();
			await settle();
			expect(target.textContent).toContain('0 4 2 9 1 7');
			expect(target.textContent).toMatch(/[12]:\d\d left/);
			expect(target.textContent).toContain('It finds this desk as The study.');

			listening.spend();
			vi.advanceTimersByTime(1000);
			await settle();
			expect(target.textContent).not.toContain('0 4 2 9 1 7');
			expect(target.textContent).toContain('needs a code, once');
		} finally {
			vi.useRealTimers();
		}
	});

	it('forgets a paired headset', async () => {
		show(desk().access);
		await turnOn();

		button('Forget Quest').click();
		await settle();

		expect(target.textContent).not.toContain('Quest');
	});

	it('serves anywhere at once where it is chosen, through the relay named, with the code to scan', async () => {
		const listening = desk();
		show(listening.access);
		await turnOn();

		pickReach('anywhere');
		await settle();
		expect(listening.asked.at(-1)).toEqual({ reach: 'anywhere' });
		expect(target.querySelector('svg[role="img"] path')?.getAttribute('d')).toMatch(/^M\d/);
		expect(button(SERVING.ticket)).toBeTruthy();

		const relay = target.querySelector<HTMLInputElement>('#serve-relay');
		if (!relay) throw new Error('No relay field');
		relay.value = 'relay.example.com';
		relay.dispatchEvent(new Event('input'));
		button('Use this').click();
		await settle();

		expect(listening.asked.at(-1)).toEqual({
			reach: 'anywhere',
			relay: 'https://relay.example.com/'
		});
		expect(serving.choice).toEqual({
			reach: 'anywhere',
			relay: 'https://relay.example.com/',
			on: true
		});
	});

	it('refuses a relay that is not a web address, and serves on as it was', async () => {
		const listening = desk();
		localStorage.setItem('sloppy_serve', '{"reach":"anywhere"}');
		show(listening.access);
		await turnOn();

		const relay = target.querySelector<HTMLInputElement>('#serve-relay');
		if (!relay) throw new Error('No relay field');
		relay.value = 'ftp://relay.example.com';
		relay.dispatchEvent(new Event('input'));
		button('Use this').click();
		await settle();

		expect(target.querySelector('[role="alert"]')?.textContent).toContain('web address');
		expect(listening.asked).toEqual([{ reach: 'anywhere' }]);
	});

	it('stops when turned off', async () => {
		const listening = desk();
		show(listening.access);
		await turnOn();

		await turnOn();

		expect(listening.stopped()).toBe(1);
		expect(serving.serving).toBeUndefined();
		expect(target.textContent).not.toContain('Pair a headset');
	});

	it('says it stays on while it is on', async () => {
		show(desk().access);
		expect(target.textContent).not.toContain('Stays on when Sloppy opens again.');

		await turnOn();
		expect(target.textContent).toContain('Stays on when Sloppy opens again.');

		await turnOn();
		expect(target.textContent).not.toContain('Stays on when Sloppy opens again.');
	});

	it('says why serving left on did not start again, until the switch is turned', async () => {
		localStorage.setItem('sloppy_serve', '{"reach":"local","on":true}');
		let refuse = true;
		const listening = desk();
		show({
			...listening.access,
			start: async (reach, relay) => {
				if (refuse) throw new Error('Serving could not start here. Try again.');
				return listening.access.start(reach, relay);
			}
		});
		await serving.resume();
		await settle();
		expect(target.querySelector('[role="alert"]')?.textContent).toBe(
			'Serving could not start here. Try again.'
		);

		refuse = false;
		await turnOn();
		expect(target.querySelector('[role="alert"]')).toBeNull();
		expect(target.textContent).toContain('Stays on when Sloppy opens again.');
	});

	it('says what went wrong where serving could not start', async () => {
		show({
			...desk().access,
			start: async () => {
				throw new Error('Serving could not start here. Try again.');
			}
		});

		await turnOn();

		expect(target.querySelector('[role="alert"]')?.textContent).toBe(
			'Serving could not start here. Try again.'
		);
		expect(target.querySelector('#serve-on')?.getAttribute('aria-checked')).toBe('false');
	});
});
