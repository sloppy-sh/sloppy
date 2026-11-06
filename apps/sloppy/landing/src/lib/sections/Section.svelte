<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		id,
		title,
		sheet = false,
		children
	}: {
		id: string;
		title: string;
		/** Set the section on its own full-bleed sheet. */
		sheet?: boolean;
		children: Snippet;
	} = $props();
</script>

<section
	{id}
	class={['section-pad scroll-mt-14', sheet && 'border-y bg-card']}
	aria-labelledby="{id}-title"
>
	<div class="mx-auto max-w-6xl px-4 sm:px-8">
		<h2 id="{id}-title" class="type-h2">{title}</h2>
		<div class="mt-10">{@render children()}</div>
	</div>
</section>
