<script lang="ts">
	// What graph.svelte mounts, cut down to the note and the modal it opens in:
	// the composition the caret has to be placed inside.
	import type { OwnedRef } from '@sloppy/types';
	import { ResponsiveModal } from '@sloppy/ui';
	import { untrack } from 'svelte';
	import Note from './node.svelte';

	let {
		opened,
		fresh = true,
		onclose
	}: { opened: OwnedRef; fresh?: boolean; onclose?: () => void } = $props();

	let showing = $state(untrack(() => opened));
	let naming = $state<OwnedRef | null>(untrack(() => (fresh ? opened : null)));
</script>

<ResponsiveModal open title="Note" headed={false}>
	<Note
		ref={showing}
		{naming}
		onOpen={(ref, written) => {
			showing = ref;
			naming = written ? ref : null;
		}}
		onClose={() => onclose?.()}
	/>
</ResponsiveModal>
