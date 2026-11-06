<script lang="ts">
	// The code a note points at, as a reading surface, with the notes that lead
	// to it beside the lines — DESIGN.md § "An anchor into code". Nothing here
	// writes: Sloppy does not write in somebody's repository.
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import FileText from '@lucide/svelte/icons/file-text';
	import Folder from '@lucide/svelte/icons/folder';
	import SquareArrowOutUpRight from '@lucide/svelte/icons/square-arrow-out-up-right';
	import type { CodeAnchor, OwnedRef } from '@sloppy/types';
	import {
		type Coloured,
		colourLines,
		CopyButton,
		languageOfPath,
		ResponsiveModal,
		scrollFade
	} from '@sloppy/ui';
	import { Badge } from '@sloppy/ui/badge';
	import { Button } from '@sloppy/ui/button';
	import { Skeleton } from '@sloppy/ui/skeleton';
	import type { WhyHere } from '../code-provenance.js';
	import {
		childrenOf,
		excerpt,
		fragmentSays,
		linesOf,
		railOf,
		type CodeExcerpt,
		type RailChip
	} from './code-preview.js';

	let {
		open = $bindable(false),
		anchor,
		read,
		list,
		openWhereFilesOpen,
		why,
		onOpenNote
	}: {
		open?: boolean;
		/** The place being read; `null` before one has been tapped. */
		anchor: CodeAnchor | null;
		/** The file's text, or `undefined` where this checkout has not got it. */
		read: (path: string) => Promise<string | undefined>;
		/** Every file under a folder, as paths from the project's root; empty
		 *  where the path is no folder. Absent is a project that lists nothing. */
		list?: (path: string) => Promise<string[]>;
		/** Hand the file to wherever this person opens files. Absent where this
		 *  platform can open none, and the act is not offered. */
		openWhereFilesOpen?: (path: string) => Promise<void>;
		/** The notes that point into a file. Absent draws no rail. */
		why?: (path: string) => Promise<WhyHere[]>;
		/** Read one of those notes whole. Absent where nowhere here can. */
		onOpenNote?: (note: OwnedRef) => void;
	} = $props();

	const WHY_HEADING = 'Why this code';
	const NOTHING_POINTS = 'Nothing in the notes points here yet.';
	const BY_THE_LINES = 'Each note stands above the lines it is about.';
	const WHOLE_FILE = 'The whole file';

	/** What the file says, `null` while it is being read, `undefined` where this
	 *  checkout has not got it. */
	let text = $state.raw<string | null | undefined>(null);
	/** The file's lines as coloured runs, once its language is known and its
	 *  grammar in; `null` until then, and where it has none. */
	let coloured = $state.raw<Coloured[][] | null>(null);
	/** What the folder holds, where the path is one; `null` where it is not. */
	let inside = $state.raw<string[] | null>(null);
	/** Where the reader has gone from the anchor into a folder it names, the
	 *  deepest last. */
	let within = $state.raw<string[]>([]);
	/** How many pages of the stretch have been asked for. */
	let pages = $state(1);
	let opening = $state(false);
	let refused = $state<string | null>(null);
	/** The notes reaching the file shown; `null` while they are being read. */
	let reaching = $state.raw<WhyHere[] | null>(null);
	/** The section of a note being read in the code's place. */
	let inNote = $state.raw<WhyHere | null>(null);

	$effect(() => {
		void (open && anchor);
		within = [];
	});

	const path = $derived(within.at(-1) ?? anchor?.path);
	/** The anchor's own fragment holds only where the reader has not left it. */
	const reading = $derived<CodeAnchor | null>(
		path === undefined ? null : within.length === 0 && anchor ? anchor : { path }
	);

	$effect(() => {
		const at = open ? path : undefined;
		inNote = null;
		if (at === undefined) return;
		let current = true;
		text = null;
		inside = null;
		coloured = null;
		reaching = null;
		pages = 1;
		refused = null;
		const found = (held: string | undefined): void => {
			if (!current) return;
			if (held !== undefined) {
				text = held;
				void languageOfPath(at)
					.then((language) => colourLines(held, language))
					.then(
						(runs) => {
							if (current && runs) coloured = runs;
						},
						() => {}
					);
				void why?.(at).then(
					(notes) => {
						if (current) reaching = notes;
					},
					() => {
						if (current) reaching = [];
					}
				);
				return;
			}
			if (!list) {
				text = held;
				return;
			}
			void list(at)
				.catch(() => [])
				.then((files) => {
					if (!current) return;
					inside = files.length > 0 ? files : null;
					text = undefined;
				});
		};
		void read(at).then(found, () => found(undefined));
		return () => {
			current = false;
		};
	});

	const shown = $derived<CodeExcerpt | null>(
		reading && typeof text === 'string' ? excerpt(text, reading, pages) : null
	);
	const rail = $derived(
		shown && reaching && path !== undefined && typeof text === 'string'
			? railOf(reaching, path, linesOf(text), {
					from: shown.from,
					to: shown.from + shown.lines.length - 1
				})
			: null
	);
	const entries = $derived(inside && path !== undefined ? childrenOf(path, inside) : []);
	const says = $derived(
		inside
			? `${inside.length === 1 ? '1 file' : `${inside.length} files`}`
			: within.length === 0 && anchor
				? fragmentSays(anchor)
				: undefined
	);
	const back = $derived(within.length === 0 ? undefined : (within.at(-2) ?? anchor?.path));

	async function openIt(): Promise<void> {
		if (path === undefined || !openWhereFilesOpen) return;
		opening = true;
		refused = null;
		try {
			await openWhereFilesOpen(path);
		} catch {
			refused = 'Sloppy could not open that file from here. Copy the path and open it yourself.';
		} finally {
			opening = false;
		}
	}

	/** What a chip at the head says of where in the file its note is about. */
	function whereSaid(chip: RailChip): string | undefined {
		if (chip.run.kind === 'missing' && chip.why.anchor.fragment?.kind === 'symbol') {
			return `“${chip.why.anchor.fragment.name}” is not in this file now`;
		}
		if (chip.why.anchor.path !== path) return `Everything in ${chip.why.anchor.path}/`;
		return fragmentSays(chip.why.anchor) ?? WHOLE_FILE;
	}
</script>

{#snippet noteChip(chip: RailChip, where: string | undefined)}
	{@const one = chip.why}
	<button
		type="button"
		data-why-chip={one.ref}
		onclick={() => (inNote = one)}
		class="inline-flex min-h-8 max-w-72 min-w-0 items-center gap-1.5 rounded-full border border-border bg-background px-2 text-left font-sans text-xs text-foreground transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
	>
		{#if one.address !== undefined}
			<span class="shrink-0 font-mono text-muted-foreground">{one.address}</span>
		{/if}
		<span class="min-w-0 truncate">{one.title.trim() || 'A note'}</span>
		{#if where}
			<span class="shrink-0 text-muted-foreground">· {where}</span>
		{/if}
	</button>
{/snippet}

<ResponsiveModal bind:open title={path ?? ''} description={says} class="sm:max-w-5xl">
	<div class="flex flex-col gap-3">
		{#if inNote}
			{@const one = inNote}
			<div class="flex flex-col gap-3" data-why-section={one.block}>
				<Button
					variant="ghost"
					class="h-control w-fit max-w-full gap-1.5 text-muted-foreground"
					onclick={() => (inNote = null)}
				>
					<ChevronLeft class="size-4 shrink-0" />
					<span class="min-w-0 truncate">Back to the code</span>
				</Button>
				<header class="flex min-w-0 flex-wrap items-baseline gap-2 px-1">
					{#if one.address !== undefined}
						<Badge variant="outline" class="font-mono">{one.address}</Badge>
					{/if}
					<h3 class="min-w-0 text-base font-medium break-words">
						{one.title.trim() || 'A note'}
					</h3>
				</header>
				<section class="space-y-2 border-l border-foreground/70 pl-3">
					{#if one.heading}
						<h4 class="text-sm font-medium break-words">{one.heading}</h4>
					{/if}
					{#each one.text.split('\n').filter((line) => line !== '') as said, at (at)}
						<p class="text-sm leading-relaxed break-words">{said}</p>
					{/each}
				</section>
				{#if onOpenNote}
					<div class="border-t border-border pt-3">
						<Button
							variant="outline"
							class="h-control w-full sm:w-fit"
							onclick={() => {
								open = false;
								onOpenNote(one.ref);
							}}
						>
							Open the note
						</Button>
					</div>
				{/if}
			</div>
		{:else}
			{#if back !== undefined}
				<Button
					variant="ghost"
					class="h-control w-fit max-w-full gap-1.5 text-muted-foreground"
					onclick={() => (within = within.slice(0, -1))}
				>
					<ChevronLeft class="size-4 shrink-0" />
					<span class="min-w-0 truncate">{back}</span>
				</Button>
			{/if}
			{#if text === null}
				<Skeleton class="h-40 w-full" />
			{:else if text === undefined && inside}
				<ul class="flex flex-col">
					{#each entries as entry (entry.path)}
						<li>
							<button
								type="button"
								onclick={() => (within = [...within, entry.path])}
								class="flex min-h-control w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
							>
								{#if entry.folder}
									<Folder class="size-4 shrink-0 text-muted-foreground" />
								{:else}
									<FileText class="size-4 shrink-0 text-muted-foreground" />
								{/if}
								<span class="min-w-0 truncate">{entry.name}{entry.folder ? '/' : ''}</span>
							</button>
						</li>
					{/each}
				</ul>
			{:else if text === undefined}
				<p class="text-sm text-muted-foreground">
					There is nothing at this path in the project now.
				</p>
			{:else if shown}
				{#if why}
					<section class="space-y-1.5 px-1" aria-label={WHY_HEADING} data-why-rail>
						<h3 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
							{WHY_HEADING}
						</h3>
						{#if reaching === null}
							<Skeleton class="h-8 w-48" />
						{:else if reaching.length === 0}
							<p class="text-sm text-muted-foreground">{NOTHING_POINTS}</p>
						{:else if rail && rail.head.length > 0}
							<ul class="flex flex-wrap gap-1">
								{#each rail.head as chip, at (at)}
									<li class="min-w-0">{@render noteChip(chip, whereSaid(chip))}</li>
								{/each}
							</ul>
						{:else}
							<p class="text-xs text-muted-foreground">{BY_THE_LINES}</p>
						{/if}
					</section>
				{/if}
				{#if shown.missing && reading?.fragment?.kind === 'symbol'}
					<p class="px-1 text-sm text-muted-foreground">
						Nothing in this file is called “{reading.fragment.name}” now.
					</p>
				{/if}
				<!-- The lines are read as they were written, so they scroll sideways
				     rather than wrapping; the sheet under them is what scrolls down. -->
				<div
					class="scroll-fade-x overflow-x-auto rounded-md border border-border bg-muted/40 py-2 [--scroll-fade:1rem]"
					{@attach scrollFade('x')}
				>
					<code class="block w-max min-w-full pr-3 font-mono text-xs leading-relaxed">
						{#each shown.lines as line, i (i)}
							{@const number = shown.from + i}
							{@const runs = coloured?.[number - 1]}
							{@const chips = rail?.at.get(number)}
							{@const marked = rail?.marked(number) ?? false}
							{#if chips}
								<span
									class="sticky left-0 flex w-fit max-w-[min(100vw-3rem,40rem)] flex-wrap gap-1 py-1 pl-12"
									data-why-at={number}
								>
									{#each chips as chip, at (at)}
										{@render noteChip(chip, undefined)}
									{/each}
								</span>
							{/if}
							<span class="flex" data-why-marked={marked ? '' : undefined}>
								<span
									class="w-10 shrink-0 border-r pr-2 text-right tabular-nums select-none {marked
										? 'border-foreground text-foreground'
										: 'border-transparent text-muted-foreground'}"
									aria-hidden="true">{number}</span
								><span class="pl-3 whitespace-pre"
									>{#if runs}{#each runs as run, at (at)}<span class="shiki" style={run.style}
												>{run.text}</span
											>{/each}{:else}{line}{/if}</span
								>
							</span>
						{/each}
					</code>
				</div>
				{#if shown.more}
					<Button
						variant="ghost"
						class="h-control w-fit text-muted-foreground"
						onclick={() => (pages += 1)}
					>
						Show more of this file
					</Button>
				{/if}
			{/if}

			{#if path !== undefined}
				<div class="flex flex-wrap items-center gap-2 border-t border-border pt-3">
					<CopyButton value={path} label="Copy the path" />
					{#if openWhereFilesOpen}
						<Button
							variant="outline"
							class="h-control"
							disabled={opening}
							onclick={() => void openIt()}
						>
							<SquareArrowOutUpRight class="size-4" />
							Open in your editor
						</Button>
					{/if}
				</div>
			{/if}

			{#if refused}
				<p class="text-sm text-destructive" role="alert">{refused}</p>
			{/if}
		{/if}
	</div>
</ResponsiveModal>
