import { describe, expect, it } from 'vitest';
import { initRuntime, runtime } from './runtime.js';

// The absence of an optional member is what a shell chooses with, so what is
// absent has to stay absent through a merge that names something else.
describe('the platform seam', () => {
	it('answers nothing for what no shell has filled in', () => {
		initRuntime({ apiHost: () => '' });
		expect(runtime.signInRedirect()).toBeUndefined();
		expect(runtime.openExternal()).toBeUndefined();
	});

	it('hands over the return address a shell names for itself', () => {
		initRuntime({ apiHost: () => '', signInRedirect: () => 'sloppy://auth/callback' });
		expect(runtime.signInRedirect()).toBe('sloppy://auth/callback');
	});

	it('keeps it through a re-point at another server', () => {
		initRuntime({ apiHost: () => '', signInRedirect: () => 'sloppy://auth/callback' });
		initRuntime({ apiHost: () => 'https://elsewhere.test' });
		expect(runtime.apiHost()).toBe('https://elsewhere.test');
		expect(runtime.signInRedirect()).toBe('sloppy://auth/callback');
	});
});
