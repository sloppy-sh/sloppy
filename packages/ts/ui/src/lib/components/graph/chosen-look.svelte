<script lang="ts">
	// One look, given to every note somebody chose. DESIGN.md § "A note's look
	// never uses colour" is why every control here is a shape.
	import {
		isUnstyled,
		MARK_SCALE_MAX,
		MARK_SCALE_MIN,
		RING_STYLES,
		RING_WEIGHTS,
		type NodeAppearance,
		type RingStyle,
		type RingWeight
	} from '@sloppy/types';
	import MarkSwatch from '../appearance/mark-swatch.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { RING_STYLE_LABELS, RING_WEIGHT_LABELS } from '../appearance/labels.js';
	import LookSlider from '../appearance/look-slider.svelte';
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

	const rings = choices(RING_WEIGHTS, RING_WEIGHT_LABELS);
	const lines = choices(RING_STYLES, RING_STYLE_LABELS);

	/** What a mark with nothing set is drawn at, which is where the size starts. */
	const PLAIN_SCALE = 1;

	let ring = $state<RingWeight>('none');
	let line = $state<RingStyle>('solid');
	let scale = $state(PLAIN_SCALE);
	let working = $state(false);

	// Mounted for the page's life, so without this it reopens holding the look
	// the last set was given — one nobody picked for these notes.
	$effect(() => {
		if (!open) return;
		ring = 'none';
		line = 'solid';
		scale = PLAIN_SCALE;
	});

	// A channel left where an unstyled note already sits says nothing, so it is
	// not written; a look with nothing in it is no look at all.
	const look = $derived.by(() => {
		const chosen: NodeAppearance = {};
		if (ring !== 'none') {
			chosen.ring_weight = ring;
			if (line !== 'solid') chosen.ring_style = line;
		}
		if (scale !== PLAIN_SCALE) chosen.mark_scale = scale;
		return isUnstyled(chosen) ? null : chosen;
	});

	function sizeTo(next: number): void {
		scale = next;
	}

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
	description={count === 1
		? 'This replaces the look it has now, including any picture on it.'
		: 'This replaces the look they have now, including any picture on them.'}
>
	<div class="space-y-5 px-2 pt-4">
		<!-- The words used to carry the size; a track does not, so the mark does. -->
		<div class="flex justify-center pb-1">
			<MarkSwatch appearance={look} size={76} />
		</div>
		{@render row('Ring', rings, ring, (v) => (ring = v as RingWeight))}
		{#if ring !== 'none'}
			{@render row('Ring style', lines, line, (v) => (line = v as RingStyle))}
			<p class="-mt-3 text-sm text-muted-foreground">A broken ring reads as a draft.</p>
		{/if}
		<LookSlider
			label="Size"
			value={scale}
			min={MARK_SCALE_MIN}
			max={MARK_SCALE_MAX}
			step={0.01}
			ondrag={sizeTo}
			onchange={sizeTo}
		/>

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
			<Button
				class="h-11 sm:h-9"
				disabled={working || look === null}
				onclick={() => void apply(look)}
			>
				{count === 1 ? 'Give it this look' : 'Give them this look'}
			</Button>
		</div>
	</div>
</ResponsiveModal>
