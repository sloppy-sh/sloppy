// Which notes a file is the code of, read off their anchors.

import type { BlockDocument, BlockView, NodeView, OwnedRef } from '@sloppy/types';
import { describe, expect, it } from 'vitest';
import {
	notesReaching,
	notesWithSections,
	provenanceOver,
	sectionSays,
	type NoteSections
} from './code-provenance.js';

const DID = 'did:plc:ada';
const at = (n: number): OwnedRef => `${DID}/01JZ00000000000000000000${String(n).padStart(2, '0')}`;

function linked(href: string, words: string, heading?: string): BlockDocument {
	return {
		type: 'doc',
		content: [
			...(heading === undefined
				? []
				: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: heading }] }]),
			{
				type: 'paragraph',
				content: [
					{ type: 'text', text: `${words} ` },
					{ type: 'text', text: 'here', marks: [{ type: 'link', attrs: { href } }] }
				]
			}
		]
	};
}

const plain = (words: string): BlockDocument => ({
	type: 'doc',
	content: [{ type: 'paragraph', content: [{ type: 'text', text: words }] }]
});

function note(n: number, title: string, sections: BlockDocument[], address?: string): NoteSections {
	return {
		note: { ref: at(n), title, ...(address === undefined ? {} : { address }) },
		sections: sections.map((content, i) => ({ ref: at(50 + n * 5 + i), content }))
	};
}

describe('the notes a file is the code of', () => {
	it('reads a run of lines, with the section that names it', () => {
		const held = [
			note(
				1,
				'The parser',
				[plain('Why it exists'), linked('code:src/parser.ts#L10-L20', 'It reads', 'Reading')],
				'1'
			)
		];
		expect(notesReaching(held, 'src/parser.ts')).toEqual([
			{
				ref: at(1),
				title: 'The parser',
				address: '1',
				anchor: { path: 'src/parser.ts', fragment: { kind: 'lines', from: 10, to: 20 } },
				block: at(56),
				heading: 'Reading',
				text: 'It reads here'
			}
		]);
	});

	it('reads a name, and a whole file', () => {
		const held = [
			note(1, 'Discovery', [linked('code:src/history.rs#discover', 'Finds the folder')]),
			note(2, 'History', [linked('code:src/history.rs', 'All of it')])
		];
		const found = notesReaching(held, 'src/history.rs');
		expect(found.map((one) => one.anchor)).toEqual([
			{ path: 'src/history.rs', fragment: { kind: 'symbol', name: 'discover' } },
			{ path: 'src/history.rs' }
		]);
		expect(found[0]).not.toHaveProperty('heading');
		expect(found[1]).not.toHaveProperty('address');
	});

	it('stacks several notes on one file, note by note in the order given', () => {
		const held = [
			note(1, 'One', [linked('code:a.ts#L1-L3', 'First')]),
			note(2, 'Two', [linked('code:a.ts#L1-L3', 'Second'), linked('code:a.ts#L9', 'Third')]),
			note(3, 'Elsewhere', [linked('code:b.ts', 'Not here')])
		];
		expect(notesReaching(held, 'a.ts').map((one) => [one.title, one.text])).toEqual([
			['One', 'First here'],
			['Two', 'Second here'],
			['Two', 'Third here']
		]);
	});

	it('reaches a file through a folder it is in, and no other way', () => {
		const held = [note(1, 'The source', [linked('code:src', 'Everything')])];
		expect(notesReaching(held, 'src/parser.ts')).toHaveLength(1);
		expect(notesReaching(held, 'srcs/parser.ts')).toEqual([]);
	});

	it('is nothing for a path no note reaches', () => {
		const held = [note(1, 'The parser', [linked('code:src/parser.ts', 'It reads')])];
		expect(notesReaching(held, 'src/vault.ts')).toEqual([]);
		expect(notesReaching([], 'src/parser.ts')).toEqual([]);
	});

	it('says a section as its first heading and its words a paragraph a line', () => {
		const content: BlockDocument = {
			type: 'doc',
			content: [
				{ type: 'heading', content: [{ type: 'text', text: 'Why' }] },
				{ type: 'paragraph', content: [{ type: 'text', text: 'Because.' }] },
				{
					type: 'bulletList',
					content: [
						{
							type: 'listItem',
							content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] }]
						}
					]
				},
				{ type: 'heading', content: [{ type: 'text', text: 'And then' }] }
			]
		};
		expect(sectionSays(content)).toEqual({ heading: 'Why', text: 'Because.\nOne\nAnd then' });
	});
});

describe('reading the notes from where they are kept', () => {
	const view = (n: number, title: string, parent?: OwnedRef): NodeView =>
		({ ref: at(n), title, ...(parent ? { parent } : {}) }) as NodeView;
	const section = (n: number, ord: string, content: BlockDocument): BlockView =>
		({ ref: at(n), ord, content }) as BlockView;

	const source = () => {
		let reads = 0;
		return {
			get reads() {
				return reads;
			},
			listNodes: async (query: { origin?: OwnedRef } = {}) =>
				query.origin === undefined
					? [view(1, 'Root')]
					: query.origin === at(1)
						? [view(1, 'Root'), view(2, 'Under', at(1))]
						: [],
			listBlocks: async (ref: OwnedRef) => {
				reads += 1;
				return ref === at(2)
					? [section(31, 'b', plain('Second')), section(30, 'a', linked('code:a.ts', 'First'))]
					: [];
			}
		};
	};

	it('takes every note once, its sections in their order', async () => {
		const held = await notesWithSections(source());
		expect(held.map((one) => one.note.title)).toEqual(['Root', 'Under']);
		expect(held[1]?.sections.map((one) => one.ref)).toEqual([at(30), at(31)]);
	});

	it('reads the notes once however many files are asked about', async () => {
		const from = source();
		const why = provenanceOver(from);
		expect((await why('a.ts')).map((one) => one.title)).toEqual(['Under']);
		expect(await why('b.ts')).toEqual([]);
		expect(from.reads).toBe(2);
	});
});
