<script lang="ts">
	// What every series carries beside the pictures themselves — DESIGN.md
	// § "A picture that takes turns". The ground under a graph and the imagery on
	// a mark both ask here, so neither can name one choice its own way.
	import {
		PICTURE_TRANSITION_LABELS,
		PICTURE_TRANSITIONS,
		PICTURE_TURNS,
		type PictureTransition
	} from '@sloppy/types';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';

	let {
		count,
		every,
		transition,
		onevery,
		ontransition
	}: {
		/** How many pictures are in the series. One is a still picture, which
		 *  neither of these says anything about, so nothing is drawn. */
		count: number;
		every: number;
		transition: PictureTransition;
		onevery: (minutes: number) => void;
		ontransition: (transition: PictureTransition) => void;
	} = $props();

	const turnLabel = $derived(
		PICTURE_TURNS.find((turn) => turn.value === every)?.label ?? PICTURE_TURNS[0].label
	);
</script>

{#if count > 1}
	<fieldset class="space-y-2">
		<legend class="mb-2 text-sm font-medium">Takes turns</legend>
		<Select.Root
			type="single"
			value={String(every)}
			onValueChange={(next: string) => onevery(Number(next))}
		>
			<Select.Trigger class="h-11 w-full">{turnLabel}</Select.Trigger>
			<Select.Content>
				{#each PICTURE_TURNS as turn (turn.value)}
					<Select.Item value={String(turn.value)} class="min-h-11">{turn.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		<p class="text-xs text-muted-foreground">
			The next one is up when you come back, never while you are reading.
		</p>
	</fieldset>

	<fieldset class="space-y-2">
		<legend class="mb-2 text-sm font-medium">How it changes</legend>
		<div class="flex flex-wrap gap-2">
			{#each PICTURE_TRANSITIONS as one (one)}
				<Button
					variant={transition === one ? 'default' : 'outline'}
					class="h-11 rounded-full"
					aria-pressed={transition === one}
					onclick={() => ontransition(one)}
				>
					{PICTURE_TRANSITION_LABELS[one]}
				</Button>
			{/each}
		</div>
	</fieldset>
{/if}
