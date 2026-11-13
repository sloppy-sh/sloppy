<script lang="ts">
	// Which lines the canvas draws, by what they are — DESIGN.md § Edges, "Lines a
	// reader can turn off".
	import { FIELD_SPREAD, type GraphHiddenLines, type GraphLines } from '@sloppy/graph';
	import { Slider } from '$lib/components/ui/slider/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { cn } from '$lib/utils.js';
	import {
		EDGE_KIND_LABELS,
		kindRows,
		labelRows,
		labelSaid,
		withKind,
		withLabels
	} from './lines.js';

	let {
		lines,
		hidden,
		onchange,
		bundle,
		onbundle,
		spread,
		onspread,
		class: className
	}: {
		lines: GraphLines;
		hidden: GraphHiddenLines;
		onchange: (next: GraphHiddenLines) => void;
		/** Whether hand links are bundled along the tree, and how tightly in
		 *  [0, 1] — DESIGN.md § Edges, "Bundled along the tree". */
		bundle: { on: boolean; strength: number };
		onbundle: (next: { on: boolean; strength: number }) => void;
		/** The room between the marks, in {@link FIELD_SPREAD} — DESIGN.md § Edges,
		 *  "Room between marks". */
		spread: number;
		onspread: (next: number) => void;
		class?: string;
	} = $props();

	const uid = $props.id();
	const kinds = $derived(kindRows(lines, hidden));
	const labels = $derived(labelRows(lines, hidden));
	const handsOn = $derived(!hidden.kinds.has('link'));
	const anyHands = $derived(kinds.some((one) => one.kind === 'link'));
	const allOn = $derived(labels.every((row) => row.on));
	const allOff = $derived(labels.every((row) => !row.on));

	const row = 'flex min-h-control items-center gap-3 rounded-lg px-2 text-sm';
	const quiet =
		'rounded-full px-2.5 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50';
</script>

<div role="group" aria-label="Lines" class={cn('flex min-h-0 flex-col gap-0.5', className)}>
	{#if kinds.length === 0}
		<p class="px-2 py-2 text-sm text-muted-foreground">No lines on the canvas.</p>
	{/if}
	{#each kinds as one (one.kind)}
		{@const id = `${uid}-${one.kind}`}
		<label for={id} class={row}>
			<span class={cn('min-w-0 flex-1 truncate', !one.on && 'text-muted-foreground')}>
				{EDGE_KIND_LABELS[one.kind]}
			</span>
			<span class="text-xs text-muted-foreground">{one.count.toLocaleString()}</span>
			<Switch
				{id}
				checked={one.on}
				onCheckedChange={(on) => onchange(withKind(hidden, one.kind, on))}
			/>
		</label>
		{#if one.kind === 'link' && labels.length > 0}
			<div class="ms-3 flex min-h-0 flex-col gap-0.5 border-s border-border ps-1">
				<div class="flex items-center justify-end gap-1 px-1">
					<button
						type="button"
						class={quiet}
						disabled={!handsOn || allOn}
						onclick={() => onchange(withLabels(hidden, lines.labels.keys(), true))}
					>
						Show all
					</button>
					<button
						type="button"
						class={quiet}
						disabled={!handsOn || allOff}
						onclick={() => onchange(withLabels(hidden, lines.labels.keys(), false))}
					>
						Hide all
					</button>
				</div>
				{#each labels as relation, at (relation.label)}
					{@const id = `${uid}-label-${at}`}
					<label for={id} class={cn(row, !handsOn && 'opacity-50')}>
						<span
							class={cn(
								'min-w-0 flex-1 truncate',
								(!relation.on || relation.label === '') && 'text-muted-foreground'
							)}
						>
							{labelSaid(relation.label)}
						</span>
						<span class="text-xs text-muted-foreground">{relation.count.toLocaleString()}</span>
						<Switch
							{id}
							checked={relation.on}
							disabled={!handsOn}
							onCheckedChange={(on) => onchange(withLabels(hidden, [relation.label], on))}
						/>
					</label>
				{/each}
			</div>
		{/if}
	{/each}
	{#if anyHands}
		<div class="mt-1 flex flex-col gap-0.5 border-t border-border pt-1">
			<label for="{uid}-bundle" class={cn(row, !handsOn && 'opacity-50')}>
				<span class="min-w-0 flex-1 truncate">Bundle</span>
				<Switch
					id="{uid}-bundle"
					checked={bundle.on}
					disabled={!handsOn}
					onCheckedChange={(on) => onbundle({ on, strength: bundle.strength })}
				/>
			</label>
			{#if bundle.on}
				<div class={cn(row, 'gap-4', !handsOn && 'opacity-50')}>
					<span class="shrink-0">How tightly</span>
					<Slider
						type="single"
						min={0}
						max={1}
						step={0.05}
						value={bundle.strength}
						label="How tightly"
						disabled={!handsOn}
						class="h-control min-w-0 flex-1"
						onValueChange={(strength: number) => onbundle({ on: bundle.on, strength })}
					/>
				</div>
			{/if}
		</div>
	{/if}
	<div class={cn(row, 'mt-1 gap-4 border-t border-border pt-1')}>
		<span class="shrink-0">Room between marks</span>
		<Slider
			type="single"
			min={FIELD_SPREAD.least}
			max={FIELD_SPREAD.most}
			step={0.05}
			value={spread}
			label="Room between marks"
			class="h-control min-w-0 flex-1"
			onValueChange={(next: number) => onspread(next)}
		/>
	</div>
</div>
