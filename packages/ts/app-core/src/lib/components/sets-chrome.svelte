<script lang="ts">
	// What the canvas has to say about the sets it is drawing, and the way into
	// them from nothing — DESIGN.md § "Sets — the tags as places". Nothing at all
	// where the question the rail asks is already a diagram.
	import { DRAWN_SETS_MOST } from '@sloppy/graph';
	import { Button } from '@sloppy/ui/button';

	/** The count as a reader reads it, so the line cannot say four where the
	 *  canvas draws three. */
	const WORDS: Record<number, string> = {
		2: 'two',
		3: 'three',
		4: 'four',
		5: 'five',
		6: 'six',
		7: 'seven',
		8: 'eight'
	};
	const most = WORDS[DRAWN_SETS_MOST] ?? String(DRAWN_SETS_MOST);

	let {
		selected,
		onStart
	}: {
		/** How many tags the reader has selected. */
		selected: number;
		/** Select the most-carried tags for them. Absent where this graph has no
		 *  tags to start from. */
		onStart?: (() => void) | undefined;
	} = $props();
</script>

{#if selected === 0 || selected > DRAWN_SETS_MOST}
	<!-- DESIGN.md § "The four inset vars": it floats over a pannable field, so it
	     clears the system bar and the bar over a chosen set both. -->
	<div
		style="bottom: calc(var(--sysnav-clearance) + var(--chosen-bar-inset-bottom, 0px) + 0.5rem)"
		class="pointer-events-none absolute inset-x-0 z-20 flex justify-center px-3 sm:px-6"
	>
		<div
			class="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-2xl border bg-card/90 px-3 py-1 shadow-sm backdrop-blur"
		>
			{#if selected === 0}
				<p class="text-sm text-muted-foreground" role="status">Choose tags to draw them as sets.</p>
				{#if onStart}
					<Button variant="ghost" class="h-9 shrink-0 rounded-full text-sm" onclick={onStart}>
						Start with the three most used
					</Button>
				{/if}
			{:else}
				<p class="text-sm text-muted-foreground" role="status">The first {most} are drawn.</p>
			{/if}
		</div>
	</div>
{/if}
