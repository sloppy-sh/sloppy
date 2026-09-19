// The words a row about an identity this device holds is made of.

import type { IdentityHere } from '@sloppy/local';
import { describe, expect, it } from 'vitest';
import { called, kept, shut } from './held-identity.js';

function here(said: Partial<IdentityHere> = {}): IdentityHere {
	return {
		did: 'did:syr:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
		source: 'device',
		locked: false,
		lapsed: false,
		writing: true,
		carriable: true,
		...said
	};
}

describe('what an identity this device holds is called', () => {
	it('is what the store keeping it says', () => {
		expect(called(here({ name: 'Ada' }))).toBe('Ada');
	});

	it('falls back to something short enough to tell two apart', () => {
		expect(called(here())).toBe('z6MkhaXg…2doK');
	});
});

describe('where an identity this device holds is kept', () => {
	it('is the store keeping it, where one does', () => {
		expect(kept(here({ source: 'delegated', instance: 'keys.example' }))).toBe('keys.example');
	});

	it('is this device, for one made here', () => {
		expect(kept(here())).toBe('Made on this device');
	});

	it('says a brought-in one is locked rather than made here', () => {
		expect(kept(here({ source: 'sealed', locked: true }))).toBe('On this device, locked');
	});
});

describe('what a row says about a locked identity', () => {
	it('says what can be done now and what will be asked later', () => {
		const said = shut(here({ source: 'sealed', locked: true }));

		expect(said).toContain('write as this one now');
		expect(said).toContain('passphrase');
	});

	it('says nothing where nothing stands in the way', () => {
		expect(shut(here())).toBeUndefined();
		expect(shut(here({ source: 'delegated', carriable: false }))).toBeUndefined();
	});
});
