// What an anchor into code reaches the project's files through. `@sloppy/ui`
// reaches no folder, so `NoteCode` is built from these —
// docs/ARCHITECTURE.md § "A project's container".

import { CONTAINER_DIR, digestsIn, type Files } from '@sloppy/local';
import { anchorsOf, type BlockDocument, type UpdateNodeRequest } from '@sloppy/types';
import { readingsNow } from '@sloppy/vault';

const READ_AS_TEXT = new TextDecoder();

/**
 * Folders nobody writes a note about: what a tool builds into or keeps, and the
 * container the notes themselves are in. A listing that walks one offers a
 * person nothing and costs the whole of the wait before the list appears.
 */
const NOT_WRITTEN_BY_HAND = new Set([
	'.git',
	CONTAINER_DIR,
	'.svelte-kit',
	'.turbo',
	'node_modules',
	'target'
]);

/** Every file in the project somebody could be writing about, as paths from its
 *  root. */
export async function filesIn(project: Files): Promise<string[]> {
	const held = await project.list('');
	return held.filter((path) => !path.split('/').some((part) => NOT_WRITTEN_BY_HAND.has(part)));
}

/** What the file says; `undefined` where this checkout has not got it, and
 *  where what is there is not text — a note pointing at a picture is still a
 *  link, and never an error. */
export async function textIn(project: Files, path: string): Promise<string | undefined> {
	const bytes = await project.read(path).catch(() => undefined);
	// What git itself reads as binary, and what nobody would draw as lines.
	return bytes === undefined || bytes.includes(0) ? undefined : READ_AS_TEXT.decode(bytes);
}

/** Where the file is, as an address the platform opens a file from. `root` is
 *  as the platform spells it, which on a system that spells one with `\` is
 *  read the same way a path from it is. */
export function fileAddress(root: string, path: string): string {
	const full = `${root.replace(/\\/g, '/').replace(/\/+$/, '')}/${path}`;
	const spelled = full
		.split('/')
		.map((part) => encodeURIComponent(part))
		.join('/');
	return `file://${spelled.startsWith('/') ? spelled : `/${spelled}`}`;
}

/**
 * What saying a note still holds writes: every place its writing points at, as
 * those files stand NOW, and the version the folder is at where it keeps one.
 *
 * The reading is the WHOLE list, so a place the writing no longer names is one
 * the note is no longer read against. The files are read at the moment of the
 * act rather than when the question was asked — otherwise a save in between
 * would be recorded as read.
 */
export async function readAgainstNow(
	sections: readonly { content: BlockDocument }[],
	project: Files,
	at: string | undefined
): Promise<UpdateNodeRequest> {
	const paths = sections
		.flatMap((section) => anchorsOf(section.content))
		.map((anchor) => anchor.path);
	return {
		read_against: await readingsNow(paths, digestsIn(project)),
		...(at === undefined ? {} : { checked: at })
	};
}
