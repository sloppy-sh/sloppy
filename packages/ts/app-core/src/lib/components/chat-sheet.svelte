<script lang="ts">
	// Chatting with an agent about the project's notes — docs/ARCHITECTURE.md
	// § "Asking a tool to write the notes". The thread, the composer, and the
	// question standing in front of every act that would write.
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Square from '@lucide/svelte/icons/square';
	import { CHAT_AGENTS, CHAT_ASKED_MAX, chatAgentName, type OwnedRef } from '@sloppy/types';
	import { ResponsiveModal, scrollFade } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Skeleton } from '@sloppy/ui/skeleton';
	import { Textarea } from '@sloppy/ui/textarea';
	import { readCall } from '../chat-said.js';
	import type { NoteLanding } from '../pages/page-state.js';
	import { chat } from '../stores/chat.svelte.js';
	import { nodes } from '../stores/nodes.svelte.js';
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
		open = false;
		onOpen(note, at);
	}
</script>

<ResponsiveModal
	bind:open
	title="Chat about the code"
	description="Nothing is written until you say so."
	class="sm:max-w-2xl"
>
	<div class="flex max-h-[72dvh] min-h-0 flex-col gap-3 px-2 pt-3">
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
</ResponsiveModal>
