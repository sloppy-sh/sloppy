// Somebody, as a surface draws them. The design system does not know where the
// API is, so pictures arrive already resolved — `proxied()` in `@sloppy/client`
// is what turns a `ProfileView` address into one of these.

import type { MediaRole } from '@sloppy/types';

export interface Person {
	/** What they are followed and cited by. Never a name: it is what tells two
	 *  people nobody could put a name to apart. */
	identity: string;
	/** What they chose to be called. */
	displayName: string | null;
	/** Without the `@`; the surfaces below add it. Absent where nothing anybody
	 *  here holds says what to call them. */
	handle: string | null;
	bio: string | null;
	/** Ready for an `<img>`; null where they have not chosen one. */
	avatar: string | null;
	banner: string | null;
}

/** The two pictures a person chooses for themselves. */
export type PictureRole = Extract<MediaRole, 'avatar' | 'banner'>;

/** What anybody here calls them, or nothing where nobody does. */
function calledBy(person: Person): string | undefined {
	return person.displayName?.trim() || person.handle?.trim() || undefined;
}

export function nameOf(person: Person): string {
	return calledBy(person) ?? 'Somebody';
}

/** Whether anything anybody here holds says what to call them. False is
 *  somebody a surface can only call 'Somebody', and the identity they travel by
 *  is all there is to tell them from the next person. */
export function isNamed(person: Person): boolean {
	return calledBy(person) !== undefined;
}

/** What to call somebody a surface has no profile for yet. */
export function nameOr(person: Person | null | undefined): string {
	return person ? nameOf(person) : 'Somebody';
}

/** Somebody a surface has to draw before anybody could say who they are. */
export function unnamedPerson(identity: string): Person {
	return {
		identity,
		displayName: null,
		handle: null,
		bio: null,
		avatar: null,
		banner: null
	};
}

/** Up to two letters, for an avatar with no picture behind it. Somebody nobody
 *  could name ends in the letters their identity ends in, so two of them are
 *  never the same monogram. */
export function initialsOf(person: Person): string {
	const called = calledBy(person);
	if (!called) return person.identity.slice(-2).toUpperCase();
	const words = called.split(/\s+/).filter(Boolean);
	const first = words[0] ?? '';
	const second = words[1];
	return (second ? `${first.slice(0, 1)}${second.slice(0, 1)}` : first.slice(0, 2)).toUpperCase();
}
