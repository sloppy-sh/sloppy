// The words a row about an identity this device holds is made of.

import type { IdentityHere } from '@sloppy/local';
import { describe, expect, it } from 'vitest';
import { called, heading, kept, shut } from './held-identity.js';

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

	it('is what the person here calls it, over what a store says', () => {
		expect(called(here({ name: 'Ada', label: 'Thesis' }))).toBe('Thesis');
	});

	it('says where one nobody has named came from', () => {
		expect(called(here())).toBe('the identity on this device');
		expect(called(here({ source: 'sealed', locked: true }))).toBe('the identity you brought here');
		expect(called(here({ source: 'delegated', carriable: false }))).toBe(
			'the identity you signed in with'
		);
	});

	it('never reads a key back to anybody', () => {
		for (const one of [
			here(),
			here({ source: 'sealed', locked: true }),
			here({ source: 'delegated', carriable: false })
		]) {
			expect(called(one)).not.toContain('z6Mk');
			expect(heading(one)).not.toContain('z6Mk');
		}
	});
});

describe('what an identity is called at the head of a row', () => {
	it('starts our own words with a capital', () => {
		expect(heading(here())).toBe('The identity on this device');
	});

	it('spells a name it was given the way it was given', () => {
		expect(heading(here({ label: 'thesis notes' }))).toBe('thesis notes');
		expect(heading(here({ name: 'ada' }))).toBe('ada');
	});

	it('reads the same words inside a line', () => {
		expect(`You'll be writing as ${called(here())}`).toBe(
			"You'll be writing as the identity on this device"
		);
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
