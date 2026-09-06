// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { PictureNode, type PictureSource } from './picture-node.js';

const UPLOAD = 'did:syr:z6MkwSiAvviKsS8dvXsScr4ipdeZwusLQY92cWWBisnvpJLc/01JQXR000000000000000001';

let editor: Editor | undefined;
let element: HTMLElement | undefined;

/** One note holding one picture, drawn from `source`. */
function draw(source: PictureSource): HTMLElement {
	element = document.createElement('div');
	document.body.append(element);
	editor = new Editor({
		element,
		editable: false,
		extensions: [StarterKit, PictureNode(() => source)],
		content: {
			type: 'doc',
			content: [{ type: 'picture', attrs: { upload_id: UPLOAD } }]
		}
	});
	return element;
}

const said = (at: HTMLElement) => at.querySelector('.sloppy-picture-note')?.textContent ?? '';

const settle = () => new Promise((done) => setTimeout(done, 0));

afterEach(() => {
	editor?.destroy();
	editor = undefined;
	element?.remove();
	element = undefined;
	document.body.innerHTML = '';
});

describe('a picture that would not draw', () => {
	it('sends the reader back to their own note in a moment', async () => {
		const at = draw({ picture: () => Promise.reject(new Error('no')) });
		await settle();

		expect(said(at)).toContain('Open the note again');
	});

	// The copy is what the reader has; opening it again asks nobody new.
	it('says a held one is not readable here, and offers no second try', async () => {
		const at = draw({ held: true, picture: () => Promise.reject(new Error('no')) });
		await settle();

		expect(said(at)).toContain("isn't readable here");
		expect(said(at)).not.toContain('Open the note again');
	});

	it('says the same about a held one the browser itself could not load', async () => {
		const at = draw({
			held: true,
			picture: async () => ({ src: 'blob:held', release: () => {} })
		});
		await settle();

		const image = at.querySelector('.sloppy-picture-image') as HTMLImageElement;
		image.dispatchEvent(new Event('error'));

		expect(said(at)).toContain("isn't readable here");
	});
});
