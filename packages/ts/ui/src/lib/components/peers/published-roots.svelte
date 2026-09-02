<script lang="ts">
	// What one identity publishes on one instance: a branch to take, cited by the
	// address a peer resolves.
	import Download from '@lucide/svelte/icons/download';
	import type { PublishedRoot } from '@sloppy/types';
	import { Button } from '$lib/components/ui/button/index.js';

	let {
		roots,
		nextCursor = undefined,
		busy = false,
		held = new Set<string>(),
		onpull,
		onmore
	}: {
		roots: readonly PublishedRoot[];
		nextCursor?: string;
		busy?: boolean;
		/** Root addresses the reader already holds a region of. */
		held?: ReadonlySet<string>;
		onpull: (rootAddress: string) => void;
		onmore: (cursor: string) => void;
	} = $props();
</script>

{#if roots.length === 0}
	<p class="px-1 py-2 text-sm text-muted-foreground">They publish nothing here.</p>
{:else}
	<ul class="space-y-1">
		{#each roots as root (root.root_address)}
			<li class="flex items-center gap-3 py-1">
				<span class="shrink-0 address">{root.root_address}</span>
				<span class="min-w-0 flex-1 truncate text-sm">{root.title || 'Untitled'}</span>
				<Button
					variant="ghost"
					class="h-9 shrink-0 rounded-full"
					disabled={busy}
					onclick={() => onpull(root.root_address)}
				>
					<Download class="size-4" />
					{held.has(root.root_address) ? 'Read again' : 'Read it'}
				</Button>
			</li>
		{/each}
	</ul>

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
