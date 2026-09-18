<script lang="ts">
	// Somebody else's sections, drawn from the same element kinds `../editor`
	// writes them in, on a surface nobody can type into.
	import type { BlockView } from '@sloppy/types';
	import { Editor } from '@tiptap/core';
	import { TaskItem, TaskList } from '@tiptap/extension-list';
	import type { Transaction } from '@tiptap/pm/state';
	import StarterKit from '@tiptap/starter-kit';
	import { untrack } from 'svelte';
	import { emojiCatalogs } from '../../emoji/catalogs.svelte.js';
	import { CODE_PROTOCOL } from '../editor/code-anchor.js';
	import { CompassNode } from '../editor/compass-node.js';
	import type { NoteEmoji } from '../editor/contract.js';
	import { openBlocks } from '../editor/document.js';
	import { DRAWN_ELEMENTS } from '../editor/elements.js';
	import { EMOJI_NODE, EmojiNode, reclaimEmoji } from '../editor/emoji-node.js';
	import { InkNode } from '../editor/ink-node.js';
	import { PictureNode, type PictureSource } from '../editor/picture-node.js';
	import { ReferenceNode, type ReferenceReader } from '../editor/reference-node.js';
	import { NoteDocument, SectionNode } from '../editor/section-node.js';
	import { withoutPeerAddresses } from './held-document.js';

	let {
		author,
		blocks,
		pictures,
		references,
		emoji
	}: {
		/** Whose note this is: their catalog is what its shortcodes mean. */
		author: string;
		/** Their stack, in `ord` order. */
		blocks: readonly BlockView[];
		pictures: PictureSource;
		references: ReferenceReader;
		emoji: NoteEmoji['catalog'];
	} = $props();

	let host = $state<HTMLElement | null>(null);
	let surface = $state<Editor | null>(null);
	const catalog = $derived(emojiCatalogs.of(author, emoji));

	$effect(() => {
		const element = host;
		const opening = blocks;
		if (!element) return;
		return untrack(() => {
			const created = new Editor({
				element,
				editable: false,
				extensions: [
					StarterKit.configure({ document: false, link: { protocols: [CODE_PROTOCOL] } }),
					NoteDocument,
					SectionNode,
					TaskList,
					TaskItem.configure({ nested: true }),
					EmojiNode(() => catalog),
					ReferenceNode(() => references),
					CompassNode(() => references),
					InkNode,
					PictureNode(() => pictures),
					...DRAWN_ELEMENTS
				],
				editorProps: { attributes: { class: 'sloppy-prose' } }
			});
			created.commands.setContent(openBlocks(withoutPeerAddresses(opening), created.schema).doc, {
				emitUpdate: false
			});
			surface = created;
			return () => {
				surface = null;
				created.destroy();
			};
		});
	});

	// The author's catalog answers after their note is on screen, so a shortcode
	// standing for itself becomes the picture it names once that arrives.
	$effect(() => {
		const current = surface;
		const entries = catalog;
		if (!current || current.isDestroyed) return;
		let write: Transaction | null = null;
		current.state.doc.descendants((child, pos) => {
			if (child.type.name !== EMOJI_NODE) return true;
			const claimed = reclaimEmoji(child.attrs, entries);
			if (claimed) {
				write ??= current.state.tr;
				write.setNodeMarkup(write.mapping.map(pos), undefined, claimed);
			}
			return false;
		});
		if (write) current.view.dispatch(write);
	});
</script>

<div bind:this={host} class="sloppy-reading"></div>
