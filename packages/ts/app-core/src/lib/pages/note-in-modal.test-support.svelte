<script lang="ts">
	// What graph.svelte mounts, cut down to the note and the modal it opens in:
	// the composition the caret has to be placed inside.
	import type { OwnedRef } from '@sloppy/types';
	import { ResponsiveModal, type NoteTemplate } from '@sloppy/ui';
	import { untrack } from 'svelte';
	import Note from './node.svelte';

	let {
		opened,
		fresh = true,
		onclose,
		onlink
	}: {
		opened: OwnedRef;
		fresh?: boolean;
		onclose?: () => void;
		onlink?: () => void;
	} = $props();

	let showing = $state(untrack(() => opened));
	let naming = $state<OwnedRef | null>(untrack(() => (fresh ? opened : null)));
	let seed = $state<{ ref: OwnedRef; shape: NoteTemplate } | null>(null);
</script>

<ResponsiveModal open title="Note" headed={false}>
	<Note
		ref={showing}
		{naming}
		{seed}
		onOpen={(ref, written, shape) => {
			showing = ref;
			naming = written ? ref : null;
			seed = shape ? { ref, shape } : null;
		}}
		onLinkOnGraph={() => onlink?.()}
		onClose={() => onclose?.()}
	/>
</ResponsiveModal>
