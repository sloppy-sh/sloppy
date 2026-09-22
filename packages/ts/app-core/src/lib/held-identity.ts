// How an identity this device holds is named and placed, in one place, so no
// two surfaces call the same identity something different.

import type { IdentityHere } from '@sloppy/local';

/** What to call one nobody has named, written to read inside a line so the
 *  same words serve a heading and a sentence. */
const cameFrom: Record<IdentityHere['source'], string> = {
	device: 'the identity on this device',
	sealed: 'the identity you brought here',
	delegated: 'the identity you signed in with'
};

/** The name it has been given: by the person here first, and by the store
 *  keeping it otherwise. Absent where nobody has said. */
export function givenName(one: IdentityHere): string | undefined {
	return one.label ?? one.name;
}

/** What it is called inside a line: the name it has been given, else where it
 *  came from. */
export function called(one: IdentityHere): string {
	return givenName(one) ?? cameFrom[one.source];
}

/** The same at the head of a line. Only our own words are ours to start with a
 *  capital: a name somebody was given is spelled the way it was given. */
export function heading(one: IdentityHere): string {
	const given = givenName(one);
	if (given) return given;
	const words = cameFrom[one.source];
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Where it lives. */
export function kept(one: IdentityHere): string {
	if (one.instance) return one.instance;
	return one.locked ? 'On this device, locked' : 'Made on this device';
}

/** What a row says about one this device holds shut. Absent where nothing
 *  stands between the person and it. */
export function shut(one: IdentityHere): string | undefined {
	return one.locked
		? 'You can write as this one now. Sloppy cannot open it without your passphrase, and a copy you save stays shut the same way.'
		: undefined;
}
