// The shapes a note can start from: named sections, seeded empty. A shape is
// convention and not vocabulary — nothing about it is stored, so a note that
// took one is a note whose sections somebody happened not to type themselves,
// and a peer's note with different sections reads exactly the same.

import {
	parseAddress,
	type Address,
	type BlockDocument,
	type BlockView,
	type CreateBlockRequest,
	type NodePlacement,
	type OwnedRef
} from '@sloppy/types';

export type TemplateId = 'claim' | 'question' | 'source' | 'objection' | 'synthesis';

/** What a seeded section opens on. Absent is somewhere to write. */
export type SectionOpening = 'writing' | 'drawing';

export interface TemplateSection {
	heading: string;
	opens?: SectionOpening;
}

export interface NoteTemplate {
	/** Names this shape in a list of them, and reaches no further. */
	id: TemplateId;
	name: string;
	sections: readonly TemplateSection[];
}

/** A drawing's own coordinates, which a reader scales into its own width. */
const SKETCH = { width: 600, height: 200 };

export const NOTE_TEMPLATES: readonly NoteTemplate[] = [
	{
		id: 'claim',
		name: 'Claim',
		sections: [
			{ heading: 'The claim in one sentence' },
			{ heading: 'What makes me believe it' },
			{ heading: 'What would change my mind' },
			{ heading: 'Draw the mechanism', opens: 'drawing' }
		]
	},
	{
		id: 'question',
		name: 'Question',
		sections: [
			{ heading: 'The question, sharpened' },
			{ heading: 'What hangs on it' },
			{ heading: "Where I've looked" }
		]
	},
	{
		id: 'source',
		name: 'Source',
		sections: [
			{ heading: 'What it says in my words' },
			{ heading: 'Quotes worth keeping, with locators' },
			{ heading: 'What I take from it' }
		]
	},
	{
		id: 'objection',
		name: 'Objection',
		sections: [{ heading: 'The objection' }, { heading: 'What survives if I am right' }]
	},
	{
		id: 'synthesis',
		name: 'Synthesis',
		sections: [
			{ heading: 'What the run establishes' },
			{ heading: 'What it does not' },
			{ heading: 'Where next' }
		]
	}
];

/** The documents a shape's sections open as: a name, and room under it. */
export function templateSections(template: NoteTemplate): BlockDocument[] {
	return template.sections.map((section) => ({
		type: 'doc',
		content: [
			{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: section.heading }] },
			section.opens === 'drawing'
				? { type: 'ink', attrs: { strokes: [], ...SKETCH } }
				: { type: 'paragraph' }
		]
	}));
}

/**
 * Writes a shape's sections onto a note, in order, after whatever is there
 * already. Resolves with the rows they became.
 */
export async function writeTemplate(
	template: NoteTemplate,
	into: { node: OwnedRef; after?: OwnedRef },
	create: (request: CreateBlockRequest) => Promise<BlockView>
): Promise<BlockView[]> {
	const written: BlockView[] = [];
	let after = into.after;
	for (const content of templateSections(template)) {
		const block = await create({ node: into.node, content, ...(after ? { after } : {}) });
		written.push(block);
		after = block.ref;
	}
	return written;
}

/** Where a note sits, said the way a placement says it. */
function relationOf(address: Address): NodePlacement['relation'] {
	const segments = parseAddress(address);
	if (segments.length === 1) return 'root';
	return segments[segments.length - 1].ordinal === 1 ? 'under' : 'after';
}

/**
 * The shape to put first for a note in that place: a note springing out of
 * another is where an objection goes, one continuing a run is where a synthesis
 * does. Null leaves the shapes in their own order.
 */
export function suggestedFor(relation: NodePlacement['relation']): TemplateId | null {
	if (relation === 'under') return 'objection';
	return relation === 'after' ? 'synthesis' : null;
}

/** {@link suggestedFor}, for a note that is already at an address. */
export function suggestedForAddress(address: Address): TemplateId | null {
	return suggestedFor(relationOf(address));
}
