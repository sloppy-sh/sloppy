<script lang="ts">
	// How full the assistant's context is, drawn from what it reports —
	// DESIGN.md § "The context as a bar".
	import type { ContextUsage } from '@sloppy/types';
	import { tokensSaid } from '../chat-said.js';
	import {
		barOf,
		contextSaid,
		fillSaid,
		keptSpans,
		LIGHT_OPACITY,
		shareSaid,
		spans
	} from './context-chart.js';

	let {
		usage,
		open = $bindable(false),
		onOpenChange
	}: {
		/** What the assistant says it is holding; null is one that has not said. */
		usage: ContextUsage | null;
		/** Whether the bands are listed under the bar. */
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
	} = $props();

	const BAR_REM = 0.75;
	/** The mark stands past the bar so it reads against the page rather than
	 *  against whichever band it crosses. */
	const MARK_OVERHANG_REM = 0.1875;
	const CORNER_REM = 0.375;

	let box = $state.raw<HTMLElement | null>(null);
	let across = $state(0);
	let rootPx = $state(16);
	function readRootPx(): void {
		const said = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
		rootPx = Number.isFinite(said) && said > 0 ? said : 16;
	}
	$effect(() => {
		readRootPx();
		window.addEventListener('resize', readRootPx);
		return () => window.removeEventListener('resize', readRootPx);
	});
	$effect(() => {
		const held = box;
		if (!held) return;
		const measure = () => (across = held.offsetWidth);
		measure();
		const watching = new ResizeObserver(measure);
		watching.observe(held);
		return () => watching.disconnect();
	});

	const clip = $props.id();
	const bar = $derived(usage === null ? null : barOf(usage));
	const wide = $derived(Math.max(across, 1));
	const tall = $derived(BAR_REM * rootPx);
	const over = $derived(MARK_OVERHANG_REM * rootPx);
	const high = $derived(tall + over * 2);
	const bands = $derived(bar === null ? [] : spans(bar, wide));
	const kept = $derived(bar === null ? [] : keptSpans(bar, wide));
	const mark = $derived(
		bar === null || bar.compactsAt === undefined
			? null
			: Math.min(Math.max((bar.compactsAt / bar.limit) * wide, 0), wide)
	);
	const sentence = $derived(bar === null ? '' : contextSaid(bar));

	function toggle(): void {
		open = !open;
		onOpenChange?.(open);
	}
</script>

{#snippet drawing()}
	<svg
		class="block w-full"
		width={wide}
		height={high}
		viewBox="0 0 {wide} {high}"
		role="img"
		aria-label={sentence}
	>
		<defs>
			<clipPath id={clip}>
				<rect x="0" y={over} width={wide} height={tall} rx={CORNER_REM * rootPx} />
			</clipPath>
		</defs>
		<g clip-path="url(#{clip})">
			{#each bands as span, at (at)}
				<rect
					class={span.band.hue ?? 'text-muted-foreground'}
					data-band={span.band.name}
					x={span.from}
					y={over}
					width={span.width}
					height={tall}
					fill="currentColor"
					opacity={span.band.light ? LIGHT_OPACITY : 1}
				/>
			{/each}
			{#each kept as span, at (at)}
				<rect
					class={span.band.hue}
					data-kept={span.band.name}
					x={span.from}
					y={over}
					width={span.width}
					height={tall}
					fill="currentColor"
					opacity={span.band.light ? LIGHT_OPACITY : 1}
				/>
			{/each}
		</g>
		<rect
			class="text-border"
			x="0.5"
			y={over + 0.5}
			width={Math.max(wide - 1, 0)}
			height={Math.max(tall - 1, 0)}
			rx={CORNER_REM * rootPx}
			fill="none"
			stroke="currentColor"
		/>
		{#if mark !== null}
			<line
				class="text-primary-mark"
				data-compacts-at={bar?.compactsAt}
				x1={mark}
				y1="0"
				x2={mark}
				y2={high}
				stroke="currentColor"
				stroke-width="1"
			>
				<title>Compacts here</title>
			</line>
		{/if}
	</svg>
{/snippet}

{#if bar !== null}
	<div bind:this={box} class="flex min-w-0 flex-col gap-1">
		{#if bar.bands.length > 0}
			<button
				type="button"
				class="flex min-h-control w-full items-center rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
				aria-expanded={open}
				onclick={toggle}
			>
				{@render drawing()}
			</button>
		{:else}
			<div class="flex min-h-control w-full items-center">{@render drawing()}</div>
		{/if}

		<p class="text-xs text-muted-foreground">{fillSaid(bar)}</p>
		{#if bar.compactedFrom !== undefined}
			<p class="text-xs text-muted-foreground">Compacted from {tokensSaid(bar.compactedFrom)}</p>
		{/if}

		{#if open && bar.bands.length > 0}
			<ul class="flex flex-col gap-0.5 text-xs" aria-label="What the assistant is holding">
				{#each [...bar.bands, ...bar.kept] as band, at (at)}
					<li class="flex min-w-0 items-center gap-2">
						<span
							class="size-2 shrink-0 rounded-[2px] bg-current {band.hue ?? 'text-muted-foreground'}"
							style={band.light ? `opacity:${LIGHT_OPACITY}` : undefined}
							aria-hidden="true"
						></span>
						<span class="min-w-0 flex-1 truncate">{band.name}</span>
						<span class="shrink-0 tabular-nums text-muted-foreground">
							{tokensSaid(band.tokens)}
						</span>
						<span class="w-9 shrink-0 text-right tabular-nums text-muted-foreground">
							{shareSaid(band.tokens, bar.limit)}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}
