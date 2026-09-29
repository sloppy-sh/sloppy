// Which lines of a file an anchor into code stands for — DESIGN.md § "An
// anchor into code".

import type { CodeAnchor } from '@sloppy/types';

/** How much of a long stretch is shown before the rest is asked for. */
export const PAGE_LINES = 200;
/** How much of the file is shown around a name found in it. */
export const RUN_LINES = 40;
/** How much of the run stands above the line the name is on. */
const LEAD = 2;

export interface CodeExcerpt {
	/** What the first line shown is numbered, from 1. */
	from: number;
	lines: string[];
	/** How many lines the file holds. */
	total: number;
	/** Whether the stretch this anchor names goes on past what is shown. */
	more: boolean;
	/** Whether a name was asked for that the file no longer holds. */
	missing: boolean;
}

/** The file's lines, with the newline every file ends with left off the end so
 *  the count is the one an editor shows. */
export function linesOf(text: string): string[] {
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
	return lines;
}

/** Which line a name is on, from 1; absent where the file no longer holds it.
 *  Nothing parses the file, so two things of one name resolve to the first. */
export function whereNamed(lines: readonly string[], name: string): number | undefined {
	const word = new RegExp(`(?:^|[^A-Za-z0-9_$])${escaped(name)}(?![A-Za-z0-9_$])`);
	const alone = lines.findIndex((line) => word.test(line));
	if (alone !== -1) return alone + 1;
	const anywhere = lines.findIndex((line) => line.includes(name));
	return anywhere === -1 ? undefined : anywhere + 1;
}

function escaped(name: string): string {
	return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * What the anchor stands for in the file as it is now, up to `pages` pages of
 * it. A run of lines that reaches past the end of the file stops at the end,
 * and a name the file no longer holds shows the file from the top.
 */
export function excerpt(text: string, anchor: CodeAnchor, pages = 1): CodeExcerpt {
	const lines = linesOf(text);
	const total = lines.length;
	const held = anchor.fragment;
	const named = held?.kind === 'symbol' ? whereNamed(lines, held.name) : undefined;
	const missing = held?.kind === 'symbol' && named === undefined;

	const from =
		held === undefined || missing
			? 1
			: held.kind === 'symbol'
				? Math.max(1, (named as number) - LEAD)
				: Math.min(Math.max(held.from, 1), total);
	const stop =
		held === undefined || missing
			? total
			: held.kind === 'symbol'
				? Math.min(total, from + RUN_LINES - 1)
				: Math.min(held.to, total);

	const end = Math.min(stop, from + PAGE_LINES * Math.max(pages, 1) - 1);
	return {
		from,
		lines: lines.slice(from - 1, end),
		total,
		more: end < stop,
		missing
	};
}

/** What of the file the anchor names, for a reader; absent where it names the
 *  whole of it. */
export function fragmentSays(anchor: CodeAnchor): string | undefined {
	const held = anchor.fragment;
	if (held === undefined) return undefined;
	if (held.kind === 'symbol') return held.name;
	return held.from === held.to ? `Line ${held.from}` : `Lines ${held.from} to ${held.to}`;
}

/** One thing directly inside a folder. */
export interface FolderEntry {
	name: string;
	/** From the project's root. */
	path: string;
	folder: boolean;
}

/** What stands directly inside `folder`, folders first and each side in name
 *  order, read off every file under it. */
export function childrenOf(folder: string, files: readonly string[]): FolderEntry[] {
	const prefix = folder === '' ? '' : `${folder}/`;
	const seen = new Map<string, FolderEntry>();
	for (const file of files) {
		if (!file.startsWith(prefix)) continue;
		const rest = file.slice(prefix.length);
		const slash = rest.indexOf('/');
		const name = slash === -1 ? rest : rest.slice(0, slash);
		if (name === '' || seen.has(name)) continue;
		seen.set(name, { name, path: `${prefix}${name}`, folder: slash !== -1 });
	}
	return [...seen.values()].sort(
		(a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name)
	);
}
