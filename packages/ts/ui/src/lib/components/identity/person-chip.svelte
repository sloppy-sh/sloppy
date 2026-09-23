<script lang="ts">
	// Somebody, small: wherever a surface names who wrote something or who is
	// signed in. Inline elements throughout, so it nests inside a link.
	import { cn } from '$lib/utils.js';
	import Avatar from './avatar.svelte';
	import { isNamed, nameOf, type Person } from './person.js';

	let {
		person,
		size = 40,
		handle = true,
		class: className
	}: {
		person: Person;
		size?: number;
		/** False where the name alone identifies them — a note's author line.
		 *  Somebody with no name has nothing that does, so their identity is
		 *  drawn either way. */
		handle?: boolean;
		class?: string;
	} = $props();
</script>

<span class={cn('flex min-w-0 items-center gap-3', className)}>
	<Avatar {person} {size} />
	<span class="flex min-w-0 flex-col">
		<span class="truncate font-medium">{nameOf(person)}</span>
		{#if !isNamed(person)}
			<span class="truncate font-mono text-xs text-muted-foreground select-text"
				>{person.identity}</span
			>
		{:else if handle && person.handle}
			<span class="truncate text-sm text-muted-foreground">@{person.handle}</span>
		{/if}
	</span>
</span>
