<script lang="ts">
	import { replaceState } from '$app/navigation';
	import * as Tabs from '@sloppy/ui/tabs';
	import { onMount } from 'svelte';
	import { FAMILY } from '$lib/readings';
	import { TIERS, type Tier } from '$lib/summary';

	let { tier = $bindable(), ran }: { tier: Tier; ran: Tier[] } = $props();

	const tierOf = (name: string | null) =>
		TIERS.find((t) => FAMILY[t].toLowerCase() === name?.toLowerCase());

	let mounted = $state(false);
	onMount(() => {
		const asked = tierOf(new URLSearchParams(location.search).get('model'));
		if (asked && ran.includes(asked)) tier = asked;
		// The router is not ready to take a replaceState until the page has finished hydrating.
		setTimeout(() => (mounted = true));
	});
	$effect(() => {
		const q = tier === 'medium' ? '' : `?model=${FAMILY[tier].toLowerCase()}`;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- this page, its query changed
		if (mounted) replaceState(`${location.pathname}${q}${location.hash}`, {});
	});
</script>

{#if ran.length > 1}
	<div class="flex flex-wrap items-center gap-3" data-chart>
		<span class="text-sm text-muted-foreground" id="model-label">Model</span>
		<Tabs.Root bind:value={tier} aria-labelledby="model-label">
			<Tabs.List>
				{#each TIERS.filter((t) => ran.includes(t)) as t (t)}
					<Tabs.Trigger value={t} class="px-3">{FAMILY[t]}</Tabs.Trigger>
				{/each}
			</Tabs.List>
		</Tabs.Root>
	</div>
{/if}
