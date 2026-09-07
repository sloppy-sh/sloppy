import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrent = vi.fn<() => Promise<string[] | null>>();
const onOpenUrl = vi.fn<(handler: (urls: string[]) => void) => Promise<void>>();
vi.mock('@tauri-apps/plugin-deep-link', () => ({ getCurrent, onOpenUrl }));

const goto = vi.fn();
vi.mock('$app/navigation', () => ({ goto }));

const assign = vi.fn();
vi.stubGlobal('location', { assign });

const { routeOf, SIGN_IN_CALLBACK } = await import('./deep-link.js');

const CALLBACK = `${SIGN_IN_CALLBACK}?sloppy_code=c&sloppy_state=s`;
const NOTE = 'sloppy://n/did:plc:abc/01J';

/** A fresh document: the module runs again, `sessionStorage` survives. Answers
 *  with the handler the OS hands a live link to. */
async function boot(launchedWith: string[] | null): Promise<(urls: string[]) => void> {
	getCurrent.mockResolvedValue(launchedWith);
	vi.resetModules();
	const { forwardDeepLinks } = await import('./deep-link.js');
	await forwardDeepLinks();
	const handler = onOpenUrl.mock.calls.at(-1)?.[0];
	if (!handler) throw new Error('forwardDeepLinks registered no handler');
	return handler;
}

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

describe('forwardDeepLinks', () => {
	beforeEach(() => {
		sessionStorage.clear();
		assign.mockClear();
		goto.mockClear();
		getCurrent.mockReset();
		onOpenUrl.mockReset();
	});

	it('finishes a sign-in that came back while the app was running, the once', async () => {
		const live = await boot(null);
		live([CALLBACK]);
		await boot([CALLBACK]);
		expect(assign.mock.calls).toEqual([['/?sloppy_code=c&sloppy_state=s']]);
	});

	it('finishes a sign-in the app was launched by, the once', async () => {
		await boot([CALLBACK]);
		await boot([CALLBACK]);
		expect(assign.mock.calls).toEqual([['/?sloppy_code=c&sloppy_state=s']]);
	});

	it('opens a note the app was launched by without leaving the router', async () => {
		await boot([NOTE]);
		expect(goto.mock.calls).toEqual([['/n/did:plc:abc/01J']]);
		expect(assign).not.toHaveBeenCalled();
	});

	it('opens the same note again when somebody taps the link a second time', async () => {
		const live = await boot(null);
		live([NOTE]);
		live([NOTE]);
		expect(goto.mock.calls).toEqual([['/n/did:plc:abc/01J'], ['/n/did:plc:abc/01J']]);
	});

	it('opens a second link the OS delivers after the first', async () => {
		await boot([NOTE]);
		await boot(['sloppy://n/did:plc:abc/01K']);
		expect(goto.mock.calls).toEqual([['/n/did:plc:abc/01J'], ['/n/did:plc:abc/01K']]);
	});

	it('has nothing to open where the app was not launched from a link', async () => {
		await boot(null);
		expect(goto).not.toHaveBeenCalled();
		expect(assign).not.toHaveBeenCalled();
	});
});
