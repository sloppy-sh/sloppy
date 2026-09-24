// The shapes a note can start from, and what writing one onto a note does —
// docs/ARCHITECTURE.md § "Blocks and ink".

import {
	compassNode,
	DECISION_WHY_HEADING,
	type BlockDocument,
	type BlockView,
	type CreateBlockRequest,
	type DocumentNode,
	type NodePlacement,
	type OwnedRef
} from '@sloppy/types';
import { EMPTY_COMPASS } from '../editor/compass-node.js';

export type TemplateId =
	| 'claim'
	| 'question'
	| 'source'
	| 'objection'
	| 'synthesis'
	| 'walkthrough'
	| 'decision';

/** What a seeded section opens on. Absent is somewhere to write. */
export type SectionOpening = 'writing' | 'drawing' | 'compass';

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
	},
	{
		id: 'walkthrough',
		name: 'Walkthrough',
		sections: [
			{ heading: 'Start here' },
			{ heading: 'The path it takes' },
			{ heading: 'Where it can go wrong' }
		]
	},
	{
		id: 'decision',
		name: 'Decision',
		sections: [{ heading: 'Where this sits', opens: 'compass' }, { heading: DECISION_WHY_HEADING }]
	}
];

/** What a section opens with under its name. */
function opening(opens: SectionOpening | undefined): DocumentNode {
	if (opens === 'drawing') return { type: 'ink', attrs: { strokes: [], ...SKETCH } };
	if (opens === 'compass') return compassNode(EMPTY_COMPASS);
	return { type: 'paragraph' };
}

/** The documents a shape's sections open as: a name, and room under it. */
export function templateSections(template: NoteTemplate): BlockDocument[] {
	return template.sections.map((section) => ({
		type: 'doc',
		content: [
			{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: section.heading }] },
			opening(section.opens)
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

/**
 * The shape to put first for a note about to be written in that place: one
 * springing out of another is where an objection goes, one continuing a run is
 * where a synthesis does. Null leaves the shapes in their own order.
 *
 * Only a placement can answer this. An address cannot: `1b` is both the second
 * note under `1` and the note after `1a`, and they are the same note.
 */
export function suggestedFor(relation: NodePlacement['relation']): TemplateId | null {
	if (relation === 'under') return 'objection';
	return relation === 'after' ? 'synthesis' : null;
}
