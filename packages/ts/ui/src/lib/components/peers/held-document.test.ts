import type { BlockDocument, BlockView } from '@sloppy/types';
import { describe, expect, it } from 'vitest';
import { withoutPeerAddresses } from './held-document.js';

const block = (content: BlockDocument): BlockView => ({
	ref: 'did:syr:z6MkpTHR8VNsBxYAAWHut2Geadd9jSLuFvdmsZ2mFmZjMxYZ/01JQXR00000000000000000001',
	created_by: 'did:syr:z6MkpTHR8VNsBxYAAWHut2Geadd9jSLuFvdmsZ2mFmZjMxYZ',
	created_at: '2026-01-01T00:00:00.000Z',
	updated_at: '2026-01-01T00:00:00.000Z',
	node: 'did:syr:z6MkpTHR8VNsBxYAAWHut2Geadd9jSLuFvdmsZ2mFmZjMxYZ/01JQXR00000000000000000002',
	ord: 'a0',
	content
});

/** Every address anywhere in a document, whichever attribute carries it and
 *  however deep it sits: a browser fetches one the same either way. */
function addresses(document: BlockDocument): string[] {
	const found: string[] = [];
	const pending = [...document.content];
	for (let element = pending.pop(); element; element = pending.pop()) {
		for (const value of Object.values(element.attrs ?? {})) {
			if (typeof value === 'string' && /^(?:https?|blob|data):/.test(value)) found.push(value);
		}
		if (element.content) pending.push(...element.content);
	}
	return found;
}

describe('a section written on somebody else’s instance', () => {
	it('draws no emoji from the address its author minted', () => {
		const [cleaned] = withoutPeerAddresses([
			block({
				type: 'doc',
				content: [
					{
						type: 'paragraph',
						content: [
							{ type: 'text', text: 'look ' },
							{
								type: 'emoji',
								attrs: {
									name: 'wave',
									char: '',
									src: 'https://author.example/blob/wave.png',
									sticker: false
								}
							}
						]
					}
				]
			})
		]);

		expect(addresses(cleaned.content)).toEqual([]);
	});

	it('draws no picture from an address its author put beside the upload', () => {
		const [cleaned] = withoutPeerAddresses([
			block({
				type: 'doc',
				content: [
					{
						type: 'picture',
						attrs: {
							upload_id: 'did:syr:z6Mk/01JQXR',
							preview: 'https://tracker.example/p.png',
							progress: 0,
							failure: 'Ask your bank to call this number'
						}
					}
				]
			})
		]);

		expect(cleaned.content.content[0].attrs).toEqual({ upload_id: 'did:syr:z6Mk/01JQXR' });
	});

	it('draws nothing at all for a picture that is only an address', () => {
		const [cleaned] = withoutPeerAddresses([
			block({
				type: 'doc',
				content: [
					{ type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
					{ type: 'picture', attrs: { preview: 'https://tracker.example/p.png' } }
				]
			})
		]);

		expect(cleaned.content.content.map((element) => element.type)).toEqual(['paragraph']);
		expect(addresses(cleaned.content)).toEqual([]);
	});

	it('keeps the words, the shortcode and everything else a section holds', () => {
		const [cleaned] = withoutPeerAddresses([
			block({
				type: 'doc',
				content: [
					{
						type: 'paragraph',
						content: [
							{ type: 'text', text: 'ink and ', marks: [{ type: 'bold' }] },
							{
								type: 'emoji',
								attrs: { name: 'wave', char: '', src: 'https://author.example/w.png' }
							}
						]
					},
					{ type: 'picture', attrs: { upload_id: 'did:syr:z6Mk/01JQXR', width: 40 } }
				]
			})
		]);

		const [paragraph, picture] = cleaned.content.content;
		expect(paragraph.content?.[0]).toEqual({
			type: 'text',
			text: 'ink and ',
			marks: [{ type: 'bold' }]
		});
		expect(paragraph.content?.[1].attrs).toEqual({ name: 'wave', char: '', src: '' });
		expect(picture.attrs).toEqual({ upload_id: 'did:syr:z6Mk/01JQXR', width: 40 });
	});
});
