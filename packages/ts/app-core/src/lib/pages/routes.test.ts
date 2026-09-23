import type { OwnedRef } from '@sloppy/types';
import type { Person } from '@sloppy/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initRuntime } from '../runtime.js';
import {
	activeRouteId,
	APP_ROUTES,
	citationUrl,
	isOpenRoute,
	navRoutes,
	nodeHref,
	OPEN_ROUTES,
	refFromPath
} from './routes.js';

const REF = 'did:syr:z6MkwSiAvviKsS8dvXsScr4ipdeZwusLQY92cWWBisnvpJLc/01JQ0R2S3T4U5V6W7X8Y9ZABC';

describe('nodeHref / refFromPath', () => {
	it('round-trips a reference whose did carries the colons', () => {
		expect(refFromPath(nodeHref(REF as OwnedRef))).toBe(REF);
	});

	it('leaves the colons encoded, so neither half can be read as a path segment', () => {
		expect(nodeHref(REF as OwnedRef)).not.toContain(':');
	});

	it.each(['/', '/settings', '/sign-in', '/n', '/n/did', '/n/did/ulid/extra', '/n//ulid'])(
		'reads no note out of %s',
		(path) => {
			expect(refFromPath(path)).toBeNull();
		}
	);
});

describe('activeRouteId', () => {
	it.each([
		['/', 'graph'],
		['/settings/anything-under-it', 'settings'],
		['/nowhere', 'graph'],
		[nodeHref(REF as OwnedRef), 'graph']
	])('reads %s as %s', (path, id) => {
		expect(activeRouteId(path)).toBe(id);
	});

	it('names its own route for every entry the nav shows', () => {
		for (const route of APP_ROUTES) {
			expect(activeRouteId(route.href)).toBe(route.id);
		}
	});
});

describe('isOpenRoute', () => {
	it('stands every route that needs no account, the cited note among them', () => {
		for (const route of OPEN_ROUTES) expect(isOpenRoute(route)).toBe(true);
		expect(isOpenRoute(nodeHref(REF as OwnedRef))).toBe(true);
	});

	it.each(['/', '/profile', '/new', '/n', '/n/did', '/n/did/ulid/extra'])(
		'keeps %s behind an account',
		(path) => {
			expect(isOpenRoute(path)).toBe(false);
		}
	);
});

describe('navRoutes', () => {
	const ADA: Person = {
		identity: 'did:syr:z6MkAdaAdaAdaAdaAdaAdaAdaAdaAdaAda',
		displayName: 'Ada Lovelace',
		handle: 'ada',
		bio: null,
		avatar: '/api/proxy?ref=avatar',
		banner: null
	};

	it('puts the person on their own destination and on no other', () => {
		const shown = navRoutes(ADA);
		expect(shown.find((route) => route.id === 'profile')?.person).toBe(ADA);
		expect(shown.filter((route) => route.person).length).toBe(1);
	});

	it('leaves the destinations alone until somebody is signed in', () => {
		expect(navRoutes(null)).toEqual(APP_ROUTES);
		expect(APP_ROUTES.some((route) => route.person)).toBe(false);
	});
});

describe('citationUrl', () => {
	afterEach(() => {
		initRuntime({ apiHost: () => '', webOrigin: () => undefined });
		vi.unstubAllGlobals();
	});

	it('is absolute on the origin the shell names', () => {
		initRuntime({ apiHost: () => '', webOrigin: () => 'https://sloppy.sh' });

		expect(citationUrl(REF as OwnedRef)).toBe(`https://sloppy.sh${nodeHref(REF as OwnedRef)}`);
	});

	it("stands on the page's own origin where the shell names none", () => {
		expect(citationUrl(REF as OwnedRef)).toBe(
			`${globalThis.location.origin}${nodeHref(REF as OwnedRef)}`
		);
	});

	// A shell inside a webview is served from a scheme nobody can open, so what
	// it hands over is the link the app itself answers to.
	it('falls back to the app own scheme where no origin a peer could open is known', () => {
		vi.stubGlobal('location', { origin: 'tauri://localhost' });

		const url = citationUrl(REF as OwnedRef);

		expect(url.startsWith('sloppy://n/')).toBe(true);
		expect(refFromPath(url.replace('sloppy://n', '/n'))).toBe(REF);
	});
});
