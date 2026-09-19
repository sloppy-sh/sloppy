<script lang="ts">
	// The folders this device already knows, newest first, as the first run
	// offers them back — docs/ARCHITECTURE.md § "A graph off the device".
	import { Button } from '@sloppy/ui/button';
	import type { KnownFolder } from '../runtime.js';

	let {
		folders,
		/** The folder being opened, which is the row that says it is working. */
		opening = null,
		busy = false,
		onopen,
		/** Absent leaves a folder that is not where it was on the list, since
		 *  nothing here can take it off. */
		onforget
	}: {
		folders: KnownFolder[];
		opening?: string | null;
		busy?: boolean;
		onopen: (root: string) => void;
		onforget?: (root: string) => void;
	} = $props();

	function nameOf(folder: KnownFolder): string {
		return folder.graph?.name.trim() || folderName(folder.root);
	}

	function folderName(root: string): string {
		return root.split(/[\\/]/).filter(Boolean).at(-1) ?? root;
	}

	/** Where it is, and that the notes in it are a project's where they are. */
	function place(folder: KnownFolder): string {
		return folder.graph?.project === undefined ? folder.root : `Project · ${folder.root}`;
	}
</script>

{#if folders.length > 0}
	<ul class="space-y-1">
		{#each folders as folder (folder.root)}
			<li class="flex flex-wrap items-center gap-2">
				{#if folder.reachable}
					<button
						type="button"
						class="min-h-11 min-w-0 flex-1 rounded-md px-2 py-1 text-left text-sm hover:bg-muted"
						disabled={busy}
						aria-busy={opening === folder.root ? 'true' : undefined}
						onclick={() => onopen(folder.root)}
					>
						<span class="block truncate">{nameOf(folder)}</span>
						<span class="block truncate text-xs text-muted-foreground" title={folder.root}>
							{opening === folder.root ? 'One moment…' : place(folder)}
						</span>
					</button>
				{:else}
					<div class="min-h-11 min-w-0 flex-1 px-2 py-1 text-sm">
						<span class="block truncate">{nameOf(folder)}</span>
						<span class="block truncate text-xs text-muted-foreground" title={folder.root}>
							{folder.root}
						</span>
						<span class="block text-xs text-muted-foreground">not where it was</span>
					</div>
					{#if onforget}
						<Button
							variant="ghost"
							class="h-9 shrink-0 rounded-full text-xs text-muted-foreground"
							disabled={busy}
							aria-label={`Forget ${nameOf(folder)}`}
							onclick={() => onforget(folder.root)}
						>
							Forget
						</Button>
					{/if}
				{/if}
			</li>
		{/each}
	</ul>
{/if}
