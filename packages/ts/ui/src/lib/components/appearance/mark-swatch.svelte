<script lang="ts">
	// A mark drawn the way the canvas draws it, so what somebody picks here is
	// what they get out there. `model.ts` in @sloppy/graph owns every fraction.
	import { FILL_AT, LOOK_RING_AT, LOOK_RING_BREAK, LOOK_RING_WIDTH } from '@sloppy/graph';
	import { MARK_SCALE_MAX, type NodeAppearance, resolveAppearance } from '@sloppy/types';
	import { cn } from '$lib/utils.js';

	let {
		appearance = null,
		picture = null,
		size = 40,
		class: className
	}: {
		appearance?: NodeAppearance | null;
		/** Already resolved for an `<img>`. A note's picture is private, so this
		 *  never reaches for one itself. */
		picture?: string | null;
		/** Box the mark is drawn in; the largest look fills it. */
		size?: number;
		class?: string;
	} = $props();

	const clip = $props.id();
	const look = $derived(resolveAppearance(appearance));

	/** The box holds the whole size channel, so the largest mark fills it and
	 *  everything below reads as the share of it the canvas will draw. */
	const radius = $derived(((size / 2) * look.markScale) / MARK_SCALE_MAX);
	const ringAt = $derived(radius * LOOK_RING_AT);
	const ringWidth = $derived(
		look.ringWeight === 'none' ? 0 : radius * LOOK_RING_WIDTH[look.ringWeight]
	);
	const covered = $derived(radius * look.previewCover);
	/** The ring's gaps as SVG asks for them — one mark and the gap after it. */
	const gaps = $derived.by(() => {
		const { dashes, duty } = LOOK_RING_BREAK[look.ringStyle];
		if (dashes === 0) return undefined;
		const turn = (2 * Math.PI * ringAt) / dashes;
		return `${turn * duty} ${turn * (1 - duty)}`;
	});
	const half = $derived(size / 2);
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 {size} {size}"
	aria-hidden="true"
	class={cn('shrink-0', className)}
>
	<circle cx={half} cy={half} r={radius * FILL_AT} fill="var(--graph-ink)" />
	{#if picture}
		<clipPath id={clip}>
			<circle cx={half} cy={half} r={covered} />
		</clipPath>
		<image
			href={picture}
			x={half - covered}
			y={half - covered}
			width={covered * 2}
			height={covered * 2}
			preserveAspectRatio="xMidYMid slice"
			clip-path="url(#{clip})"
		/>
	{/if}
	{#if ringWidth > 0}
		<circle
			cx={half}
			cy={half}
			r={ringAt}
			fill="none"
			stroke="var(--graph-paper)"
			stroke-width={ringWidth}
			stroke-dasharray={gaps}
		/>
	{/if}
</svg>
