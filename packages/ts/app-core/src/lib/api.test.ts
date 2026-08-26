import { describe, expect, it } from 'vitest';
import type { SloppyApi } from './api.js';

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
