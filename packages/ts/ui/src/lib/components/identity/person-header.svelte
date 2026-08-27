<script lang="ts">
	// The top of somebody's page: what they chose to be called, and the two
	// pictures they chose to be seen as.
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';
	import Avatar from './avatar.svelte';
	import { nameOf, type Person } from './person.js';

	let {
		person,
		actions,
		class: className
	}: {
		person: Person;
		/** Sits beside the picture, clear of the banner. */
		actions?: Snippet;
		class?: string;
	} = $props();
</script>

<div class={cn('space-y-3', className)}>
	<div class="h-28 w-full overflow-hidden rounded-lg bg-muted sm:h-40">
		{#if person.banner}
			<img
				src={person.banner}
				alt=""
				decoding="async"
				class="size-full object-cover"
				draggable="false"
			/>
		{/if}
	</div>

	<div class="-mt-12 flex items-end justify-between gap-3 px-1 sm:-mt-14">
		<Avatar {person} size={80} class="border-4 border-background" />
		{@render actions?.()}
	</div>

	<div class="space-y-0.5">
		<h1 class="text-2xl font-semibold tracking-tight break-words">{nameOf(person)}</h1>
		<p class="text-sm break-all text-muted-foreground">@{person.handle}</p>
	</div>

	{#if person.bio?.trim()}
		<p class="text-sm whitespace-pre-wrap text-foreground/90">{person.bio.trim()}</p>
	{/if}
</div>
