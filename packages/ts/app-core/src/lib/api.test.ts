import { afterEach, describe, expect, it } from 'vitest';
import { api, type SloppyApi } from './api.js';
import { initRuntime, repointRuntime, runtime } from './runtime.js';
import { prefs } from './stores/prefs.svelte.js';

/** True only where an object carrying just the public members satisfies the
 *  port. A nominal alias to the client class makes it false: the class's
 *  private members are part of its emitted type, so the native shell's
 *  `createApi` adapter could only reach the port through a cast. */
type PortIsStructural = { [K in keyof SloppyApi]: SloppyApi[K] } extends SloppyApi ? true : false;

describe('the api port', () => {
	it('is satisfied by shape, so an on-device adapter needs no cast', () => {
		const structural: PortIsStructural = true;
		expect(structural).toBe(true);
	});
});

const asked: string[] = [];

function answering(): typeof fetch {
	return ((input: RequestInfo | URL) => {
		asked.push(String(input));
		return Promise.resolve(new Response('', { status: 200 }));
	}) as typeof fetch;
}

afterEach(() => {
	asked.length = 0;
	localStorage.clear();
});

describe('the Sloppy the app talks to', () => {
	it('follows the one somebody points this device at, without a new client', async () => {
		initRuntime({ apiHost: () => 'https://shipped.example', fetchImpl: answering });
		await api.me();

		prefs.set('origin', 'https://mine.example');
		repointRuntime();
		await api.me();

		expect(asked).toEqual([
			'https://shipped.example/api/auth/me',
			'https://mine.example/api/auth/me'
		]);
	});

	it('opens at the one this device was already pointed at', async () => {
		prefs.set('origin', 'https://mine.example');
		initRuntime({ apiHost: () => 'https://shipped.example', fetchImpl: answering });

		expect(runtime.apiHost()).toBe('https://mine.example');
		await api.me();
		expect(asked).toEqual(['https://mine.example/api/auth/me']);
	});

	it('goes back to the one the app came with', async () => {
		prefs.set('origin', 'https://mine.example');
		initRuntime({ apiHost: () => 'https://shipped.example', fetchImpl: answering });

		prefs.set('origin', null);
		repointRuntime();
		await api.me();

		expect(asked).toEqual(['https://shipped.example/api/auth/me']);
	});
});
