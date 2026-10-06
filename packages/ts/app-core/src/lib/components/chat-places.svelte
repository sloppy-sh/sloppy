<script lang="ts">
	// The folders a thread reads besides its own project, and the two ways one is
	// added — DESIGN.md § Layout.
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '@sloppy/ui/button';
	import * as DropdownMenu from '@sloppy/ui/dropdown-menu';
	import type { KnownFolder } from '../runtime.js';
	import { seam } from '../seam.svelte.js';
	import { chat } from '../stores/chat.svelte.js';
	import { graphs, projectOf } from '../stores/graphs.svelte.js';

	const places = $derived(chat.places);
	/** The project this thread is about, and the folder in front of somebody:
	 *  neither is a place to add, because the chat already reads them. */
	const own = $derived(
		new Set(
			[chat.current?.project, graphs.openFolder, ...places.map((one) => one.root)].filter(
				(root): root is string => root !== undefined
			)
		)
	);
	const known = $derived(
		graphs.keepsFolders
			? graphs.folders.filter((folder) => folder.reachable && !own.has(folder.root))
			: []
	);
	const asksForOne = $derived(seam().askPlace() !== undefined);
	const offers = $derived(asksForOne || known.length > 0);

	function folderName(root: string): string {
		return root.split(/[\\/]/).filter(Boolean).at(-1) ?? root;
	}

	function nameOf(folder: KnownFolder): string {
		return projectOf(folder) ?? (folder.graph?.name.trim() || folderName(folder.root));
	}

	async function add(folder: KnownFolder): Promise<void> {
		await chat.addPlace({
			root: folder.root,
			name: nameOf(folder),
			...(folder.graph === undefined ? {} : { graph: folder.graph.ref })
		});
	}

	/** A folder somebody names, which this device has to be told about before it
	 *  can read anything in it. */
	async function another(): Promise<void> {
		const folder = await seam().askPlace()?.();
		if (folder !== undefined) await add(folder);
	}
</script>

{#if chat.readsPlaces && (places.length > 0 || offers)}
	<ul class="flex shrink-0 flex-wrap items-center gap-1">
		{#each places as place (place.root)}
			<li
				class="inline-flex min-w-0 items-center gap-1 rounded-md border border-border py-1 pr-1 pl-2 text-xs"
			>
				<span class="max-w-40 truncate">{place.name}</span>
				<Button
					variant="ghost"
					class="size-7 shrink-0"
					aria-label={`Stop reading ${place.name}`}
					disabled={chat.running}
					onclick={() => void chat.removePlace(place.root)}
				>
					<X class="size-3" />
				</Button>
			</li>
		{/each}
		{#if offers}
			<li>
				<DropdownMenu.Root
					onOpenChange={(open) => {
						if (open) void graphs.readFolders();
					}}
				>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								class="h-9 gap-1 px-2 text-xs text-muted-foreground"
								disabled={chat.running}
							>
								<Plus class="size-3.5" />
								Also read from…
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="start" class="w-72">
						{#each known as folder (folder.root)}
							<DropdownMenu.Item class="min-h-control" onSelect={() => void add(folder)}>
								<span class="block min-w-0 flex-1">
									<span class="block truncate">{nameOf(folder)}</span>
									<span class="block truncate text-xs text-muted-foreground">{folder.root}</span>
								</span>
							</DropdownMenu.Item>
						{/each}
						{#if asksForOne}
							{#if known.length > 0}<DropdownMenu.Separator />{/if}
							<DropdownMenu.Item class="min-h-control" onSelect={() => void another()}>
								Another folder…
							</DropdownMenu.Item>
						{/if}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</li>
		{/if}
	</ul>
{/if}
