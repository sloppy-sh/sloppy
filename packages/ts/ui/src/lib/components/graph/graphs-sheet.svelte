<script lang="ts" module>
	import type { OwnedRef } from '@sloppy/types';

	/** One of somebody's graphs, as this sheet lists it. */
	export interface GraphChoice {
		ref: OwnedRef;
		title: string;
	}
</script>

<script lang="ts">
	// The graphs a person keeps: the one they are in, the ones standing beside it
	// on the canvas, and the way to open another. DESIGN.md § "Several graphs on
	// one canvas".
	import Check from '@lucide/svelte/icons/check';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import ResponsiveModal from '../responsive-modal.svelte';

	let {
		open = $bindable(false),
		graphs,
		current,
		alsoUp,
		full = false,
		busy = false,
		says = null,
		onEnter,
		onToggle,
		onOpen,
		onRename
	}: {
		open?: boolean;
		graphs: readonly GraphChoice[];
		/** The one the reader is in, which is always on the canvas. */
		current: OwnedRef;
		/** The others standing on the canvas beside it. */
		alsoUp: ReadonlySet<OwnedRef>;
		/** No more will fit on the canvas, so putting one up means taking one down. */
		full?: boolean;
		busy?: boolean;
		/** Why the last thing asked for did not happen. */
		says?: string | null;
		onEnter: (ref: OwnedRef) => void;
		onToggle: (ref: OwnedRef) => void;
		/** Rejects with an `Error` whose `message` is already fit to show. */
		onOpen: (title: string) => Promise<void>;
		onRename: (ref: OwnedRef, title: string) => Promise<void>;
	} = $props();

	let opening = $state('');
	let naming = $state<{ ref: OwnedRef; title: string } | null>(null);
	let refused = $state<string | null>(null);
	let working = $state(false);

	function nameOf(graph: GraphChoice): string {
		return graph.title || 'Untitled';
	}

	async function act(what: () => Promise<void>): Promise<boolean> {
		if (working) return false;
		working = true;
		refused = null;
		try {
			await what();
			return true;
		} catch (error) {
			refused = error instanceof Error && error.message ? error.message : 'That did not work.';
			return false;
		} finally {
			working = false;
		}
	}

	async function openGraph(): Promise<void> {
		const title = opening.trim();
		if (title === '') return;
		if (await act(() => onOpen(title))) {
			opening = '';
			open = false;
		}
	}

	async function renameGraph(): Promise<void> {
		const asked = naming;
		if (!asked || asked.title.trim() === '') return;
		if (await act(() => onRename(asked.ref, asked.title.trim()))) naming = null;
	}
</script>

<ResponsiveModal
	bind:open
	title="Your graphs"
	description="Each one numbers its own thinking from 1."
>
	<div class="space-y-6 px-2 pt-4 pb-2">
		<ul class="space-y-1">
			{#each graphs as graph (graph.ref)}
				{@const here = graph.ref === current}
				{@const up = here || alsoUp.has(graph.ref)}
				<li class="flex items-center gap-2">
					{#if naming?.ref === graph.ref}
						<Input
							bind:value={naming.title}
							class="h-11 flex-1"
							autocomplete="off"
							aria-label="Name"
							onkeydown={(e) => {
								if (e.key !== 'Enter') return;
								e.preventDefault();
								void renameGraph();
							}}
						/>
						<Button
							variant="outline"
							class="h-11 shrink-0"
							disabled={working || naming.title.trim() === ''}
							onclick={renameGraph}
						>
							Save
						</Button>
					{:else}
						<button
							type="button"
							aria-current={here ? 'true' : undefined}
							class="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted"
							onclick={() => {
								open = false;
								onEnter(graph.ref);
							}}
						>
							<span class="w-4 shrink-0 text-muted-foreground">
								{#if here}<Check class="size-4" aria-hidden="true" />{/if}
							</span>
							<span class="min-w-0 flex-1 truncate">{nameOf(graph)}</span>
						</button>
						<Button
							variant={up ? 'secondary' : 'ghost'}
							class="h-9 shrink-0 rounded-full text-xs"
							disabled={here || busy || (full && !up)}
							aria-label={up
								? `Take ${nameOf(graph)} off the canvas`
								: `Show ${nameOf(graph)} beside this one`}
							onclick={() => onToggle(graph.ref)}
						>
							{up ? 'On the canvas' : 'Show it too'}
						</Button>
						<Button
							variant="ghost"
							size="icon"
							class="size-9 shrink-0 text-muted-foreground"
							aria-label={`Rename ${nameOf(graph)}`}
							onclick={() => {
								refused = null;
								naming = { ref: graph.ref, title: graph.title };
							}}
						>
							<Pencil class="size-4" />
						</Button>
					{/if}
				</li>
			{/each}
		</ul>

		{#if full}
			<p class="px-2 text-xs text-muted-foreground">
				That is as many as one canvas holds. Take one down to show another.
			</p>
		{/if}

		<section class="space-y-2 border-t border-border pt-4">
			<h3 class="text-sm font-medium">A new graph</h3>
			<div class="flex gap-2">
				<Input
					bind:value={opening}
					class="h-11 flex-1"
					autocomplete="off"
					placeholder="The garden"
					aria-label="Name the new graph"
					onkeydown={(e) => {
						if (e.key !== 'Enter') return;
						e.preventDefault();
						void openGraph();
					}}
				/>
				<Button
					class="h-11 shrink-0"
					disabled={working || opening.trim() === ''}
					onclick={openGraph}
				>
					<Plus class="size-4" />
					Start it
				</Button>
			</div>
		</section>

		{#if refused ?? says}
			<p class="text-sm text-destructive" role="alert">{refused ?? says}</p>
		{/if}
	</div>
</ResponsiveModal>
