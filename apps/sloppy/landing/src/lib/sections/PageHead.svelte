<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Snippet } from 'svelte';

	let {
		trail,
		title,
		children
	}: { trail: { label: string; href?: string }[]; title: string; children?: Snippet } = $props();
</script>

<div class="mx-auto max-w-6xl px-4 pt-[clamp(3rem,7vw,5rem)] sm:px-8">
	<nav class="text-sm text-muted-foreground" aria-label="Breadcrumb">
		<a href={resolve('/')} class="underline underline-offset-2 hover:text-foreground">Sloppy</a>
		{#each trail as step (step.label)}
			<span aria-hidden="true" class="mx-1">·</span>
			{#if step.href}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved by the caller -->
				<a href={step.href} class="underline underline-offset-2 hover:text-foreground"
					>{step.label}</a
				>
			{:else}{step.label}{/if}
		{/each}
	</nav>
	<h1 class="type-display mt-3">{title}</h1>
	{#if children}
		<div class="mt-6 max-w-[62ch] text-lg leading-relaxed text-muted-foreground">
			{@render children()}
		</div>
	{/if}
</div>
