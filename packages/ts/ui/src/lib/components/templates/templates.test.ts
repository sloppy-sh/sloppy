import {
	BlockDocumentSchema,
	readsAsInk,
	type BlockView,
	type CreateBlockRequest,
	type OwnedRef
} from '@sloppy/types';
import { describe, expect, it } from 'vitest';
import {
	NOTE_TEMPLATES,
	suggestedFor,
	templateSections,
	writeTemplate,
	type NoteTemplate
} from './templates.js';

const NOTE = 'did:syr:example.test:ham/01JQ0000000000000000000000' as OwnedRef;

const shape = (id: string): NoteTemplate =>
	NOTE_TEMPLATES.find((template) => template.id === id) as NoteTemplate;

/** Records what reached the API, and answers as the API would. */
function recorder() {
	const sent: CreateBlockRequest[] = [];
	let made = 0;
	const create = (request: CreateBlockRequest): Promise<BlockView> => {
		sent.push(request);
		made += 1;
		return Promise.resolve({ ref: `${NOTE}${made}` as OwnedRef } as BlockView);
	};
	return { sent, create };
}

describe('the shapes on offer', () => {
	it('asks for at most three things to write, on every one of them', () => {
		for (const template of NOTE_TEMPLATES) {
			const writing = template.sections.filter((section) => section.opens !== 'drawing');
			expect(writing.length, template.name).toBeLessThanOrEqual(3);
		}
	});

	it('opens every section under a name, with room under it', () => {
		for (const template of NOTE_TEMPLATES) {
			const sections = templateSections(template);
			expect(sections).toHaveLength(template.sections.length);
			sections.forEach((section, at) => {
				expect(BlockDocumentSchema.safeParse(section).success).toBe(true);
				expect(section.content[0]).toEqual({
					type: 'heading',
					attrs: { level: 2 },
					content: [{ type: 'text', text: template.sections[at].heading }]
				});
				expect(section.content).toHaveLength(2);
			});
		}
	});

	it('names every shape once, and leaves no two at one id', () => {
		const ids = NOTE_TEMPLATES.map((template) => template.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(new Set(NOTE_TEMPLATES.map((one) => one.name)).size).toBe(ids.length);
	});

	it('offers the three shapes a project is reasoned in, each asking three things', () => {
		expect(shape('qec').sections.map((one) => one.heading)).toEqual([
			'The question',
			'The evidence',
			'The conclusion'
		]);
		expect(shape('aji').sections.map((one) => one.heading)).toEqual([
			'The assumption',
			'The justification',
			'The implication'
		]);
		expect(shape('walkthrough').sections).toHaveLength(3);
	});

	// A shape leaves no trace of itself: the sections are the whole of it, so
	// nothing a template writes says which template anybody reached for.
	it('leaves nothing behind but the sections', () => {
		for (const template of NOTE_TEMPLATES) {
			expect(Object.keys(template).sort()).toEqual(['id', 'name', 'sections']);
		}
	});

	it('opens the sketch on a drawing surface with nothing drawn on it', () => {
		const sketch = templateSections(shape('claim')).at(-1)?.content[1];
		expect(sketch?.type).toBe('ink');
		expect(readsAsInk(sketch?.attrs)).toBe(true);
		expect(sketch?.attrs?.strokes).toEqual([]);
	});
});

describe('writing a shape onto a note', () => {
	it('lands the sections in the order they are named', async () => {
		const { sent, create } = recorder();
		const written = await writeTemplate(shape('question'), { node: NOTE }, create);

		expect(sent.map((request) => request.after)).toEqual([
			undefined,
			written[0].ref,
			written[1].ref
		]);
		expect(sent.every((request) => request.node === NOTE)).toBe(true);
	});

	it('starts after what the note already holds', async () => {
		const { sent, create } = recorder();
		const already = `${NOTE}-a` as OwnedRef;
		await writeTemplate(shape('objection'), { node: NOTE, after: already }, create);
		expect(sent[0].after).toBe(already);
	});
});

describe('the shape suggested for where a note is about to go', () => {
	it('suggests nothing to a branch, which starts something', () => {
		expect(suggestedFor('root')).toBeNull();
	});

	it('offers an objection to a note springing out of another', () => {
		expect(suggestedFor('under')).toBe('objection');
	});

	it('offers a synthesis to a note continuing a run', () => {
		expect(suggestedFor('after')).toBe('synthesis');
	});
});
