<script lang="ts" module>
	import type { BlockDocument } from '@sloppy/types';

	/** One section of a note as each line of work left it. Absent on a side is a
	 *  line that does not have that section at all. */
	export interface SectionInTwo {
		ulid: string;
		here?: BlockDocument;
		there?: BlockDocument;
	}
</script>

<script lang="ts">
	// One note two lines of work both wrote in, settled here rather than left in
	// the note — docs/ARCHITECTURE.md § "The vault's history".
	import { SvelteSet } from 'svelte/reactivity';
	import { Button } from '$lib/components/ui/button/index.js';
	import { sectionLines } from '../publish/section-text.js';
	import ResponsiveModal from '../responsive-modal.svelte';

	let {
		open = $bindable(false),
		title,
		address = undefined,
		line,
		sections,
		busy = false,
		says = null,
		onKeepHere,
		onTakeThere,
		onSettleSections
	}: {
		open?: boolean;
		title: string;
		address?: string;
		/** The line of work being brought in. */
		line: string;
		sections: readonly SectionInTwo[];
		busy?: boolean;
		says?: string | null;
		onKeepHere: () => Promise<void>;
		onTakeThere: () => Promise<void>;
		/** The sections to take from the other line; the rest stay as they are. */
		onSettleSections: (take: ReadonlySet<string>) => Promise<void>;
	} = $props();

	const taking = new SvelteSet<string>();
	let bySection = $state(false);

	const named = $derived(title || 'Untitled');
</script>

{#snippet writing(content: BlockDocument | undefined, faded: boolean)}
	{#if !content}
		<p class="text-sm text-muted-foreground">Not in this one at all.</p>
	{:else}
		{@const written = sectionLines(content)}
		{#if written.length === 0}
			<p class="text-sm text-muted-foreground">Nothing written in it.</p>
		{:else}
			{#each written as one, at (at)}
				<p class="text-sm break-words {faded ? 'text-muted-foreground' : ''}">{one}</p>
			{/each}
		{/if}
	{/if}
{/snippet}

<ResponsiveModal
	bind:open
	title={named}
	description="You and {line} both wrote in this note. Choose what it says."
>
	<div class="space-y-6 px-2 pt-4 pb-2">
		{#if address}
			<p class="text-sm text-muted-foreground">
				<span class="address">{address}</span>
			</p>
		{/if}

		{#if !bySection}
			<div class="space-y-2">
				<Button
					variant="outline"
					class="h-11 w-full"
					disabled={busy}
					onclick={() => void onKeepHere()}
				>
					Keep what is here
				</Button>
				<Button
					variant="outline"
					class="h-11 w-full"
					disabled={busy}
					onclick={() => void onTakeThere()}
				>
					Take {line}'s
				</Button>
				{#if sections.length > 0}
					<Button variant="ghost" class="h-11 w-full" onclick={() => (bySection = true)}>
						Choose section by section
					</Button>
				{/if}
			</div>
		{:else}
			<ul class="space-y-6">
				{#each sections as section (section.ulid)}
					{@const takes = taking.has(section.ulid)}
					<li class="space-y-2">
						<div class="grid gap-3 sm:grid-cols-2">
							<div class="space-y-1 border-l-2 pl-3 {takes ? 'border-border' : 'border-primary'}">
								<p class="text-xs text-muted-foreground">here</p>
								{@render writing(section.here, takes)}
							</div>
							<div class="space-y-1 border-l-2 pl-3 {takes ? 'border-primary' : 'border-border'}">
								<p class="text-xs text-muted-foreground">{line}</p>
								{@render writing(section.there, !takes)}
							</div>
						</div>
						<div class="flex gap-2">
							<Button
								variant={takes ? 'ghost' : 'secondary'}
								class="h-9 flex-1 rounded-full text-xs"
								aria-pressed={!takes}
								onclick={() => taking.delete(section.ulid)}
							>
								Keep this one
							</Button>
							<Button
								variant={takes ? 'secondary' : 'ghost'}
								class="h-9 flex-1 rounded-full text-xs"
								aria-pressed={takes}
								onclick={() => taking.add(section.ulid)}
							>
								Take {line}'s
							</Button>
						</div>
					</li>
				{/each}
			</ul>
			<Button
				class="h-11 w-full"
				disabled={busy}
				onclick={() => void onSettleSections(new Set(taking))}
			>
				Settle this note
			</Button>
		{/if}

		{#if says}
			<p class="text-sm text-destructive" role="alert">{says}</p>
		{/if}
	</div>
</ResponsiveModal>
