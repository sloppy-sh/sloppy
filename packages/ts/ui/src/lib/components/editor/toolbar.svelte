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
	// The writing controls, as a rail that scrolls on a phone rather than wrapping.
	import { cn } from '$lib/utils.js';

	let { actions, class: className }: { actions: EditorAction[]; class?: string } = $props();
</script>

<div
	role="toolbar"
	aria-label="Writing"
	class={cn(
		'flex items-center gap-0.5 overflow-x-auto scroll-fade-x [--scroll-fade:1rem] [scrollbar-width:none]',
		className
	)}
>
	{#each actions as action (action.id)}
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
	{/each}
</div>
