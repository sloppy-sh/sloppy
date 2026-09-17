<script lang="ts">
	// The code a note points at, as a reading surface — DESIGN.md § "An anchor
	// into code". Nothing here writes: Sloppy does not write in somebody's
	// repository.
	import SquareArrowOutUpRight from '@lucide/svelte/icons/square-arrow-out-up-right';
	import type { CodeAnchor } from '@sloppy/types';
	import { CopyButton, ResponsiveModal, scrollFade } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Skeleton } from '@sloppy/ui/skeleton';
	import { excerpt, fragmentSays, type CodeExcerpt } from './code-preview.js';

	let {
		open = $bindable(false),
		anchor,
		read,
		openWhereFilesOpen
	}: {
		open?: boolean;
		/** The place being read; `null` before one has been tapped. */
		anchor: CodeAnchor | null;
		/** The file's text, or `undefined` where this checkout has not got it. */
		read: (path: string) => Promise<string | undefined>;
		/** Hand the file to wherever this person opens files. Absent where this
		 *  platform can open none, and the act is not offered. */
		openWhereFilesOpen?: (path: string) => Promise<void>;
	} = $props();

	/** What the file says, `null` while it is being read, `undefined` where this
	 *  checkout has not got it. */
	let text = $state.raw<string | null | undefined>(null);
	/** How many pages of the stretch have been asked for. */
	let pages = $state(1);
	let opening = $state(false);
	let refused = $state<string | null>(null);

	$effect(() => {
		const at = open ? anchor : null;
		if (!at) return;
		let reading = true;
		text = null;
		pages = 1;
		refused = null;
		void read(at.path).then(
			(held) => {
				if (reading) text = held;
			},
			() => {
				if (reading) text = undefined;
			}
		);
		return () => {
			reading = false;
		};
	});

	const shown = $derived<CodeExcerpt | null>(
		anchor && typeof text === 'string' ? excerpt(text, anchor, pages) : null
	);
	const says = $derived(anchor ? fragmentSays(anchor) : undefined);

	async function openIt(): Promise<void> {
		if (!anchor || !openWhereFilesOpen) return;
		opening = true;
		refused = null;
		try {
			await openWhereFilesOpen(anchor.path);
		} catch {
			refused = 'Sloppy could not open that file from here. Copy the path and open it yourself.';
		} finally {
			opening = false;
		}
	}
</script>

<ResponsiveModal bind:open title={anchor?.path ?? ''} description={says}>
	<div class="flex flex-col gap-3">
		{#if text === null}
			<Skeleton class="h-40 w-full" />
		{:else if text === undefined}
			<p class="text-sm text-muted-foreground">This file is not in the project now.</p>
		{:else if shown}
			{#if shown.missing && anchor?.fragment?.kind === 'symbol'}
				<p class="text-sm text-muted-foreground">
					Nothing in this file is called “{anchor.fragment.name}” now.
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

		{#if anchor}
			<div class="flex flex-wrap items-center gap-2">
				<CopyButton value={anchor.path} label="Copy the path" />
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
