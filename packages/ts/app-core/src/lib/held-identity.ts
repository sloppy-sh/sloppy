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
	return one.instance ?? 'Made on this device';
}
