import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrent = vi.fn<() => Promise<string[] | null>>();
vi.mock('@tauri-apps/plugin-deep-link', () => ({
	getCurrent,
	onOpenUrl: vi.fn()
}));

const { launchLinks, routeOf, SIGN_IN_CALLBACK } = await import('./deep-link.js');

describe('routeOf', () => {
	it('puts back the segment a schemeless URL parsed as a host', () => {
		expect(routeOf('sloppy://n/did:plc:abc/01J/')).toBe('/n/did:plc:abc/01J');
	});

	it('reads a web link as the path it already is', () => {
		expect(routeOf('https://sloppy.sh/n/did:plc:abc/01J')).toBe('/n/did:plc:abc/01J');
	});

	it('lands the sign-in callback on the root with the hand-off intact', () => {
		expect(routeOf(`${SIGN_IN_CALLBACK}?sloppy_code=c&sloppy_state=s`)).toBe(
			'/?sloppy_code=c&sloppy_state=s'
		);
	});

	it('answers nothing for what is not a URL', () => {
		expect(routeOf('not a url')).toBeUndefined();
	});
});

describe('launchLinks', () => {
	beforeEach(() => {
		sessionStorage.clear();
		getCurrent.mockReset();
	});

	it('answers a launch link once, however often it is asked', async () => {
		const callback = `${SIGN_IN_CALLBACK}?sloppy_code=c&sloppy_state=s`;
		getCurrent.mockResolvedValue([callback]);
		await expect(launchLinks()).resolves.toEqual([callback]);
		await expect(launchLinks()).resolves.toEqual([]);
	});

	it('answers a second link the OS delivers after the first', async () => {
		getCurrent.mockResolvedValue(['sloppy://n/did:plc:abc/01J']);
		await launchLinks();
		getCurrent.mockResolvedValue(['sloppy://n/did:plc:abc/01K']);
		await expect(launchLinks()).resolves.toEqual(['sloppy://n/did:plc:abc/01K']);
	});

	it('has nothing to answer where the app was not launched from a link', async () => {
		getCurrent.mockResolvedValue(null);
		await expect(launchLinks()).resolves.toEqual([]);
	});
});
