<script lang="ts" module>
	import type { CodeAnchor } from '@sloppy/types';

	/** How many files are listed before the rest wait on more of the name. */
	export const LISTED = 60;

	const RUN = /^L?(\d+)(?:\s*-\s*L?(\d+))?$/;

	/**
	 * What somebody typed for where in the file: nothing is the whole of it, a
	 * run of lines is a run of lines, and everything else is a name to find —
	 * exactly as an anchor's own fragment reads.
	 */
	export function placeIn(path: string, within: string): CodeAnchor {
		const said = within.trim();
		if (said === '') return { path };
		const run = RUN.exec(said);
		if (!run) return { path, fragment: { kind: 'symbol', name: said } };
		const from = Number(run[1]);
		const to = run[2] === undefined ? from : Number(run[2]);
		return from >= 1 && to >= from
			? { path, fragment: { kind: 'lines', from, to } }
			: { path, fragment: { kind: 'symbol', name: said } };
	}

	/** The files whose path carries `query`, the ones matching in the file's own
	 *  name first and alphabetical within that. */
	export function matching(paths: readonly string[], query: string): string[] {
		const words = query.trim().toLowerCase();
		const named = (path: string) => path.slice(path.lastIndexOf('/') + 1).toLowerCase();
		return paths
			.filter((path) => words === '' || path.toLowerCase().includes(words))
			.sort((a, b) => {
				const inName = Number(named(b).includes(words)) - Number(named(a).includes(words));
				return inName !== 0 ? inName : a.localeCompare(b);
			});
	}
</script>

<script lang="ts">
	// Naming a place in the project's code from inside the writing — DESIGN.md
	// § "An anchor into code".
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import { ResponsiveModal } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';
	import { Skeleton } from '@sloppy/ui/skeleton';

	let {
		open = $bindable(false),
		files,
		onCite
	}: {
		open?: boolean;
		/** Every file in the project, as paths from its root. */
		files: () => Promise<readonly string[]>;
		/** Called once each time this closes: with the place named, or
		 *  `undefined` where the writer named none. */
		onCite: (anchor: CodeAnchor | undefined) => void;
	} = $props();

	/** `null` while the project's files are being read. */
	let held = $state.raw<readonly string[] | null>(null);
	let query = $state('');
	let within = $state('');
	/** The file chosen, while what in it is being said. */
	let chosen = $state<string | null>(null);
	let answered = false;

	$effect(() => {
		if (!open) return;
		answered = false;
		query = '';
		within = '';
		chosen = null;
		held = null;
		let reading = true;
		void files().then(
			(paths) => {
				if (reading) held = paths;
			},
			() => {
				if (reading) held = [];
			}
		);
		return () => {
			reading = false;
		};
	});

	const found = $derived(held === null ? [] : matching(held, query));
	const listed = $derived(found.slice(0, LISTED));

	/** The writing takes one answer per opening, whatever order the sheet
	 *  closes in. */
	function settle(anchor: CodeAnchor | undefined): void {
		if (answered) return;
		answered = true;
		onCite(anchor);
	}

	function cite(): void {
		if (chosen === null) return;
		settle(placeIn(chosen, within));
		open = false;
	}
</script>

<ResponsiveModal
	bind:open
	onOpenChange={(showing) => {
		if (!showing) settle(undefined);
	}}
	title="Cite code"
	description={chosen === null ? 'Which file is this note about?' : undefined}
>
	<div class="flex flex-col gap-3">
		{#if chosen === null}
			<Input
				class="h-control"
				placeholder="Find a file"
				aria-label="Find a file"
				autocapitalize="off"
				autocorrect="off"
				spellcheck={false}
				bind:value={query}
			/>
			{#if held === null}
				<Skeleton class="h-40 w-full" />
			{:else if listed.length === 0}
				<p class="text-sm text-muted-foreground">
					{held.length === 0
						? 'There are no files beside this graph.'
						: 'No file here is called that.'}
				</p>
			{:else}
				<ul class="scroll-fade-y max-h-64 space-y-0.5 overflow-y-auto">
					{#each listed as path (path)}
						<li>
							<button
								type="button"
								onclick={() => (chosen = path)}
								class="flex min-h-control w-full items-center rounded-md px-2 text-left font-mono text-sm transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
							>
								{path}
							</button>
						</li>
					{/each}
				</ul>
				{#if found.length > listed.length}
					<p class="text-sm text-muted-foreground">More match. Type more of the name.</p>
				{/if}
			{/if}
		{:else}
			<div class="flex items-center gap-2">
				<Button
					variant="ghost"
					size="icon"
					class="size-9 shrink-0 text-muted-foreground"
					aria-label="Choose another file"
					onclick={() => (chosen = null)}
				>
					<ChevronLeft class="size-4" />
				</Button>
				<p class="min-w-0 font-mono text-sm break-all">{chosen}</p>
			</div>
			<label class="flex flex-col gap-1.5 text-sm">
				What in it?
				<Input
					class="h-control"
					placeholder="12-20, or a name — leave this for the whole file"
					autocapitalize="off"
					autocorrect="off"
					spellcheck={false}
					bind:value={within}
				/>
			</label>
			<Button class="h-control w-full sm:w-fit" onclick={cite}>Cite it</Button>
		{/if}
	</div>
</ResponsiveModal>
