<script lang="ts" module>
	/** The four questions, as somebody chooses between them. */
	export const SIGNALS: Record<ReviewSignalKind, string> = {
		'anchor-changed': 'The code moved',
		'code-without-note': 'Nothing written here',
		'compass-gap': 'An empty slot',
		'decision-without-why': 'No why written'
	};
</script>

<script lang="ts">
	// What the code has left behind, as one quiet sheet — DESIGN.md § "What the
	// code left behind". One signal at a time, and the canvas answers underneath.
	import type { OwnedRef } from '@sloppy/types';
	import type { ReviewSignal, ReviewSignalKind } from '@sloppy/vault';
	import { COMPASS_WORDS, ResponsiveModal } from '@sloppy/ui';
	import { Skeleton } from '@sloppy/ui/skeleton';
	import { nodes } from '../stores/nodes.svelte.js';
	import { actKey, review, signalKey } from '../stores/review.svelte.js';

	let {
		open = $bindable(false),
		onOpen,
		onWrote
	}: {
		open?: boolean;
		/** Read a note the answer named. */
		onOpen: (note: OwnedRef) => void;
		/** Read a note an act has just written, so its address is said once. */
		onWrote: (note: OwnedRef) => void;
	} = $props();

	interface Row {
		key: string;
		/** Absent is a row about the project rather than about a note. */
		note?: OwnedRef;
		/** The place in the code the row is about, where it is about one. */
		path?: string;
		address?: string;
		title: string;
		/** What the row is about, under its title. */
		said?: string;
		act: string;
		/** Which rows this row's act settles — {@link actKey}. */
		actAt: string;
	}

	const chosen = $derived(review.chosen);
	const rows = $derived.by<Row[]>(() => {
		if (chosen === null) return [];
		const held = review.under(chosen);
		if (chosen === 'anchor-changed') return movedRows(held);
		return held.map((signal) => {
			const note = signal.note ? titleOf(signal.note) : undefined;
			if (signal.kind === 'code-without-note') {
				return {
					key: signalKey(signal),
					path: signal.path ?? '',
					title: signal.path ?? '',
					act: 'Write a note',
					actAt: actKey(signal)
				};
			}
			const slot = signal.direction ? COMPASS_WORDS[signal.direction] : undefined;
			return {
				key: signalKey(signal),
				...(signal.note === undefined ? {} : { note: signal.note }),
				...(note?.address === undefined ? {} : { address: note.address }),
				title: note?.title ?? 'Untitled',
				...(slot === undefined ? {} : { said: slot.word }),
				act: slot?.asks ?? 'Say why',
				actAt: actKey(signal)
			};
		});
	});

	/** One row per note, however many of its anchors the code has moved under:
	 *  the reading it records is the note's, not one path's. */
	function movedRows(held: readonly ReviewSignal[]): Row[] {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- the derived rebuilds it whole; the derived IS the reactivity.
		const byNote = new Map<OwnedRef, string[]>();
		for (const signal of held) {
			if (signal.note === undefined) continue;
			const paths = byNote.get(signal.note) ?? [];
			if (signal.path !== undefined) paths.push(signal.path);
			byNote.set(signal.note, paths);
		}
		return [...byNote].map(([note, paths]) => {
			const held = titleOf(note);
			return {
				key: `anchor-changed ${note}`,
				note,
				...(held?.address === undefined ? {} : { address: held.address }),
				title: held?.title ?? 'Untitled',
				said: paths.join(', '),
				act: 'Still true',
				actAt: actKey({ kind: 'anchor-changed', note })
			};
		});
	}

	function titleOf(note: OwnedRef): { title: string; address?: string } | undefined {
		const held = nodes.get(note);
		if (!held) return undefined;
		return {
			title: held.title.trim() === '' ? 'Untitled' : held.title,
			...(held.address === undefined ? {} : { address: held.address })
		};
	}

	function read(note: OwnedRef): void {
		open = false;
		onOpen(note);
	}

	function readWritten(note: OwnedRef): void {
		open = false;
		onWrote(note);
	}

	async function take(row: Row): Promise<void> {
		if (chosen === 'anchor-changed' && row.note) {
			await review.stillTrue(row.note);
			return;
		}
		if (chosen === 'code-without-note' && row.path !== undefined) {
			const written = await review.writeAbout(row.path);
			if (written) readWritten(written);
			return;
		}
		if (row.note) read(row.note);
	}

	const chip =
		'inline-flex min-h-11 shrink-0 items-center rounded-full border px-3.5 text-sm whitespace-nowrap transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none';
</script>

<ResponsiveModal
	bind:open
	title="What the code left behind"
	description={review.kinds.length > 0 ? 'Choose one to see it on the graph.' : undefined}
>
	<div class="space-y-4 px-2 pt-4 pb-2">
		{#if review.kinds.length > 0}
			<div
				role="group"
				aria-label="What to look at"
				class="flex gap-1.5 overflow-x-auto py-0.5 [scrollbar-width:none]"
			>
				{#each review.kinds as kind (kind)}
					<button
						type="button"
						aria-pressed={kind === chosen}
						onclick={() => review.choose(kind)}
						class="{chip} {kind === chosen
							? 'border-input text-foreground'
							: 'border-transparent text-muted-foreground hover:text-foreground'}"
					>
						{SIGNALS[kind]}
					</button>
				{/each}
			</div>
		{/if}

		{#if review.reading}
			<div class="space-y-2" role="status" aria-label="Reading your notes">
				{#each Array.from({ length: 3 }, (_, row) => row) as row (row)}
					<Skeleton class="h-11 w-full" />
				{/each}
			</div>
		{:else if review.kinds.length === 0}
			{#if review.trouble === null}
				<p class="px-1 py-2 text-sm text-muted-foreground">Nothing the code has left behind.</p>
			{/if}
		{:else if rows.length === 0}
			<p class="px-1 py-2 text-sm text-muted-foreground">Choose one to see what it is.</p>
		{:else}
			<ul class="space-y-1">
				{#each rows as row (row.key)}
					<li class="rounded-md px-2 py-2">
						{#if row.note}
							{@const note = row.note}
							<button
								type="button"
								class="flex min-h-11 w-full flex-col items-start justify-center gap-0.5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
								onclick={() => read(note)}
							>
								<span class="flex w-full min-w-0 items-baseline gap-2">
									{#if row.address}
										<span class="address shrink-0 text-xs text-muted-foreground">{row.address}</span
										>
									{/if}
									<span class="min-w-0 break-words">{row.title}</span>
								</span>
								{#if row.said}
									<span class="text-sm break-all text-muted-foreground">{row.said}</span>
								{/if}
							</button>
						{:else}
							<p class="flex min-h-11 items-center break-all">{row.title}</p>
						{/if}
						<button
							type="button"
							class="mt-1 flex min-h-11 w-full items-center rounded-md text-left text-sm underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
							disabled={review.acting !== null}
							onclick={() => void take(row)}
						>
							{review.acting === row.actAt ? 'Just a moment…' : row.act}
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		{#if review.trouble}
			<p class="px-1 text-sm text-destructive" role="alert">{review.trouble}</p>
		{/if}
	</div>
</ResponsiveModal>
