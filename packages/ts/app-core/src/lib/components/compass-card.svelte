<script lang="ts">
	// What a note is part of, made of, like, and what was chosen instead —
	// DESIGN.md § "The compass card".
	import {
		COMPASS_DIRECTIONS,
		type Compass,
		type CompassDirection,
		type NodeView,
		type OwnedRef
	} from '@sloppy/types';
	import { COMPASS_WORDS } from '@sloppy/ui';
	import { nodes } from '../stores/nodes.svelte.js';

	let {
		note,
		compass,
		onOpen
	}: {
		note: Pick<NodeView, 'title' | 'address'>;
		compass: Compass;
		onOpen: (note: OwnedRef) => void;
	} = $props();

	/** The notes a slot points at, each as it stands now — a note is renamed
	 *  after it is cited. Null is one this reader cannot reach. */
	const cited = $derived(
		Object.fromEntries(
			COMPASS_DIRECTIONS.map((direction) => [
				direction,
				compass[direction].map((ref) => ({ ref, note: nodes.get(ref) ?? null }))
			])
		) as Record<CompassDirection, { ref: OwnedRef; note: NodeView | null }[]>
	);

	$effect(() => {
		for (const direction of COMPASS_DIRECTIONS) {
			for (const ref of compass[direction]) {
				// A note this reader cannot reach is drawn as a note and nothing more.
				if (!nodes.get(ref)) void nodes.fetch(ref).catch(() => {});
			}
		}
	});

	const at: Record<CompassDirection, string> = {
		north: '@md:col-start-2 @md:row-start-1',
		south: '@md:col-start-2 @md:row-start-3',
		east: '@md:col-start-3 @md:row-start-2',
		west: '@md:col-start-1 @md:row-start-2'
	};
</script>

<!-- Container query, never `sm:`: the room the card lays out in is the reading
     surface's, not the window's. -->
<section class="@container" aria-label="Compass">
	<div class="grid grid-cols-1 gap-x-4 gap-y-3 @md:grid-cols-3 @md:items-start">
		<div
			class="min-w-0 rounded-lg border border-border px-3 py-2 @md:col-start-2 @md:row-start-2 @md:text-center"
		>
			{#if note.address}
				<span class="address text-sm text-muted-foreground">{note.address}</span>
			{/if}
			<p class="text-sm font-medium break-words">{note.title || 'Untitled'}</p>
		</div>

		{#each COMPASS_DIRECTIONS as direction (direction)}
			{@const words = COMPASS_WORDS[direction]}
			<section class={`min-w-0 ${at[direction]}`} aria-label={words.word}>
				<h3 class="text-xs font-medium text-muted-foreground">{words.word}</h3>
				{#if cited[direction].length > 0}
					<ul class="mt-0.5 space-y-0.5">
						{#each cited[direction] as one (one.ref)}
							<li>
								<button
									type="button"
									class="-mx-2 flex min-h-9 w-full items-baseline gap-2 rounded-md px-2 text-left transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
									onclick={() => onOpen(one.ref)}
								>
									{#if one.note?.address}
										<span class="address shrink-0 text-sm text-muted-foreground">
											{one.note.address}
										</span>
									{/if}
									<span class="min-w-0 flex-1 truncate">
										{one.note ? one.note.title || 'Untitled' : 'A note'}
									</span>
								</button>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="mt-0.5 text-sm text-muted-foreground">{words.asks}</p>
				{/if}
			</section>
		{/each}
	</div>
</section>
