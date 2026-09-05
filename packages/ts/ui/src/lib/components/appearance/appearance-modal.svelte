<script lang="ts">
	// The same controls the note's own Look tab carries, for the canvas, where a
	// mark is reached without opening the note behind it.
	import type { NodeAppearance } from '@sloppy/types';
	import type { NoteMedia } from '../editor/contract.js';
	import ResponsiveModal from '../responsive-modal.svelte';
	import LookControls from './look-controls.svelte';

	let {
		open = $bindable(false),
		onOpenChange,
		appearance = null,
		media,
		onchange,
		refused = null
	}: {
		open?: boolean;
		/** For the unbound `open={expr}` pattern; a bound `open` needs nothing. */
		onOpenChange?: (open: boolean) => void;
		appearance?: NodeAppearance | null;
		media: NoteMedia;
		/** The WHOLE look, or null for a note left plain. Rejecting puts the
		 *  choices back as they were, so throw rather than swallow. */
		onchange: (appearance: NodeAppearance | null) => Promise<void> | void;
		/** What to say when {@link onchange} rejected without words of its own. */
		refused?: string | null;
	} = $props();
</script>

<ResponsiveModal
	{open}
	onOpenChange={(v) => {
		open = v;
		onOpenChange?.(v);
	}}
	title="How this note looks"
	description="On the graph, wherever this note is drawn."
>
	<div class="px-4 pt-2 pb-[max(1rem,var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))]">
		<LookControls {appearance} {media} {onchange} {refused} />
	</div>
</ResponsiveModal>
