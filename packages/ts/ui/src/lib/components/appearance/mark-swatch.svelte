<script lang="ts">
	// A mark drawn the way the canvas draws it, so what somebody picks here is
	// what they get out there. `model.ts` in @sloppy/graph owns every fraction.
	import {
		LOOK_RING_AT,
		LOOK_RING_DASHES,
		LOOK_RING_DUTY,
		LOOK_RING_WIDTH,
		LOOK_SCALE,
		PREVIEW_AT
	} from '@sloppy/graph';
	import { type NodeAppearance, resolveAppearance } from '@sloppy/types';
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

	const grown = Math.max(...Object.values(LOOK_SCALE));
	const radius = $derived((size / 2 / grown) * LOOK_SCALE[look.markRadius]);
	const ringAt = $derived(radius * LOOK_RING_AT);
	const ringWidth = $derived(
		look.ringWeight === 'none' ? 0 : radius * LOOK_RING_WIDTH[look.ringWeight]
	);
	const turn = $derived((2 * Math.PI * ringAt) / LOOK_RING_DASHES);
	const dash = $derived(turn * LOOK_RING_DUTY);
	const half = $derived(size / 2);
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 {size} {size}"
	aria-hidden="true"
	class={cn('shrink-0', className)}
>
	<circle cx={half} cy={half} r={radius} fill="var(--graph-ink)" />
	{#if picture}
		<clipPath id={clip}>
			<circle cx={half} cy={half} r={radius * PREVIEW_AT} />
		</clipPath>
		<image
			href={picture}
			x={half - radius * PREVIEW_AT}
			y={half - radius * PREVIEW_AT}
			width={radius * PREVIEW_AT * 2}
			height={radius * PREVIEW_AT * 2}
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
			stroke-dasharray={look.ringStyle === 'dashed' ? `${dash} ${turn - dash}` : undefined}
		/>
	{/if}
</svg>
