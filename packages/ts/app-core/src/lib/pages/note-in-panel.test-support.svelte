<script lang="ts">
	// What graph.svelte mounts, cut down to the note and the surface it opens in:
	// the composition the caret has to be placed inside.
	import type { OwnedRef } from '@sloppy/types';
	import { ReadingPanel, type NoteTemplate } from '@sloppy/ui';
	import { untrack } from 'svelte';
	import { nodes } from '../stores/nodes.svelte.js';
	import Note from './node.svelte';
	import Writing from './writing.svelte';

	let {
		opened,
		fresh = true,
		writingAnother = false,
		onclose,
		onlink
	}: {
		opened: OwnedRef;
		fresh?: boolean;
		/** As the canvas reports it: another note is being given its address. */
		writingAnother?: boolean;
		onclose?: () => void;
		onlink?: () => void;
	} = $props();

	interface Typed {
		title: string;
		body: string;
		where: 'title' | 'body';
	}

	let showing = $state(untrack(() => opened));
	let naming = $state<OwnedRef | null>(untrack(() => (fresh ? opened : null)));
	let seed = $state<{ ref: OwnedRef; shape: NoteTemplate } | null>(null);
	let typed = $state<({ ref: OwnedRef } & Typed) | null>(null);
	let writing = $state<(Typed & { refused: string | null }) | null>(null);

	async function write(want: {
		relation: 'under' | 'after';
		from: OwnedRef;
		shape: NoteTemplate | null;
	}): Promise<void> {
		if (writing) return;
		writing = { title: '', body: '', where: 'title', refused: null };
		const job = writing;
		try {
			const made = await nodes.create({ from: { relation: want.relation, note: want.from } });
			writing = null;
			showing = made.ref;
			naming = made.ref;
			seed = want.shape ? { ref: made.ref, shape: want.shape } : null;
			typed =
				job.title || job.body
					? { ref: made.ref, title: job.title, body: job.body, where: job.where }
					: null;
		} catch {
			job.refused = 'Sloppy could not add that note.';
		}
	}
</script>

<ReadingPanel open title="Note">
	{#if writing}
		<Writing
			title={writing.title}
			body={writing.body}
			refused={writing.refused}
			onTitle={(said) => {
				if (writing) writing.title = said;
			}}
			onBody={(said) => {
				if (writing) writing.body = said;
			}}
			onCaret={(where) => {
				if (writing) writing.where = where;
			}}
			onAgain={() => {}}
			onClose={() => onclose?.()}
		/>
	{:else}
		<Note
			ref={showing}
			{naming}
			{writingAnother}
			{seed}
			{typed}
			onSeeded={() => (seed = null)}
			onTyped={() => (typed = null)}
			onWrite={(want) => void write(want)}
			onOpen={(ref) => {
				showing = ref;
				naming = null;
				seed = null;
				typed = null;
			}}
			onLinkOnGraph={() => onlink?.()}
			onDeleted={(_gone, above) => {
				if (!above) {
					onclose?.();
					return;
				}
				showing = above;
				naming = null;
				seed = null;
			}}
			onClose={() => onclose?.()}
		/>
	{/if}
</ReadingPanel>
