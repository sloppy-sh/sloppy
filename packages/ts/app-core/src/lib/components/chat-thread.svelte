<script lang="ts">
	// A conversation with an agent about the project, as it arrives — what was
	// said, what it is thinking, and every act it called drawn as what it did to
	// the notes. docs/ARCHITECTURE.md § "Asking a tool to write the notes".
	import BookOpen from '@lucide/svelte/icons/book-open';
	import NotebookPen from '@lucide/svelte/icons/notebook-pen';
	import Wrench from '@lucide/svelte/icons/wrench';
	import type { ChatTurn, OwnedRef, ToolCallBlock } from '@sloppy/types';
	import { saidIn, threadRows, toolLine, toolOutcome } from '../chat-said.js';
	import type { NoteLanding } from '../pages/page-state.js';
	import { nodes } from '../stores/nodes.svelte.js';

	let {
		turns,
		onOpen
	}: {
		turns: readonly ChatTurn[];
		/** Read a note an act left, at the offered change where it left one. */
		onOpen: (note: OwnedRef, at?: NoteLanding) => void;
	} = $props();

	const drawn = $derived(turns.map((turn) => ({ turn, rows: threadRows(turn) })));

	function titleOf(note: OwnedRef | undefined): { title: string; address?: string } | undefined {
		const held = note === undefined ? undefined : nodes.get(note);
		if (!held) return undefined;
		return {
			title: held.title.trim() === '' ? 'Untitled' : held.title,
			...(held.address === undefined ? {} : { address: held.address })
		};
	}

	function iconFor(call: ToolCallBlock) {
		if (call.act === undefined) return Wrench;
		return call.act === 'list_notes' || call.act === 'read_note' ? BookOpen : NotebookPen;
	}

	/** A note as somebody cites it: the address they navigate by, then what it
	 *  is called. */
	function nameOf(held: { title: string; address?: string }): string {
		return held.address === undefined ? held.title : `${held.address} · ${held.title}`;
	}
</script>

<ol class="space-y-3">
	{#each drawn as { turn, rows }, index (index)}
		<li>
			{#if turn.from === 'person'}
				<div class="flex justify-end">
					<p
						class="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3 py-2 text-sm break-words whitespace-pre-wrap select-text"
					>
						{saidIn(rows)}
					</p>
				</div>
			{:else}
				<div class="space-y-2">
					{#each rows as row (row.key)}
						{#if row.kind === 'said'}
							<p class="text-sm break-words whitespace-pre-wrap select-text">{row.said}</p>
						{:else if row.kind === 'thinking'}
							<details>
								<summary
									class="inline-flex min-h-8 cursor-pointer list-none items-center text-xs text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
								>
									Thinking
								</summary>
								<p
									class="mt-1 border-l border-border pl-3 text-xs break-words whitespace-pre-wrap text-muted-foreground select-text"
								>
									{row.said}
								</p>
							</details>
						{:else if row.kind === 'call'}
							{@const line = toolLine(row.call)}
							{@const came = row.answer ? toolOutcome(row.call.act, row.answer) : undefined}
							{@const held = titleOf(came?.note ?? line.note)}
							{@const Icon = iconFor(row.call)}
							<div class="rounded-md border border-border/60 px-2.5 py-1.5">
								<p class="flex min-w-0 items-center gap-2 text-xs">
									<Icon
										class="size-3.5 shrink-0 text-muted-foreground {row.answer
											? ''
											: 'animate-pulse motion-reduce:animate-none'}"
									/>
									<span class="shrink-0">{line.doing}</span>
									{#if line.subject}
										<span class="min-w-0 truncate text-muted-foreground">{line.subject}</span>
									{:else if held}
										<span class="min-w-0 truncate text-muted-foreground">{nameOf(held)}</span>
									{/if}
								</p>
								{#if came?.said}
									<p
										class="mt-0.5 text-xs {came.trouble
											? 'text-destructive'
											: 'text-muted-foreground'}"
									>
										{came.said}
									</p>
								{/if}
								{#if came?.note && held}
									{@const opens = came.note}
									{@const landing = came.landing}
									<button
										type="button"
										class="mt-1 inline-flex min-h-9 items-center text-xs underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
										onclick={() => onOpen(opens, landing)}
									>
										Open {nameOf(held)}
									</button>
								{/if}
							</div>
						{:else}
							<p
								class="text-xs {row.answer.trouble ? 'text-destructive' : 'text-muted-foreground'}"
							>
								{row.answer.said}
							</p>
						{/if}
					{/each}
				</div>
			{/if}
		</li>
	{/each}
</ol>
