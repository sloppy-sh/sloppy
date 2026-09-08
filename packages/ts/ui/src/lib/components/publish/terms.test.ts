import type { Address, OwnedRef } from '@sloppy/types';
import { describe, expect, it } from 'vitest';
import {
	alreadyCarried,
	branchesCarrying,
	namedBranches,
	narrowerSays,
	type PublishSubject,
	publishingAgain,
	publishingSays
} from './terms.js';

const DID = 'did:syr:z6MkAdaAdaAdaAdaAdaAdaAdaAdaAdaAda';

const branch = (seed: number, address?: string) => ({
	ref: `${DID}/${String(seed).padStart(26, '0')}` as OwnedRef,
	...(address === undefined ? {} : { root_address: address as Address })
});

const said = (of: PublishSubject) => publishingSays(of, true).join(' ');

describe('what a publish sends out', () => {
	it('names the graph one branch is read in', () => {
		expect(said({ branch: '1a' })).toContain(
			'The name you gave the graph it sits in goes out too.'
		);
	});

	it('names the graph each of several notes is read in, however many graphs that is', () => {
		expect(said({ notes: 4 })).toContain(
			'The name you gave the graph each of them sits in goes out too.'
		);
	});

	it('calls a branch whatever its author cites it by', () => {
		expect(said({ branch: '1a' })).toContain('Everything under 1a goes out');
		expect(said({ branch: 'this branch' })).toContain('Everything under this branch goes out');
	});

	it('says a second publish sends the same branch by the same name', () => {
		expect(publishingAgain({ branch: 'this branch' })).toBe(
			'Publishing again sends this branch as it stands now. Every version before it stays readable.'
		);
	});
});

describe('the branches a person is told about', () => {
	it('names each one its author numbered, once', () => {
		expect(namedBranches([branch(1, '1a'), branch(2, '1a'), branch(3, '2')])).toEqual([
			{ address: '1a' },
			{ address: '2' }
		]);
	});

	// None of them can be cited apart from the rest, so how many there are is
	// the whole of what can be said.
	it('gathers the ones nobody numbered into one', () => {
		expect(namedBranches([branch(1, '1a'), branch(2), branch(3)])).toEqual([
			{ address: '1a' },
			{ unnumbered: 2 }
		]);
	});

	it('counts the notes each branch above carries', () => {
		expect(branchesCarrying([branch(1, '1a'), branch(1, '1a'), branch(2), branch(3)])).toEqual([
			{ branch: { address: '1a' }, notes: 2 },
			{ branch: { unnumbered: 2 }, notes: 2 }
		]);
	});

	it('says in words what carries a branch where nobody numbered it', () => {
		expect(alreadyCarried({ branch: 'this branch' }, { address: '1a' })).toBe(
			'1a already carries this branch, on its own terms.'
		);
		expect(alreadyCarried({ branch: 'this branch' }, { unnumbered: 1 })).toBe(
			'A branch you never numbered already carries this branch, on its own terms.'
		);
		expect(alreadyCarried({ notes: 3 }, { unnumbered: 2 })).toBe(
			'2 branches you never numbered already carry notes you chose, on their own terms.'
		);
	});

	it('warns about narrower branches whether or not they can be cited', () => {
		expect(narrowerSays({ address: '1a' }, 'going')).toBe(
			'1a is published inviting fewer people to answer. What you publish here carries it on these terms.'
		);
		expect(narrowerSays({ unnumbered: 1 }, 'going')).toBe(
			'A branch you never numbered is published inviting fewer people to answer. What you publish here carries it on these terms.'
		);
		expect(narrowerSays({ unnumbered: 3 }, 'already')).toBe(
			'3 branches you never numbered are published inviting fewer people to answer. What is published here carries them on these terms.'
		);
	});
});
