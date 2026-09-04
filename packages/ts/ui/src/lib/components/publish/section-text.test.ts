import type { BlockDocument } from '@sloppy/types';
import { describe, expect, it } from 'vitest';
import { sectionDifference, sectionLines } from './section-text.js';

const doc = (content: BlockDocument['content']): BlockDocument => ({ type: 'doc', content });

describe('a section read as lines', () => {
	it('keeps a run of words whole across the marks on it', () => {
		expect(
			sectionLines(
				doc([
					{
						type: 'paragraph',
						content: [
							{ type: 'text', text: 'a thought ' },
							{ type: 'text', text: 'worth', marks: [{ type: 'bold' }] },
							{ type: 'text', text: ' keeping' }
						]
					}
				])
			)
		).toEqual(['a thought worth keeping']);
	});

	it('reads a list as one line an item', () => {
		expect(
			sectionLines(
				doc([
					{
						type: 'bulletList',
						content: [
							{
								type: 'listItem',
								content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }]
							},
							{
								type: 'listItem',
								content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }]
							}
						]
					}
				])
			)
		).toEqual(['first', 'second']);
	});

	it('names what a person drew or put in rather than skipping it', () => {
		expect(
			sectionLines(
				doc([
					{ type: 'picture', attrs: { upload_id: 'a-copy' } },
					{ type: 'ink', attrs: { strokes: [] } }
				])
			)
		).toEqual(['A picture', 'A drawing']);
	});

	it('reads a citation as the note it names', () => {
		expect(
			sectionLines(
				doc([
					{
						type: 'paragraph',
						content: [
							{ type: 'text', text: 'see ' },
							{ type: 'reference', attrs: { note: '', label: 'Seed of a thought' } }
						]
					}
				])
			)
		).toEqual(['see Seed of a thought']);
	});

	it('has nothing to say about a section with nothing in it', () => {
		expect(sectionLines(doc([{ type: 'paragraph' }]))).toEqual([]);
	});

	it('leaves out an element this build has never heard of', () => {
		expect(
			sectionLines(doc([{ type: 'orrery', attrs: { planets: 8 } }, { type: 'picture' }]))
		).toEqual(['A picture']);
	});
});

describe('two sides of one changed section', () => {
	const words = (text: string) => doc([{ type: 'paragraph', content: [{ type: 'text', text }] }]);

	// Reordering the stack is a first-class act, so this is the ordinary case
	// rather than a corner: nothing about the writing moved.
	it('calls a section that only took a new place moved', () => {
		expect(
			sectionDifference(
				{ ord: 'Zz', content: words('written first') },
				{ ord: 'Zx', content: words('written first') }
			)
		).toBe('moved');
	});

	it('says the words are the same where only the pictures changed', () => {
		expect(
			sectionDifference(
				{ ord: 'a0', content: doc([{ type: 'picture', attrs: { upload_id: 'one' } }]) },
				{ ord: 'a0', content: doc([{ type: 'picture', attrs: { upload_id: 'another' } }]) }
			)
		).toBe('same-words');
	});

	it('asks for both sides where the writing itself moved', () => {
		expect(
			sectionDifference(
				{ ord: 'a0', content: words('what it said') },
				{ ord: 'a0', content: words('what it says now') }
			)
		).toBe('rewritten');
	});
});
