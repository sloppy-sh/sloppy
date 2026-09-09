<script lang="ts">
	// What the canvas draws two states as, in words the picture cannot carry —
	// DESIGN.md § "A difference between two states". Ink only: hue on this page
	// is the tag question's, and a swatch here would take that answer away.
</script>

{#snippet band(broken: boolean, mark: boolean)}
	<svg class="size-4 shrink-0 text-graph-ink" viewBox="0 0 16 16" fill="none" aria-hidden="true">
		<circle
			cx="8"
			cy="8"
			r="6.5"
			stroke="currentColor"
			stroke-opacity="0.9"
			stroke-width="2.4"
			stroke-dasharray={broken ? '2.8 2.3' : undefined}
		/>
		{#if mark}
			<circle cx="8" cy="8" r="3" fill="currentColor" />
		{/if}
	</svg>
{/snippet}

<ul aria-label="What the graph is drawing" class="space-y-1">
	<li class="flex items-center gap-2 text-xs text-muted-foreground">
		{@render band(false, true)}
		<span>A new note</span>
	</li>
	<li class="flex items-center gap-2 text-xs text-muted-foreground">
		{@render band(false, false)}
		<span>A note that went, where it stood</span>
	</li>
	<li class="flex items-center gap-2 text-xs text-muted-foreground">
		{@render band(true, true)}
		<span>A note that is not as it was</span>
	</li>
	<li class="flex items-center gap-2 text-xs text-muted-foreground">
		<svg class="size-4 shrink-0 text-graph-ink" viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<line
				x1="1.5"
				y1="5.5"
				x2="14.5"
				y2="5.5"
				stroke="currentColor"
				stroke-opacity="0.9"
				stroke-width="1.8"
			/>
			<line
				x1="1.5"
				y1="10.5"
				x2="14.5"
				y2="10.5"
				stroke="currentColor"
				stroke-opacity="0.4"
				stroke-width="1.8"
			/>
		</svg>
		<span>A note that moved: the line it joined, over the one it left</span>
	</li>
</ul>
