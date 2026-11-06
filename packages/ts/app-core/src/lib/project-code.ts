// What an anchor into code reaches the project's files through. `@sloppy/ui`
// reaches no folder, so `NoteCode` is built from these —
// docs/ARCHITECTURE.md § "A project's container".

import { CONTAINER_DIR, digestsIn, type Files, foundElsewhereIn } from '@sloppy/local';
import {
	anchorRun,
	anchorsOf,
	type BlockDocument,
	type CodeAnchor,
	type CodeSnippet,
	codeLinesOf,
	SNIPPET_LINES_MAX,
	type SnippetPlace,
	type SnippetState,
	type UpdateNodeRequest
} from '@sloppy/types';
import { quoteOf, readingsNow, snippetState } from '@sloppy/vault';

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
export function filesIn(project: Files): Promise<string[]> {
	return filesUnder(project, '');
}

/** Every such file under one folder, as paths from the project's root; empty
 *  where nothing is there. */
export async function filesUnder(project: Files, path: string): Promise<string[]> {
	const held = await project.list(path).catch(() => []);
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

/**
 * The lines an anchor names, quoted as the file has them now: a run of lines,
 * or the run a name opens — never more than a quote holds. `undefined` where
 * the file is not there, is not text, or no longer holds the name.
 */
export async function quoteAt(
	project: Files,
	anchor: CodeAnchor
): Promise<CodeSnippet | undefined> {
	const text = await textIn(project, anchor.path);
	if (text === undefined) return undefined;
	const lines = codeLinesOf(text);
	const run = anchorRun(lines, anchor);
	if (run.kind === 'missing') return undefined;
	const from = run.kind === 'whole' ? 1 : run.from;
	const to = run.kind === 'whole' ? lines.length : run.to;
	return quoteOf(text, {
		path: anchor.path,
		from,
		to: Math.min(to, from + SNIPPET_LINES_MAX - 1)
	});
}

/** The lines at `place` quoted again as the file has them now. */
export async function requoteAt(
	project: Files,
	place: SnippetPlace,
	language?: string
): Promise<CodeSnippet | undefined> {
	const text = await textIn(project, place.path);
	return text === undefined ? undefined : quoteOf(text, place, language);
}

/** Where the code under a quote stands in the project as it is now. */
export async function quoteStanding(project: Files, snippet: CodeSnippet): Promise<SnippetState> {
	return snippetState(snippet, await textIn(project, snippet.path), foundElsewhereIn(project));
}
