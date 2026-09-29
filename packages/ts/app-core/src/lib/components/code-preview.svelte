<script lang="ts">
	// The code a note points at, as a reading surface — DESIGN.md § "An anchor
	// into code". Nothing here writes: Sloppy does not write in somebody's
	// repository.
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import FileText from '@lucide/svelte/icons/file-text';
	import Folder from '@lucide/svelte/icons/folder';
	import SquareArrowOutUpRight from '@lucide/svelte/icons/square-arrow-out-up-right';
	import type { CodeAnchor } from '@sloppy/types';
	import { CopyButton, ResponsiveModal, scrollFade } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Skeleton } from '@sloppy/ui/skeleton';
	import { childrenOf, excerpt, fragmentSays, type CodeExcerpt } from './code-preview.js';

	let {
		open = $bindable(false),
		anchor,
		read,
		list,
		openWhereFilesOpen
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
	} = $props();

	/** What the file says, `null` while it is being read, `undefined` where this
	 *  checkout has not got it. */
	let text = $state.raw<string | null | undefined>(null);
	/** What the folder holds, where the path is one; `null` where it is not. */
	let inside = $state.raw<string[] | null>(null);
	/** Where the reader has gone from the anchor into a folder it names, the
	 *  deepest last. */
	let within = $state.raw<string[]>([]);
	/** How many pages of the stretch have been asked for. */
	let pages = $state(1);
	let opening = $state(false);
	let refused = $state<string | null>(null);

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
		if (at === undefined) return;
		let current = true;
		text = null;
		inside = null;
		pages = 1;
		refused = null;
		const found = (held: string | undefined): void => {
			if (!current) return;
			if (held !== undefined || !list) {
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
</script>

<ResponsiveModal bind:open title={path ?? ''} description={says}>
	<div class="flex flex-col gap-3">
		{#if back !== undefined}
			<Button
				variant="ghost"
				class="h-11 w-fit max-w-full gap-1.5 text-muted-foreground"
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
							class="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
			<p class="text-sm text-muted-foreground">There is nothing at this path in the project now.</p>
		{:else if shown}
			{#if shown.missing && reading?.fragment?.kind === 'symbol'}
				<p class="text-sm text-muted-foreground">
					Nothing in this file is called “{reading.fragment.name}” now.
				</p>
			{/if}
			<!-- The lines are read as they were written, so they scroll sideways
			     rather than wrapping; the sheet under them is what scrolls down. -->
			<div
				class="scroll-fade-x overflow-x-auto rounded-md border border-border bg-muted/40 py-2 [--scroll-fade:1rem]"
				{@attach scrollFade('x')}
			>
				<code class="block w-max min-w-full px-3 font-mono text-xs leading-relaxed">
					{#each shown.lines as line, i (i)}
						<span class="flex">
							<span
								class="w-10 shrink-0 pr-3 text-right text-muted-foreground tabular-nums select-none"
								aria-hidden="true">{shown.from + i}</span
							><span class="whitespace-pre">{line}</span>
						</span>
					{/each}
				</code>
			</div>
			{#if shown.more}
				<Button
					variant="ghost"
					class="h-11 w-fit text-muted-foreground"
					onclick={() => (pages += 1)}
				>
					Show more of this file
				</Button>
			{/if}
		{/if}

		{#if path !== undefined}
			<div class="flex flex-wrap items-center gap-2">
				<CopyButton value={path} label="Copy the path" />
				{#if openWhereFilesOpen}
					<Button variant="outline" class="h-11" disabled={opening} onclick={() => void openIt()}>
						<SquareArrowOutUpRight class="size-4" />
						Open in your editor
					</Button>
				{/if}
			</div>
		{/if}

		{#if refused}
			<p class="text-sm text-destructive" role="alert">{refused}</p>
		{/if}
	</div>
</ResponsiveModal>
