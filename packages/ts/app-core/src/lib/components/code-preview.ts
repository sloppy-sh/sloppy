// Which lines of a file an anchor into code stands for — DESIGN.md § "An
// anchor into code". The lookup itself is `code-run.ts` in `@sloppy/types`,
// shared with what an assistant is handed.

import {
	anchorRun,
	type AnchorRun,
	type CodeAnchor,
	codeLinesOf,
	lineNamed,
	RUN_LINES,
	runOpening
} from '@sloppy/types';
import type { WhyHere } from '../code-provenance.js';

export { type AnchorRun, RUN_LINES };
export const linesOf = codeLinesOf;
export const whereNamed = lineNamed;
export const runOf = anchorRun;

/** How much of a long stretch is shown before the rest is asked for. */
export const PAGE_LINES = 200;

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

/**
 * What the anchor stands for in the file as it is now, up to `pages` pages of
 * it. A run of lines that reaches past the end of the file stops at the end,
 * and a name the file no longer holds shows the file from the top.
 */
export function excerpt(text: string, anchor: CodeAnchor, pages = 1): CodeExcerpt {
	const lines = linesOf(text);
	const total = lines.length;
	const run = runOf(lines, anchor);
	const from =
		run.kind !== 'lines' ? 1 : anchor.fragment?.kind === 'symbol' ? runOpening(run.from) : run.from;
	const stop = run.kind === 'lines' ? run.to : total;

	const end = Math.min(stop, from + PAGE_LINES * Math.max(pages, 1) - 1);
	return {
		from,
		lines: lines.slice(from - 1, end),
		total,
		more: end < stop,
		missing: run.kind === 'missing'
	};
}

/** One note's chip beside the code, and the lines it marks. */
export interface RailChip {
	why: WhyHere;
	run: AnchorRun;
}

/** Where every note reaching a file stands beside the lines shown. */
export interface Rail {
	/** At the head: a note naming the whole file or a folder it is in, a name
	 *  the file no longer holds, or lines outside what is shown. */
	head: RailChip[];
	/** By the line number its run starts on. */
	at: ReadonlyMap<number, RailChip[]>;
	/** Whether a line, numbered from 1, is inside any note's run. */
	marked(line: number): boolean;
}

export function railOf(
	why: readonly WhyHere[],
	path: string,
	lines: readonly string[],
	shown: { from: number; to: number }
): Rail {
	const head: RailChip[] = [];
	const at = new Map<number, RailChip[]>();
	const runs: { from: number; to: number }[] = [];
	for (const one of why) {
		const run: AnchorRun = one.anchor.path === path ? runOf(lines, one.anchor) : { kind: 'whole' };
		const chip = { why: one, run };
		if (run.kind === 'lines') runs.push(run);
		if (run.kind === 'lines' && run.from >= shown.from && run.from <= shown.to) {
			at.set(run.from, [...(at.get(run.from) ?? []), chip]);
		} else {
			head.push(chip);
		}
	}
	return {
		head,
		at,
		marked: (line) => runs.some((run) => line >= run.from && line <= run.to)
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
