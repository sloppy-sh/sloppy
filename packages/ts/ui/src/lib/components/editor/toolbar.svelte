<script module lang="ts">
	import type { Component } from 'svelte';

	export interface EditorAction {
		id: string;
		label: string;
		icon: Component;
		run: () => void;
		/** Present only where the action is a state the writing is currently in. */
		on?: boolean;
	}
</script>

<script lang="ts">
	// The writing controls. Formatting scrolls on a phone rather than wrapping;
	// what puts something INTO the note stays where it can be seen, because at
	// phone width the rail is narrower than the actions and whatever falls off
	// the end of it is a feature nobody finds.
	import { scrollFade } from '$lib/scroll-fade.svelte.js';
	import { cn } from '$lib/utils.js';

	let {
		formatting,
		inserts,
		class: className
	}: { formatting: EditorAction[]; inserts: EditorAction[]; class?: string } = $props();
</script>

{#snippet control(action: EditorAction)}
	<button
		type="button"
		title={action.label}
		aria-label={action.label}
		aria-pressed={action.on}
		class="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-pressed:bg-primary/10 aria-pressed:text-primary"
		onmousedown={(event) => event.preventDefault()}
		onclick={action.run}
	>
		<action.icon class="size-4.5" />
	</button>
{/snippet}

<div role="toolbar" aria-label="Writing" class={cn('flex items-center gap-0.5', className)}>
	<div
		class="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto scroll-fade-x [--scroll-fade:1rem] [scrollbar-width:none]"
		{@attach scrollFade('x')}
	>
		{#each formatting as action (action.id)}
			{@render control(action)}
		{/each}
	</div>
	<div class="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden="true"></div>
	{#each inserts as action (action.id)}
		{@render control(action)}
	{/each}
</div>
