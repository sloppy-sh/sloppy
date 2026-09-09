// What a section says, as lines a person reads — the words in it, and a name for
// the elements that have none — and how much of a difference between two of them
// those lines can carry.

import type { BlockDocument, DocumentNode } from '@sloppy/types';
import { DIAGRAM_NODE } from '../editor/diagram-node.js';
import { INK_NODE } from '../editor/ink-node.js';
import { MATH_BLOCK_NODE, MATH_NODE } from '../editor/math-node.js';
import { PICTURE_NODE } from '../editor/picture-node.js';
import { REFERENCE_NODE } from '../editor/reference-node.js';

/** An element that carries no words of its own, in the fewest that say what it
 *  is. One this build has never heard of is left out rather than named wrongly. */
const NAMED: Partial<Record<string, string>> = {
	[PICTURE_NODE]: 'A picture',
	[INK_NODE]: 'A drawing',
	[MATH_NODE]: 'A formula',
	[MATH_BLOCK_NODE]: 'A formula',
	[DIAGRAM_NODE]: 'A diagram'
};

/** One line per element of a section, in the order they are written. Empty
 *  where nothing in it can be read as words. */
export function sectionLines(content: BlockDocument): string[] {
	return lines(content.content);
}

function lines(nodes: readonly DocumentNode[]): string[] {
	const written: string[] = [];
	for (const node of nodes) {
		if (holdsElements(node)) {
			written.push(...lines(node.content ?? []));
			continue;
		}
		const one = words(node).trim() || NAMED[node.type] || '';
		if (one !== '') written.push(one);
	}
	return written;
}

/** Whether this element holds elements in their own right — a list, a quote —
 *  rather than the words of one line. */
function holdsElements(node: DocumentNode): boolean {
	return (node.content ?? []).some((child) => child.content !== undefined);
}

function words(node: DocumentNode): string {
	if (node.type === REFERENCE_NODE) {
		const label = node.attrs?.label;
		return typeof label === 'string' ? label : '';
	}
	if (node.text !== undefined) return node.text;
	return (node.content ?? []).map(words).join('');
}

/**
 * How far apart two sides of one changed section are, as far as a reader can be
 * SHOWN it. A stack is reordered as a first-class act, so a section that only
 * moved has identical writing on both sides — and so does one whose difference
 * is a picture swapped or a word emboldened, which {@link sectionLines} reads
 * the same either way. Drawing either as a was/now pair shows a difference that
 * is not there.
 */
export type SectionDifference = 'moved' | 'same-words' | 'rewritten';

export function sectionDifference(
	before: { ord: string; content: BlockDocument },
	now: { ord: string; content: BlockDocument }
): SectionDifference {
	if (same(before.content, now.content)) {
		return before.ord === now.ord ? 'same-words' : 'moved';
	}
	return sectionLines(before.content).join('\n') === sectionLines(now.content).join('\n')
		? 'same-words'
		: 'rewritten';
}

/** A section's document is the editor's own, so it is compared by shape rather
 *  than by a serialization whose key order is the store's to choose. */
function same(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a === null || b === null) return false;
	if (typeof a !== 'object' || typeof b !== 'object') return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((held, at) => same(held, b[at]));
	}
	const held = a as Record<string, unknown>;
	const against = b as Record<string, unknown>;
	const keys = Object.keys(held);
	return (
		keys.length === Object.keys(against).length &&
		keys.every((key) => key in against && same(held[key], against[key]))
	);
}
