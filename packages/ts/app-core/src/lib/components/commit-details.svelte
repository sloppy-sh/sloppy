<script lang="ts">
	// One version of a graph, opened from the picture — DESIGN.md § "The history
	// as a picture".
	import { ResponsiveModal } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';
	import type { DrawnVersion } from './commit-graph.js';

	let {
		open = $bindable(false),
		version,
		springsFrom = [],
		linesHere = [],
		signs = false,
		busy = false,
		says = null,
		onRead,
		onCompare,
		onOpen,
		onStartLine,
		onWorkOn
	}: {
		open?: boolean;
		version: DrawnVersion;
		/** What it springs from, where those are among the versions read. */
		springsFrom?: readonly { id: string; message: string }[];
		/** The branches at it that are kept here and are not the one the folder is
		 *  already on, which are the ones it can be put on. */
		linesHere?: readonly string[];
		/** Whether this folder signs what it keeps: a version with no signature
		 *  is then one nothing here could sign, and says so. */
		signs?: boolean;
		busy?: boolean;
		says?: string | null;
		/** Absent where the graph is not in front of anybody to draw it on. */
		onRead?: (id: string) => void;
		onCompare?: (id: string) => void;
		onOpen: (id: string) => void;
		onStartLine: (name: string, id: string) => Promise<boolean>;
		onWorkOn: (name: string) => Promise<boolean>;
	} = $props();

	let naming = $state('');

	const kept = $derived(version.author ? `${version.when} · ${version.author}` : version.when);

	async function startLine(): Promise<void> {
		const name = naming.trim();
		if (name === '') return;
		if (await onStartLine(name, version.id)) {
			naming = '';
			open = false;
		}
	}
</script>

<ResponsiveModal bind:open title={version.message || 'A version'} description={kept}>
	<div class="space-y-6 px-2 pt-4 pb-2">
		<section class="space-y-1">
			{#if version.signed}
				<p class="text-sm text-muted-foreground">
					{version.signed.verified
						? 'Signed with a key this device knows:'
						: 'Signed with a key nothing here can vouch for:'}
				</p>
				<p class="font-mono text-xs break-all text-muted-foreground select-text">
					{version.signed.by}
				</p>
			{:else if signs}
				<p class="text-sm text-muted-foreground">
					Kept unsigned: nothing on this device could sign it.
				</p>
			{/if}
			{#if version.refs.length > 0}
				<p class="flex flex-wrap items-center gap-1.5 pt-1">
					{#each version.refs as ref (ref)}
						<span class="rounded-full border border-border px-2 py-0.5 text-xs">{ref}</span>
					{/each}
				</p>
			{/if}
		</section>

		<section class="space-y-2">
			<h3 class="text-sm font-medium">What it springs from</h3>
			{#if version.parents.length === 0}
				<p class="text-sm text-muted-foreground">Nothing: this is where the history starts.</p>
			{:else if springsFrom.length === 0}
				<p class="text-sm text-muted-foreground">
					{version.parents.length > 1
						? 'Two versions further back than the ones read.'
						: 'A version further back than the ones read.'}
				</p>
			{:else}
				<ul class="space-y-1">
					{#each springsFrom as one (one.id)}
						<li>
							<button
								type="button"
								class="min-h-11 w-full truncate rounded-md px-2 text-left text-sm hover:bg-muted"
								onclick={() => onOpen(one.id)}
							>
								{one.message || 'A version'}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="flex flex-col gap-2">
			{#if onRead}
				<Button variant="outline" class="h-11" onclick={() => onRead(version.id)}>
					Read your graph as it was
				</Button>
			{/if}
			{#if onCompare}
				<Button variant="outline" class="h-11" onclick={() => onCompare(version.id)}>
					Show what has changed since
				</Button>
			{/if}
			{#each linesHere as name (name)}
				<Button
					variant="outline"
					class="h-11"
					disabled={busy}
					onclick={() => void onWorkOn(name).then((done) => (open = !done))}
				>
					Work on {name}
				</Button>
			{/each}
		</section>

		<section class="space-y-2 border-t border-border pt-6">
			<h3 class="text-sm font-medium">Start a line here</h3>
			<div class="flex gap-2">
				<Input
					bind:value={naming}
					class="h-11 flex-1"
					autocomplete="off"
					maxlength={128}
					placeholder="another-way"
					aria-label="Name a line starting here"
					onkeydown={(e) => {
						if (e.key !== 'Enter') return;
						e.preventDefault();
						void startLine();
					}}
				/>
				<Button
					variant="outline"
					class="h-11 shrink-0"
					disabled={busy || naming.trim() === ''}
					onclick={startLine}
				>
					Start it
				</Button>
			</div>
		</section>

		{#if says}
			<p class="text-sm text-destructive" role="alert">{says}</p>
		{/if}
	</div>
</ResponsiveModal>
