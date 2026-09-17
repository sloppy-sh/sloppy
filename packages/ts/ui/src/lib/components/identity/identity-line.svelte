<script lang="ts">
	// The identifier a person hands out so somebody can read them, and the way to
	// hand it out on a phone.
	import { cn } from '$lib/utils.js';
	import CopyButton from '../copy-button.svelte';

	let {
		identity,
		label = 'Copy this identity',
		class: className
	}: {
		identity: string;
		/** What the copy control is called, in the voice of the surface it is on. */
		label?: string;
		class?: string;
	} = $props();
</script>

<div class={cn('flex items-start gap-2', className)}>
	<p class="min-w-0 flex-1 address text-sm break-all select-text">{identity}</p>
	<CopyButton value={identity} {label} />
</div>
