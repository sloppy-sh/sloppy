<script lang="ts">
	// One look, given to every note somebody chose. DESIGN.md § "A note's look
	// never uses colour" is why every control here is a shape.
	import {
		isUnstyled,
		MARK_RADII,
		RING_STYLES,
		RING_WEIGHTS,
		type MarkRadius,
		type NodeAppearance,
		type RingStyle,
		type RingWeight
	} from '@sloppy/types';
	import { Button } from '$lib/components/ui/button/index.js';
	import ResponsiveModal from '../responsive-modal.svelte';

	let {
		open = $bindable(false),
		count,
		refused = null,
		onapply
	}: {
		open?: boolean;
		count: number;
		/** Why the last attempt did not land, in the caller's words. */
		refused?: string | null;
		onapply: (look: NodeAppearance | null) => void | Promise<void>;
	} = $props();

	const choices = <T extends string>(values: readonly T[], words: Record<T, string>) =>
		values.map((value) => ({ value, word: words[value] }));

	const rings = choices(RING_WEIGHTS, {
		none: 'No ring',
		hairline: 'Hairline',
		regular: 'Regular',
		heavy: 'Heavy'
	} satisfies Record<RingWeight, string>);
	const lines = choices(RING_STYLES, {
		solid: 'Solid',
		dashed: 'Dashed'
	} satisfies Record<RingStyle, string>);
	const sizes = choices(MARK_RADII, {
		small: 'Small',
		regular: 'Regular',
		large: 'Large'
	} satisfies Record<MarkRadius, string>);

	let ring = $state<RingWeight>('none');
	let line = $state<RingStyle>('solid');
	let size = $state<MarkRadius>('regular');
	let working = $state(false);

	// A channel left where an unstyled note already sits says nothing, so it is
	// not written; a look with nothing in it is no look at all.
	const look = $derived.by(() => {
		const chosen: NodeAppearance = {};
		if (ring !== 'none') {
			chosen.ring_weight = ring;
			if (line !== 'solid') chosen.ring_style = line;
		}
		if (size !== 'regular') chosen.mark_radius = size;
		return isUnstyled(chosen) ? null : chosen;
	});

	async function apply(next: NodeAppearance | null): Promise<void> {
		working = true;
		try {
			await onapply(next);
			open = false;
		} catch {
			// Left open, so the same button tries again; `refused` is what to say.
		} finally {
			working = false;
		}
	}
</script>

{#snippet row(
	label: string,
	choices: { value: string; word: string }[],
	held: string,
	pick: (value: string) => void
)}
	<fieldset class="space-y-2">
		<legend class="text-sm font-medium">{label}</legend>
		<div class="flex flex-wrap gap-2">
			{#each choices as choice (choice.value)}
				<Button
					variant={choice.value === held ? 'default' : 'outline'}
					class="h-11 rounded-full"
					aria-pressed={choice.value === held}
					onclick={() => pick(choice.value)}
				>
					{choice.word}
				</Button>
			{/each}
		</div>
	</fieldset>
{/snippet}

<ResponsiveModal
	bind:open
	title={count === 1 ? 'Give this note a look' : `Give ${count} notes a look`}
	description="This replaces whatever look they have."
>
	<div class="space-y-5 px-2 pt-4">
		{@render row('Ring', rings, ring, (v) => (ring = v as RingWeight))}
		{#if ring !== 'none'}
			{@render row('Ring line', lines, line, (v) => (line = v as RingStyle))}
			<p class="-mt-3 text-sm text-muted-foreground">A dashed ring reads as a draft.</p>
		{/if}
		{@render row('Size', sizes, size, (v) => (size = v as MarkRadius))}

		{#if refused}
			<p class="text-sm text-destructive" role="alert">{refused}</p>
		{/if}

		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
			<Button
				variant="ghost"
				class="h-11 sm:h-9"
				disabled={working}
				onclick={() => void apply(null)}
			>
				Take the look off
			</Button>
			<Button
				variant="outline"
				class="h-11 sm:h-9"
				disabled={working}
				onclick={() => (open = false)}
			>
				Cancel
			</Button>
			<Button class="h-11 sm:h-9" disabled={working} onclick={() => void apply(look)}>
				Give them this look
			</Button>
		</div>
	</div>
</ResponsiveModal>
