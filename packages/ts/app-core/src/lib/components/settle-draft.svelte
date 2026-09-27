<script lang="ts">
	// What your folder and the draft say differently about one note, chosen
	// between before either is written — docs/ARCHITECTURE.md § "A graph on
	// disk". The choices are the import's, because a draft settles by the rule
	// an archive of the same graph settles by.
	import type { ImportConflict, ImportResolution, ImportSide } from '@sloppy/types';
	import { Button } from '@sloppy/ui/button';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { conflictHeading, settlingSaid, type DraftNote } from '../draft-said.js';

	let {
		conflicts,
		named,
		busy = false,
		onchange
	}: {
		conflicts: readonly ImportConflict[];
		named: ReadonlyMap<string, DraftNote>;
		busy?: boolean;
		/** Everything settled so far, in the order the disagreements were given. */
		onchange: (settled: readonly ImportResolution[]) => void;
	} = $props();

	// Keyed by position: one note can be in two disagreements at once, its
	// writing and the number it carries.
	const side = new SvelteMap<number, ImportSide>();
	const perSection = new SvelteMap<string, ImportSide>();
	const sectioned = new SvelteSet<number>();

	const sectionKey = (at: number, section: string) => `${at}:${section}`;

	function settled(conflict: ImportConflict, at: number): ImportResolution | null {
		if (sectioned.has(at)) {
			const sections: { section: string; keep: ImportSide }[] = [];
			for (const { section } of conflict.sections) {
				const keep = perSection.get(sectionKey(at, section));
				if (!keep) return null;
				sections.push({ section, keep });
			}
			// What the sections do not name stays as the folder has it, which is
			// what the review promises about the writing only it holds.
			return { kind: conflict.kind, ref: conflict.ref, keep: 'mine', sections };
		}
		const keep = side.get(at);
		if (!keep) return null;
		return { kind: conflict.kind, ref: conflict.ref, keep, sections: [] };
	}

	const resolutions = $derived(
		conflicts
			.map((conflict, at) => settled(conflict, at))
			.filter((one): one is ImportResolution => one !== null)
	);

	$effect(() => onchange(resolutions));
</script>

{#snippet writing(words: string, faded: boolean)}
	{#if words.trim() === ''}
		<p class="text-sm text-muted-foreground">Nothing written in it.</p>
	{:else}
		<p class="text-sm break-words {faded ? 'text-muted-foreground' : ''}">{words}</p>
	{/if}
{/snippet}

{#snippet twoWays(mine: string, theirs: string, taken: ImportSide | undefined)}
	<div class="grid gap-3 sm:grid-cols-2">
		<div class="space-y-1 border-l-2 pl-3 {taken === 'mine' ? 'border-primary' : 'border-border'}">
			<p class="text-xs text-muted-foreground">here</p>
			{@render writing(mine, taken === 'theirs')}
		</div>
		<div
			class="space-y-1 border-l-2 pl-3 {taken === 'theirs' ? 'border-primary' : 'border-border'}"
		>
			<p class="text-xs text-muted-foreground">in the draft</p>
			{@render writing(theirs, taken === 'mine')}
		</div>
	</div>
{/snippet}

<ul class="space-y-8">
	{#each conflicts as conflict, at (at)}
		{@const bySection = sectioned.has(at)}
		{@const taken = bySection ? undefined : side.get(at)}
		<li class="space-y-2">
			<p class="text-sm font-medium break-words">{conflictHeading(conflict, named)}</p>
			<p class="text-sm text-muted-foreground">{settlingSaid(conflict)}</p>

			{#if !bySection}
				{@render twoWays(conflict.mine, conflict.theirs, taken)}
				<div class="flex gap-2">
					<Button
						variant={taken === 'mine' ? 'secondary' : 'ghost'}
						class="h-9 flex-1 rounded-full text-xs"
						aria-pressed={taken === 'mine'}
						disabled={busy}
						onclick={() => side.set(at, 'mine')}
					>
						{conflict.kind === 'address' ? 'The note here keeps it' : 'Keep what is here'}
					</Button>
					<Button
						variant={taken === 'theirs' ? 'secondary' : 'ghost'}
						class="h-9 flex-1 rounded-full text-xs"
						aria-pressed={taken === 'theirs'}
						disabled={busy}
						onclick={() => side.set(at, 'theirs')}
					>
						{conflict.kind === 'address' ? "The draft's note keeps it" : "Take the draft's"}
					</Button>
				</div>
				{#if conflict.sections.length > 0}
					<Button
						variant="ghost"
						class="h-9 w-full text-xs"
						disabled={busy}
						onclick={() => {
							side.delete(at);
							sectioned.add(at);
						}}
					>
						Choose section by section
					</Button>
				{/if}
			{:else}
				<ul class="space-y-6 pt-1">
					{#each conflict.sections as section, nth (section.section)}
						{@const chosen = perSection.get(sectionKey(at, section.section))}
						<li class="space-y-2">
							<p class="text-xs text-muted-foreground">Section {nth + 1}</p>
							{@render twoWays(section.mine, section.theirs, chosen)}
							<div class="flex gap-2">
								<Button
									variant={chosen === 'mine' ? 'secondary' : 'ghost'}
									class="h-9 flex-1 rounded-full text-xs"
									aria-pressed={chosen === 'mine'}
									disabled={busy}
									onclick={() => perSection.set(sectionKey(at, section.section), 'mine')}
								>
									Keep this one
								</Button>
								<Button
									variant={chosen === 'theirs' ? 'secondary' : 'ghost'}
									class="h-9 flex-1 rounded-full text-xs"
									aria-pressed={chosen === 'theirs'}
									disabled={busy}
									onclick={() => perSection.set(sectionKey(at, section.section), 'theirs')}
								>
									Take the draft's
								</Button>
							</div>
						</li>
					{/each}
				</ul>
				<Button
					variant="ghost"
					class="h-9 w-full text-xs"
					disabled={busy}
					onclick={() => {
						for (const { section } of conflict.sections) perSection.delete(sectionKey(at, section));
						sectioned.delete(at);
					}}
				>
					Choose for the whole note instead
				</Button>
			{/if}
		</li>
	{/each}
</ul>
