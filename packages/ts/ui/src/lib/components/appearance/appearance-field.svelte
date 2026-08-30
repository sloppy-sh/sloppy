<script lang="ts">
	// The row a note carries its look on, and the surface for changing it.
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import type { NodeAppearance } from '@sloppy/types';
	import type { NoteMedia } from '../editor/contract.js';
	import AppearanceModal from './appearance-modal.svelte';
	import MarkSwatch from './mark-swatch.svelte';
	import { shownPicture } from './shown-picture.svelte.js';

	let {
		appearance = null,
		media,
		onchange,
		refused = null
	}: {
		appearance?: NodeAppearance | null;
		media: NoteMedia;
		/** The WHOLE look, or null for a note left plain. Rejecting puts the
		 *  choices back as they were, so throw rather than swallow. */
		onchange: (appearance: NodeAppearance | null) => Promise<void> | void;
		/** What to say when {@link onchange} rejected without words of its own. */
		refused?: string | null;
	} = $props();

	let open = $state(false);
	const picture = shownPicture(
		() => media,
		() => appearance?.preview
	);
</script>

<button
	type="button"
	onclick={() => (open = true)}
	class="flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-left transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
>
	<MarkSwatch {appearance} picture={picture.src} size={32} />
	<span class="flex-1">How this note looks</span>
	<ChevronRight class="size-4 shrink-0 text-muted-foreground" />
</button>

<AppearanceModal bind:open {appearance} {media} {onchange} {refused} />
