<script lang="ts">
	// A conversation with an agent about the project, as it arrives — what was
	// said, what it is thinking, and every act it called drawn as what it did to
	// the notes. docs/ARCHITECTURE.md § "Asking a tool to write the notes".
	import BookOpen from '@lucide/svelte/icons/book-open';
	import NotebookPen from '@lucide/svelte/icons/notebook-pen';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import Wrench from '@lucide/svelte/icons/wrench';
	import {
		type AttachedBlock,
		type ChatActDone,
		type ChatAttachment,
		type ChatCallId,
		type ChatCard as Card,
		type ChatTurn,
		chatToolWrites,
		type OwnedRef,
		type ToolCallBlock
	} from '@sloppy/types';
	import { Button } from '@sloppy/ui/button';
	import { saidIn, type ThreadRow, threadRows, toolLine, toolOutcome } from '../chat-said.js';
	import { nodes } from '../stores/nodes.svelte.js';
	import ChatCard from './chat-card.svelte';

	let {
		turns,
		live = false,
		busy = false,
		done,
		kept,
		keeping = null,
		settling = false,
		onKeep,
		onKept,
		onOpen
	}: {
		turns: readonly ChatTurn[];
		/** Whether the last turn is still being written into, where nothing is
		 *  offered on an answer that has not finished arriving. */
		live?: boolean;
		/** Whether a question already stands, which is one answer at a time. */
		busy?: boolean;
		/** What one of Sloppy's own acts came to, for the person. */
		done: (call: ChatCallId) => ChatActDone | undefined;
		/** What came of keeping the answer in the turn at this place. */
		kept: (at: number) => ChatActDone | undefined;
		/** The answer somebody asked to keep, standing at the turn it would
		 *  keep. The card is absent where the write does not read as one. */
		keeping?: { at: number; card?: Card } | null;
		/** Whether that keep is being written and has not landed yet. */
		settling?: boolean;
		onKeep: (at: number, said: string) => void;
		onKept?: (allowed: boolean) => void;
		/** Read a note an act left. */
		onOpen: (note: OwnedRef) => void;
	} = $props();

	const drawn = $derived(turns.map((turn) => ({ turn, rows: threadRows(turn) })));

	/** What one call came to, as the thread draws it. */
	interface Came {
		said?: string;
		trouble?: boolean;
		card?: Card;
		/** The one note it left, for a surface offering to open it. */
		note?: OwnedRef;
	}

	function outcomeOf(row: ThreadRow & { kind: 'call' }): Came {
		const ours = done(row.call.call);
		// A tool of the agent's own answers the agent and nobody else, so its
		// writing is the whole of what there is to show of it.
		if (!ours) return row.answer ? toolOutcome(row.answer) : {};
		const only = onlyNoteOf(ours);
		return { ...cameOf(ours), ...(only === undefined ? {} : { note: only }) };
	}

	function cameOf(act: ChatActDone): Came {
		const said =
			act.told ?? (act.trouble === true ? toolOutcome({ said: act.said }).said : undefined);
		return {
			...(said === undefined ? {} : { said }),
			...(act.trouble === undefined ? {} : { trouble: act.trouble }),
			...(act.card === undefined ? {} : { card: act.card })
		};
	}

	/** The note an act left, where it left exactly one — a move and a delete
	 *  carry a whole subtree, which is nothing to offer as a place to go. */
	function onlyNoteOf(act: ChatActDone): OwnedRef | undefined {
		return act.touched?.length === 1 ? act.touched[0] : undefined;
	}

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
		return chatToolWrites(call.act) ? NotebookPen : BookOpen;
	}

	/** A note as somebody cites it: the address they navigate by, then what it
	 *  is called. */
	function nameOf(held: { title: string; address?: string }): string {
		return held.address === undefined ? held.title : `${held.address} · ${held.title}`;
	}

	/** What a person attached in one turn. The shapes keep the set of blocks
	 *  open, so the arm carrying a kind this build has no row for is a loose
	 *  object and narrowing on `kind` alone does not reach past it. */
	function attachedIn(turn: ChatTurn): readonly ChatAttachment[] {
		return turn.blocks.flatMap((block) =>
			block.kind === 'attached' ? (block as AttachedBlock).attached : []
		);
	}
</script>

{#snippet outcome(came: Came, opens: OwnedRef | undefined)}
	{#if came.said}
		<p class="mt-0.5 text-xs {came.trouble ? 'text-destructive' : 'text-muted-foreground'}">
			{came.said}
		</p>
	{/if}
	{#if came.card}
		<div class="mt-2">
			<ChatCard card={came.card} />
		</div>
	{/if}
	{#if opens}
		{@const held = titleOf(opens)}
		{#if held}
			{@const note = opens}
			<button
				type="button"
				class="mt-1 inline-flex min-h-9 items-center text-xs underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
				onclick={() => onOpen(note)}
			>
				Open {nameOf(held)}
			</button>
		{/if}
	{/if}
{/snippet}

<ol class="space-y-3">
	{#each drawn as { turn, rows }, index (index)}
		<li>
			{#if turn.from === 'person'}
				{@const said = saidIn(rows)}
				{@const files = attachedIn(turn)}
				<div class="flex flex-col items-end gap-1">
					{#if said !== ''}
						<p
							class="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3 py-2 text-sm break-words whitespace-pre-wrap select-text"
						>
							{said}
						</p>
					{/if}
					{#if files.length > 0}
						<ul class="flex max-w-[85%] flex-wrap justify-end gap-1">
							{#each files as file (file.path)}
								<li
									class="inline-flex min-w-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground"
								>
									<Paperclip class="size-3 shrink-0" />
									<span class="truncate">{file.name}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{:else}
				{@const answer = saidIn(rows)}
				{@const came = kept(index)}
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
							{@const came = outcomeOf(row)}
							{@const held = titleOf(came.note ?? line.note)}
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
								{@render outcome(came, came.note)}
							</div>
						{:else}
							<p
								class="text-xs {row.answer.trouble ? 'text-destructive' : 'text-muted-foreground'}"
							>
								{row.answer.said}
							</p>
						{/if}
					{/each}

					{#if answer.trim() !== '' && !(live && index === drawn.length - 1)}
						{#if came}
							{@render outcome(cameOf(came), onlyNoteOf(came))}
						{:else if keeping?.at === index}
							<div class="rounded-lg border border-primary/50 bg-primary/5 p-3">
								{#if keeping.card}
									<ChatCard card={keeping.card} />
								{/if}
								<div class="mt-3 flex gap-2">
									<Button class="h-11 flex-1" disabled={settling} onclick={() => onKept?.(true)}>
										Keep it
									</Button>
									<Button
										variant="outline"
										class="h-11 flex-1"
										disabled={settling}
										onclick={() => onKept?.(false)}
									>
										Don’t
									</Button>
								</div>
							</div>
						{:else}
							<Button
								variant="ghost"
								class="h-9 px-2 text-xs text-muted-foreground"
								disabled={busy}
								onclick={() => onKeep(index, answer)}
							>
								Keep as a note
							</Button>
						{/if}
					{/if}
				</div>
			{/if}
		</li>
	{/each}
</ol>
