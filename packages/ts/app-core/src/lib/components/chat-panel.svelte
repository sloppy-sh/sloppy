<script lang="ts">
	// Chatting with an agent about the project's notes — docs/ARCHITECTURE.md
	// § "Asking a tool to write the notes". A dock beside the graph, holding the
	// thread, the composer, and the question standing in front of every act that
	// would write.
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Square from '@lucide/svelte/icons/square';
	import X from '@lucide/svelte/icons/x';
	import { CHAT_AGENTS, CHAT_ASKED_MAX, chatAgentName, type OwnedRef } from '@sloppy/types';
	import { scrollFade, SideDock } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Skeleton } from '@sloppy/ui/skeleton';
	import { Textarea } from '@sloppy/ui/textarea';
	import { readCall } from '../chat-said.js';
	import type { NoteLanding } from '../pages/page-state.js';
	import { chat } from '../stores/chat.svelte.js';
	import { nodes } from '../stores/nodes.svelte.js';
	import { prefs } from '../stores/prefs.svelte.js';
	import ChatThread from './chat-thread.svelte';

	let {
		open = $bindable(false),
		onOpen
	}: {
		open?: boolean;
		/** Read a note an act left, at the offered change where it left one. */
		onOpen: (note: OwnedRef, at?: NoteLanding) => void;
	} = $props();

	/** What Sloppy knows how to ask, as somebody with none of them reads it. */
	const AGENTS_IT_ASKS = CHAT_AGENTS.map(chatAgentName).join(' or ');

	/** How tall the composer grows before it scrolls instead. */
	const COMPOSER_MAX = 160;

	const agents = $derived(chat.agents);
	const asking = $derived(chat.asking);
	const asked = $derived(asking ? readCall(asking.call, asking.act, asking.arguments) : null);

	let docked = $state(false);
	let said = $state('');
	let field = $state.raw<HTMLTextAreaElement | null>(null);
	let thread = $state.raw<HTMLElement | null>(null);
	/** Whether the newest line is what the person is reading. Scrolling up says
	 *  they are reading something else, and the thread stops following. */
	let following = $state(true);

	// `field-sizing-content` on the base textarea is not in every engine this
	// app runs in, so the height is set here rather than left to the browser.
	$effect(() => {
		void said;
		const box = field;
		if (!box) return;
		box.style.height = 'auto';
		box.style.height = `${Math.min(box.scrollHeight, COMPOSER_MAX)}px`;
	});

	$effect(() => {
		void chat.turns;
		void chat.asking;
		const box = thread;
		if (box && following) box.scrollTop = box.scrollHeight;
	});

	function onScrolled(): void {
		const box = thread;
		if (!box) return;
		following = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
	}

	async function send(): Promise<void> {
		const words = said;
		if (words.trim() === '' || chat.running) return;
		said = '';
		following = true;
		await chat.say(words);
	}

	function onKey(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
		event.preventDefault();
		void send();
	}

	function titleOf(note: OwnedRef): string | undefined {
		const held = nodes.get(note);
		if (!held) return undefined;
		return held.title.trim() === '' ? undefined : held.title;
	}

	function read(note: OwnedRef, at: NoteLanding | undefined): void {
		// Docked, the note opens beside the conversation and it stays. Narrower
		// than that, both are the whole screen, and the note is what was asked for.
		if (!docked) open = false;
		onOpen(note, at);
	}
</script>

<SideDock
	bind:open
	onDocked={(is) => (docked = is)}
	title="Chat about the code"
	wall="How much room the chat takes"
	outer={1}
	scrolls={false}
	width={prefs.current.chatWidth}
	onWidthChange={(px) => prefs.set('chatWidth', px)}
>
	<div class="flex min-h-0 flex-1 flex-col gap-3 pt-2">
		<div class="flex shrink-0 items-start gap-2">
			<div class="min-w-0 flex-1 px-1">
				<h2 class="truncate text-sm font-medium">Chat about the code</h2>
				{#if !chat.writesWithoutAsking}
					<p class="text-xs text-muted-foreground">Nothing is written until you say so.</p>
				{/if}
			</div>
			<Button
				variant="ghost"
				class="size-9 shrink-0"
				aria-label="Close the chat"
				onclick={() => (open = false)}
			>
				<X class="size-4" />
			</Button>
		</div>

		{#if agents === null}
			<Skeleton class="h-11 w-full" />
		{:else if agents === 'untold' || agents.length === 0}
			<p class="px-1 py-2 text-sm text-muted-foreground">
				{agents === 'untold'
					? `Sloppy could not tell whether ${AGENTS_IT_ASKS} is on this machine.`
					: `Sloppy asks ${AGENTS_IT_ASKS} to do this, and it is not on this machine. Install it, then look again.`}
			</p>
			<Button variant="outline" class="h-11 w-full" onclick={() => void chat.lookForAgents()}>
				Look again
			</Button>
		{:else}
			<div
				bind:this={thread}
				onscroll={onScrolled}
				class="min-h-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto scroll-fade-y [--scroll-fade:1rem]"
				{@attach scrollFade('y')}
			>
				{#if chat.turns.length === 0}
					<p class="px-1 py-2 text-sm text-muted-foreground">
						Say what you want written about — a file, a folder, or what somebody new would need to
						understand first.
					</p>
				{/if}

				<ChatThread turns={chat.turns} onOpen={read} />

				{#if asking}
					<div class="rounded-lg border border-primary/50 bg-primary/5 p-3" role="alert">
						<p class="text-sm">
							{#if asked?.act === 'write_note'}
								{#if asked.arguments.title}
									It wants to write “{asked.arguments.title}”, about {asked.arguments.about}.
								{:else}
									It wants to write the note about {asked.arguments.about}.
								{/if}
								{#if asked.arguments.tags && asked.arguments.tags.length > 0}
									It would tag it {asked.arguments.tags.join(', ')}.
								{/if}
							{:else if asked?.act === 'tag_note'}
								{@const held = titleOf(asked.arguments.note)}
								It wants to tag {held ?? 'a note'}
								{asked.arguments.tags.join(', ')}.
							{:else}
								It wants to change the notes.
							{/if}
						</p>
						<div class="mt-3 flex gap-2">
							<Button
								class="h-11 flex-1"
								disabled={chat.settling}
								onclick={() => void chat.settle(asking.call, true)}
							>
								Allow
							</Button>
							<Button
								variant="outline"
								class="h-11 flex-1"
								disabled={chat.settling}
								onclick={() => void chat.settle(asking.call, false)}
							>
								Don’t
							</Button>
						</div>
						<div class="mt-1 flex flex-wrap gap-1">
							<Button
								variant="ghost"
								class="h-11 flex-1 text-xs whitespace-normal"
								disabled={chat.settling}
								onclick={() => void chat.settle(asking.call, true, true)}
							>
								Allow the rest of this reply
							</Button>
							<Button
								variant="ghost"
								class="h-11 flex-1 text-xs whitespace-normal"
								disabled={chat.settling}
								onclick={() => {
									chat.askBeforeWriting(false);
									void chat.settle(asking.call, true);
								}}
							>
								Stop asking
							</Button>
						</div>
					</div>
				{/if}

				{#if chat.writesWithoutAsking}
					<div class="flex items-center gap-2 px-1">
						<p class="flex-1 text-xs text-muted-foreground">Notes are written without asking.</p>
						<Button
							variant="ghost"
							class="h-9 shrink-0 text-xs"
							onclick={() => chat.askBeforeWriting(true)}
						>
							Ask me again
						</Button>
					</div>
				{/if}

				{#if chat.trouble}
					<p class="px-1 text-sm text-destructive" role="alert">{chat.trouble}</p>
				{/if}
			</div>

			<form
				class="flex shrink-0 items-end gap-2"
				onsubmit={(event) => {
					event.preventDefault();
					void send();
				}}
			>
				<Textarea
					bind:ref={field}
					bind:value={said}
					rows={1}
					maxlength={CHAT_ASKED_MAX}
					class="max-h-40 min-h-11 resize-none"
					aria-label="What you want written about"
					placeholder="Say what you want written about"
					onkeydown={onKey}
				/>
				{#if chat.running}
					<Button
						variant="outline"
						class="size-11 shrink-0"
						aria-label="Stop"
						disabled={chat.stopping}
						onclick={() => void chat.stop()}
					>
						<Square class="size-4" />
					</Button>
				{:else}
					<Button
						type="submit"
						class="size-11 shrink-0"
						aria-label="Send"
						disabled={said.trim() === ''}
					>
						<ArrowUp class="size-4" />
					</Button>
				{/if}
			</form>
		{/if}
	</div>
</SideDock>
