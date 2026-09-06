// Somebody, as a surface draws them. The design system does not know where the
// API is, so pictures arrive already resolved — `proxied()` in `@sloppy/client`
// is what turns a `ProfileView` address into one of these.

import type { MediaRole } from '@sloppy/types';

export interface Person {
	/** What they chose to be called. Absent falls back to {@link Person.handle}. */
	displayName: string | null;
	/** Without the `@`; the surfaces below add it. */
	handle: string;
	bio: string | null;
	/** Ready for an `<img>`; null where they have not chosen one. */
	avatar: string | null;
	banner: string | null;
}

/** The two pictures a person chooses for themselves. */
export type PictureRole = Extract<MediaRole, 'avatar' | 'banner'>;

export function nameOf(person: Person): string {
	return person.displayName?.trim() || person.handle;
}

/** Somebody nobody could place, drawn as the identifier they travel by. */
export function unplacedPerson(identity: string): Person {
	const key = identity.slice(identity.lastIndexOf(':') + 1);
	return {
		displayName: null,
		handle: key.length > 14 ? `${key.slice(0, 8)}…${key.slice(-4)}` : key,
		bio: null,
		avatar: null,
		banner: null
	};
}

/** Up to two letters, for an avatar with no picture behind it. */
export function initialsOf(person: Person): string {
	const words = nameOf(person).split(/\s+/).filter(Boolean);
	const first = words[0] ?? '';
	const second = words[1];
	return (second ? `${first.slice(0, 1)}${second.slice(0, 1)}` : first.slice(0, 2)).toUpperCase();
}
