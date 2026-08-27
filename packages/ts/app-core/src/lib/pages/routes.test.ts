import type { OwnedRef } from '@sloppy/types';
import type { Person } from '@sloppy/ui';
import { describe, expect, it } from 'vitest';
import { activeRouteId, APP_ROUTES, navRoutes, nodeHref, refFromPath } from './routes.js';

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
		['/labels/domain', 'labels'],
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

describe('navRoutes', () => {
	const ADA: Person = {
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
