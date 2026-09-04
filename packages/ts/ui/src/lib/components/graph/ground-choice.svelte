<script lang="ts">
	// The paper the graph is drawn on, chosen from the graph's own chrome —
	// DESIGN.md § "The ground".
	import Grid2x2 from '@lucide/svelte/icons/grid-2x2';
	import Image from '@lucide/svelte/icons/image';
	import { GRAPH_GROUNDS, type GraphGround } from '@sloppy/graph';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';

	let {
		value,
		pictured,
		onchange,
		onpicture
	}: {
		value: GraphGround;
		/** A picture is under the field already, so the way to it says so. */
		pictured: boolean;
		onchange: (ground: GraphGround) => void;
		/** Absent leaves the menu offering paper alone. */
		onpicture?: () => void;
	} = $props();

	const LABELS: Record<GraphGround, string> = {
		none: 'Plain',
		dots: 'Dots',
		lines: 'Lines'
	};
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="ghost"
				size="icon"
				class="size-9 shrink-0 rounded-full"
				aria-label="Background"
			>
				<Grid2x2 class="size-4" />
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>

	<DropdownMenu.Content align="end" class="w-44">
		<DropdownMenu.Label>Background</DropdownMenu.Label>
		<DropdownMenu.RadioGroup
			{value}
			onValueChange={(next: string) => onchange(next as GraphGround)}
		>
			{#each GRAPH_GROUNDS as ground (ground)}
				<DropdownMenu.RadioItem value={ground} class="min-h-11">
					{LABELS[ground]}
				</DropdownMenu.RadioItem>
			{/each}
		</DropdownMenu.RadioGroup>

		{#if onpicture}
			<DropdownMenu.Separator />
			<DropdownMenu.Item class="min-h-11" onSelect={onpicture}>
				<Image class="size-4" />
				{pictured ? 'Change the picture' : 'Add a picture'}
			</DropdownMenu.Item>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>
