import type { OwnedRef } from '@sloppy/types';
import { describe, expect, it } from 'vitest';
import { nodeHref, refFromPath } from './routes.js';

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
