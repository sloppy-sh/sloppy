// How an identity this device holds is named and placed, in one place, so no
// two surfaces call the same identity something different.

import type { IdentityHere } from '@sloppy/local';
import { unplacedPerson } from '@sloppy/ui';

/** What the store keeping it calls them, falling back to what its identifier
 *  reads as where nothing says. */
export function called(one: IdentityHere): string {
	return one.name ?? unplacedPerson(one.did).handle;
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
		? 'You can write as this one now. Your passphrase is asked only if you save a copy to move it.'
		: undefined;
}
