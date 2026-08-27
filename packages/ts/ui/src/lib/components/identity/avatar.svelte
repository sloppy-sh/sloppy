<script lang="ts">
	// A person's picture, with their initials until one is drawn.
	import { cn } from '$lib/utils.js';
	import { initialsOf, type Person } from './person.js';
	import Picture from './picture.svelte';

	let {
		person,
		size = 40,
		class: className
	}: {
		person: Person;
		/** Rendered px; the picture is sampled at twice this. */
		size?: number;
		class?: string;
	} = $props();

	/** The picture that would not load, so the initials stand in for it. */
	let broken = $state<string | null>(null);
	/** The picture on screen, so the initials are a fallback and never a backdrop
	 *  showing through one drawn over them. */
	let shown = $state<string | null>(null);

	const picture = $derived(person.avatar && person.avatar !== broken ? person.avatar : null);
	const covered = $derived(picture !== null && shown === picture);
</script>

<span
	class={cn(
		'relative block shrink-0 overflow-hidden rounded-full bg-muted text-muted-foreground',
		className
	)}
	style:width="{size}px"
	style:height="{size}px"
>
	{#if !covered}
		<span
			aria-hidden="true"
			class="absolute inset-0 flex items-center justify-center font-medium"
			style:font-size="{Math.round(size * 0.38)}px"
		>
			{initialsOf(person)}
		</span>
	{/if}
	{#if picture}
		<Picture
			src={picture}
			sample={size * 2}
			class="relative size-full"
			onshown={() => (shown = picture)}
			onbroken={() => (broken = picture)}
		/>
	{/if}
</span>
