// What a section says, as lines a person reads: the words in it, and a name for
// the elements that have none.

import type { BlockDocument, DocumentNode } from '@sloppy/types';
import { INK_NODE } from '../editor/ink-node.js';
import { PICTURE_NODE } from '../editor/picture-node.js';
import { REFERENCE_NODE } from '../editor/reference-node.js';

/** An element that carries no words of its own, in the fewest that say what it
 *  is. One this build has never heard of is left out rather than named wrongly. */
const NAMED: Partial<Record<string, string>> = {
	[PICTURE_NODE]: 'A picture',
	[INK_NODE]: 'A drawing'
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
