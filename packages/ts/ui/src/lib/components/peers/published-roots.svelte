<script lang="ts">
	// What one identity publishes on one instance: a branch to take, under the
	// notebook it sits in, cited by the address a peer resolves where its author
	// gave it one and read by its title where they did not.
	import Download from '@lucide/svelte/icons/download';
	import type { OwnedRef, PublishedPublication } from '@sloppy/types';
	import { Button } from '$lib/components/ui/button/index.js';
	import { byNotebook } from './notebooks.js';

	let {
		publications,
		nextCursor = undefined,
		busy = false,
		held = new Set<OwnedRef>(),
		onpull,
		onmore
	}: {
		publications: readonly PublishedPublication[];
		nextCursor?: string;
		busy?: boolean;
		/** The ones the reader already holds a copy of. */
		held?: ReadonlySet<OwnedRef>;
		onpull: (publication: OwnedRef) => void;
		onmore: (cursor: string) => void;
	} = $props();

	const notebooks = $derived(
		byNotebook(
			publications,
			(branch) => ({ graph: branch.graph, notebook: branch.graph_title }),
			'A notebook they did not name'
		)
	);
</script>

{#if publications.length === 0}
	<p class="px-1 py-2 text-sm text-muted-foreground">They publish nothing here.</p>
{:else}
	{#each notebooks as notebook (notebook.key)}
		<section class="space-y-1">
			{#if notebooks.length > 1}
				<h4 class="px-1 pt-2 text-xs font-medium text-muted-foreground">{notebook.title}</h4>
			{/if}
			<ul class="space-y-1">
				{#each notebook.rows as branch (branch.ref)}
					<li class="flex items-center gap-3 py-1">
						<span class="min-w-6 shrink-0 address">{branch.root_address ?? ''}</span>
						<span class="min-w-0 flex-1 truncate text-sm">{branch.title || 'Untitled'}</span>
						<Button
							variant="ghost"
							class="h-9 shrink-0 rounded-full"
							disabled={busy}
							onclick={() => onpull(branch.ref)}
						>
							<Download class="size-4" />
							{held.has(branch.ref) ? 'Read again' : 'Read it'}
						</Button>
					</li>
				{/each}
			</ul>
		</section>
	{/each}

	{#if nextCursor !== undefined}
		<Button
			variant="ghost"
			class="h-9 w-full rounded-full"
			disabled={busy}
			onclick={() => onmore(nextCursor)}
		>
			Show more
		</Button>
	{/if}
{/if}
