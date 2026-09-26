// Writing a shape's sections onto a note. The shapes themselves are
// `NOTE_TEMPLATES` in `@sloppy/types`, which the app and `.sloppy/AGENT.md`
// both read — docs/ARCHITECTURE.md § "Blocks and ink".

import {
	compassNode,
	type BlockDocument,
	type BlockView,
	type CreateBlockRequest,
	type DocumentNode,
	type NodePlacement,
	type NoteTemplate,
	type OwnedRef,
	type SectionOpening,
	type TemplateId
} from '@sloppy/types';
import { EMPTY_COMPASS } from '../editor/compass-node.js';

export type { NoteTemplate, SectionOpening, TemplateId, TemplateSection } from '@sloppy/types';
export { NOTE_TEMPLATES } from '@sloppy/types';

/** A drawing's own coordinates, which a reader scales into its own width. */
const SKETCH = { width: 600, height: 200 };

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
