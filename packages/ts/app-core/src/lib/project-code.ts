// What an anchor into code reaches the project's files through. `@sloppy/ui`
// reaches no folder, so `NoteCode` is built from these —
// docs/ARCHITECTURE.md § "A project's container".

import { CONTAINER_DIR, type Files } from '@sloppy/local';

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

/** What the file says; `undefined` where this checkout has not got it. */
export async function textIn(project: Files, path: string): Promise<string | undefined> {
	const bytes = await project.read(path).catch(() => undefined);
	return bytes === undefined ? undefined : READ_AS_TEXT.decode(bytes);
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
