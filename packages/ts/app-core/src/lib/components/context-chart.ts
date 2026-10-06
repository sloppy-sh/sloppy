/**
 * The bar under the chat saying how full the assistant's context is, read out
 * of what the assistant itself reports — DESIGN.md § "The context as a bar".
 */

import { heldAsideIn, type ContextUsage, usedIn } from '@sloppy/types';
import { tokensSaid } from '../chat-said.js';

/** The slots a part the assistant named borrows, the same eight a lane takes
 *  and a selected tag lends (DESIGN.md § "The history as a picture"). A ninth
 *  part wraps onto the first. */
export const HUES = [
	'text-facet-1',
	'text-facet-2',
	'text-facet-3',
	'text-facet-4',
	'text-facet-5',
	'text-facet-6',
	'text-facet-7',
	'text-facet-8'
];

/** The fill the assistant has not broken down: what arrived since it last said
 *  what was in the window, and the whole of it before it has said once. */
export const NOT_LISTED = 'Not yet listed';

/** One band of the bar. */
export interface ContextBand {
	name: string;
	tokens: number;
	/** Absent on a band drawn in ink rather than given a slot of the eight: the
	 *  fill the assistant has not broken down, and the room it keeps back. */
	hue?: string;
}

/** The bar as it is drawn: how far it fills, in what bands, against what. */
export interface ContextBar {
	limit: number;
	/** Where the fill reaches — what the assistant says is in the window, never
	 *  under what its own bands already account for. */
	filled: number;
	bands: ContextBand[];
	/** Room the assistant keeps back for its answer. */
	kept: ContextBand[];
	heldAside: number;
	compactsAt?: number;
	compactedFrom?: number;
}

/** What the assistant is holding, as the bar draws it. Nothing here is counted
 *  twice. */
export function barOf(usage: ContextUsage): ContextBar {
	const parts = usage.parts.filter((part) => part.kind === 'used');
	const counted = usedIn(usage);
	const filled = Math.min(Math.max(usage.total, counted), usage.limit);
	const bands: ContextBand[] = parts.map((part, at) => ({
		name: part.name,
		tokens: part.tokens,
		hue: HUES[at % HUES.length]
	}));
	if (filled > counted) bands.push({ name: NOT_LISTED, tokens: filled - counted });
	return {
		limit: usage.limit,
		filled,
		bands,
		kept: usage.parts
			.filter((part) => part.kind === 'buffer')
			.map((part) => ({ name: part.name, tokens: part.tokens })),
		heldAside: heldAsideIn(usage),
		compactsAt: usage.compactsAt,
		compactedFrom: usage.compacted?.from
	};
}

/** Where a band sits along a bar `across` wide, in the same units. */
export interface ContextSpan {
	band: ContextBand;
	from: number;
	width: number;
}

/** The bands laid out from the near end, against the window rather than against
 *  each other, so a band's width says what it holds. */
export function spans(bar: ContextBar, across: number): ContextSpan[] {
	return laid(bar.bands, 0, bar.limit, across / bar.limit);
}

/** What the assistant keeps back, laid out so it ends at the window's far end —
 *  and never back over fill that has already reached into it, because room that
 *  has been spent is not room. */
export function keptSpans(bar: ContextBar, across: number): ContextSpan[] {
	const from = Math.max(bar.filled, bar.limit - summed(bar.kept));
	return laid(bar.kept, from, bar.limit, across / bar.limit);
}

function laid(bands: ContextBand[], from: number, limit: number, scale: number): ContextSpan[] {
	let at = from;
	return bands.map((band) => {
		const starts = Math.min(Math.max(at, 0), limit);
		at += band.tokens;
		const ends = Math.min(Math.max(at, 0), limit);
		return { band, from: starts * scale, width: Math.max(0, ends - starts) * scale };
	});
}

function summed(bands: ContextBand[]): number {
	return bands.reduce((total, band) => total + band.tokens, 0);
}

/** A share of the window, as a reader reads one. */
export function shareSaid(tokens: number, limit: number): string {
	const share = (tokens / limit) * 100;
	if (share > 0 && share < 0.5) return '<1%';
	return `${Math.round(share)}%`;
}

/** The line under the bar: how far it fills, against what, and what the
 *  assistant is holding outside the window altogether. */
export function fillSaid(bar: ContextBar): string {
	const said = `${tokensSaid(bar.filled)} of ${tokensSaid(bar.limit)}`;
	return bar.heldAside > 0 ? `${said} · ${tokensSaid(bar.heldAside)} held aside` : said;
}

/** The whole bar as one sentence, for somebody who is not looking at it. */
export function contextSaid(bar: ContextBar): string {
	const said = [`${tokensSaid(bar.filled)} of ${tokensSaid(bar.limit)} tokens.`];
	const named = [...bar.bands, ...bar.kept].map(
		(band) => `${band.name} ${tokensSaid(band.tokens)}`
	);
	if (named.length > 0) said.push(`${named.join(', ')}.`);
	if (bar.heldAside > 0) said.push(`${tokensSaid(bar.heldAside)} held aside.`);
	if (bar.compactsAt !== undefined) said.push(`Compacts at ${tokensSaid(bar.compactsAt)}.`);
	if (bar.compactedFrom !== undefined)
		said.push(`Compacted from ${tokensSaid(bar.compactedFrom)}.`);
	return said.join(' ');
}
