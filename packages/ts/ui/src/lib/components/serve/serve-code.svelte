<script lang="ts">
	// A pairing code, drawn to be read across a room and typed into a headset,
	// with how long it has left.
	import { cn } from '$lib/utils.js';

	let {
		code,
		until,
		class: className
	}: {
		code: string;
		/** When it stops being accepted, in milliseconds since the epoch. */
		until: number;
		class?: string;
	} = $props();

	let now = $state(Date.now());

	$effect(() => {
		const ticking = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(ticking);
	});

	const halves = $derived([
		code.slice(0, Math.ceil(code.length / 2)),
		code.slice(Math.ceil(code.length / 2))
	]);
	const left = $derived(Math.max(0, Math.ceil((until - now) / 1000)));
	const shownLeft = $derived(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`);
</script>

<div class={cn('space-y-1', className)}>
	<p class="select-text">
		<span class="sr-only">{[...code].join(' ')}</span>
		<span
			aria-hidden="true"
			class="flex gap-[0.6em] font-mono text-5xl font-semibold tracking-[0.25em] text-foreground tabular-nums sm:text-6xl"
		>
			{#each halves as half, at (at)}<span>{half}</span>{/each}
		</span>
	</p>
	<p class="text-xs text-muted-foreground tabular-nums">{shownLeft} left</p>
</div>
