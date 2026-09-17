// A place in the project's code, named inside somebody's writing. It is an
// ordinary link whose href is an anchor — `parseCodeAnchor` in `@sloppy/types`
// is the one reader of one — drawn as a chip and opened as a reading surface
// rather than followed: DESIGN.md § "An anchor into code".

import { CODE_SCHEME, type CodeAnchor, parseCodeAnchor } from '@sloppy/types';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { NoteCode } from './contract.js';

/** What the link extension has to be told to keep, or it renders an anchor into
 *  code with no address at all. */
export const CODE_PROTOCOL = CODE_SCHEME.slice(0, -1);

/** What an anchor is written down as. Inverse of `parseCodeAnchor` over every
 *  anchor that one answers with. */
export function codeHref(anchor: CodeAnchor): string {
	const held = anchor.fragment;
	if (held === undefined) return `${CODE_SCHEME}${anchor.path}`;
	if (held.kind === 'symbol') return `${CODE_SCHEME}${anchor.path}#${held.name}`;
	const run = held.to === held.from ? `L${held.from}` : `L${held.from}-L${held.to}`;
	return `${CODE_SCHEME}${anchor.path}#${run}`;
}

/** What an anchor reads as: the file's own name, with the run of lines or the
 *  name after it. */
export function anchorLabel(anchor: CodeAnchor): string {
	const file = anchor.path.slice(anchor.path.lastIndexOf('/') + 1);
	const held = anchor.fragment;
	if (held === undefined) return file;
	if (held.kind === 'symbol') return `${file} · ${held.name}`;
	return `${file} · L${held.from}${held.to === held.from ? '' : `-${held.to}`}`;
}

/** The anchor the tapped element points at, where one was tapped. */
function anchorAt(target: EventTarget | null): CodeAnchor | undefined {
	const link = (target as Element | null)?.closest?.('a[href]');
	const href = link?.getAttribute('href');
	return href === null || href === undefined ? undefined : parseCodeAnchor(href);
}

/**
 * Tapping an anchor opens the code it names rather than sending the reader
 * anywhere, and leaves the caret where it was — a chip in the middle of a
 * sentence must not cost the writer their place in it.
 */
export function CodeAnchors(code: () => NoteCode | undefined) {
	const taken = (event: Event, show: boolean): boolean => {
		const held = code();
		if (!held) return false;
		const anchor = anchorAt(event.target);
		if (!anchor) return false;
		event.preventDefault();
		if (show) held.show(anchor);
		return true;
	};

	return Extension.create({
		name: 'codeAnchors',
		addProseMirrorPlugins() {
			return [
				new Plugin({
					key: new PluginKey('codeAnchors'),
					props: {
						handleDOMEvents: {
							mousedown: (_view, event) => taken(event, false),
							click: (_view, event) => taken(event, true)
						}
					}
				})
			];
		}
	});
}
