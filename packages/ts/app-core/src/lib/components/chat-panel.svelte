<script lang="ts">
	// Chatting with an agent about the project's notes — docs/ARCHITECTURE.md
	// § "Asking a tool to write the notes". A dock beside the graph, holding the
	// thread and the composer, and the draft the chat writes into until somebody
	// has read it.
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import Square from '@lucide/svelte/icons/square';
	import X from '@lucide/svelte/icons/x';
	import { CHAT_AGENTS, chatAgentName, type OwnedRef } from '@sloppy/types';
	import { scrollFade, SideDock } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import * as DropdownMenu from '@sloppy/ui/dropdown-menu';
	import { Skeleton } from '@sloppy/ui/skeleton';
	import { Textarea } from '@sloppy/ui/textarea';
	import { onDestroy } from 'svelte';
	import { readCall } from '../chat-said.js';
	import {
		DISCARD_COSTS,
		draftHolds,
		draftOnTheCanvas,
		type DraftOnTheCanvas
	} from '../draft-said.js';
	import type { NoteLanding } from '../pages/page-state.js';
	import { chat } from '../stores/chat.svelte.js';
	import { chatDraft } from '../stores/chat-draft.svelte.js';
	import { nodes } from '../stores/nodes.svelte.js';
	import { offers } from '../stores/offers.svelte.js';
	import { prefs } from '../stores/prefs.svelte.js';
	import { askedShown } from './chat-card.js';
	import ChatThread from './chat-thread.svelte';
	import DraftReview from './draft-review.svelte';
	import { noteFromAnswer, placeForAnswer } from './chat-keep.js';

	let {
		open = $bindable(false),
		onOpen,
		onShowDraft
	}: {
		open?: boolean;
		/** Read a note an act left, at the offered change where it left one. */
		onOpen: (note: OwnedRef, at?: NoteLanding) => void;
		/** A draft and the folder set against each other on the canvas, and `null`
		 *  to put the graph as it stands back. Absent draws neither. */
		onShowDraft?: (shown: DraftOnTheCanvas | null) => void;
	} = $props();

	/** What Sloppy knows how to ask, as somebody with none of them reads it. */
	const AGENTS_IT_ASKS = CHAT_AGENTS.map(chatAgentName).join(' or ');

	/** What somebody is told where an answer names nowhere in the project to
	 *  hang a note off. */
	const NOWHERE = 'Ask about a file or a folder first, so there is somewhere to put this.';

	/** Where a chat begins, because it changes what somebody would ask for. */
	const WORKS_IN_A_DRAFT =
		'It works in a draft of your notes, from the version you last kept. Nothing here changes until you merge it.';

	/** A draft nothing has been written into yet. */
	const NOTHING_YET = 'nothing in it yet';

	const ITS_OWN = 'its own choice';

	/** How tall the composer grows before it scrolls instead. */
	const COMPOSER_MAX = 160;

	const agents = $derived(chat.agents);
	const keeping = $derived(chat.keeping);
	const keepShown = $derived(
		keeping ? askedShown(readCall(keeping.call, keeping.act, keeping.arguments), nameOf) : null
	);
	const models = $derived(chat.models);
	const picked = $derived(models.find((one) => one.model === chat.model));
	const answering = $derived(chat.answeringWith);

	const standing = $derived(chatDraft.standing);
	const holds = $derived(chatDraft.counts ? draftHolds(chatDraft.counts) : '');

	/** Whether the panel is the review rather than the conversation. On a phone
	 *  the two are one surface, so this is what swaps it. */
	let reviewing = $state(false);
	let docked = $state(false);
	let said = $state('');
	let aside = $state<string | null>(null);
	let field = $state.raw<HTMLTextAreaElement | null>(null);
	let picker = $state.raw<HTMLInputElement | null>(null);
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
		const box = thread;
		if (box && following) box.scrollTop = box.scrollHeight;
	});

	// The canvas draws the two states for exactly as long as the review is the
	// thing in front of somebody — DESIGN.md § "Reading a draft".
	$effect(() => {
		const held = open && reviewing ? chatDraft.read : null;
		onShowDraft?.(held && !held.nothing ? draftOnTheCanvas(held) : null);
	});

	onDestroy(() => onShowDraft?.(null));

	function onScrolled(): void {
		const box = thread;
		if (!box) return;
		following = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
	}

	async function send(): Promise<void> {
		const words = said;
		if ((words.trim() === '' && chat.attached.length === 0) || chat.running) return;
		said = '';
		aside = null;
		following = true;
		await chat.say(words);
	}

	function onKey(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
		event.preventDefault();
		void send();
	}

	async function take(input: HTMLInputElement): Promise<void> {
		const files = [...(input.files ?? [])];
		input.value = '';
		aside = await chat.attach(files);
	}

	/** An answer kept as a note, through the act and the question everything
	 *  else the chat writes goes through. */
	function keep(at: number, answer: string): void {
		const place = placeForAnswer(answer, chat.turns);
		const asked = place === undefined ? null : noteFromAnswer(answer, place);
		if (!asked) {
			aside = NOWHERE;
			return;
		}
		aside = null;
		chat.keep(at, asked);
	}

	/** A note as somebody cites it: the address they navigate by, then what it
	 *  is called. */
	function nameOf(note: OwnedRef): string | undefined {
		const held = nodes.get(note);
		if (!held) return undefined;
		const title = held.title.trim();
		if (held.address === undefined) return title === '' ? undefined : title;
		return title === '' ? held.address : `${held.address} · ${title}`;
	}

	async function review(): Promise<void> {
		reviewing = true;
		await chatDraft.review();
	}

	/** The session ran where the draft was, so letting the draft go ends it. */
	function draftGone(): void {
		reviewing = false;
		chat.draftGone();
	}

	async function throwTheDraftAway(): Promise<void> {
		if (await chatDraft.discard()) draftGone();
	}

	async function read(note: OwnedRef): Promise<void> {
		// Docked, the note opens beside the conversation and it stays. Narrower
		// than that, both are the whole screen, and the note is what was asked for.
		if (!docked) open = false;
		await offers.reread(note).catch(() => {});
		onOpen(note, offers.on(note).length > 0 ? 'offers' : undefined);
	}
</script>

<SideDock
	bind:open
	onDocked={(is) => (docked = is)}
	title={reviewing ? 'The draft' : 'Chat about the code'}
	wall="How much room the chat takes"
	outer={1}
	scrolls={false}
	width={prefs.current.chatWidth}
	onWidthChange={(px) => prefs.set('chatWidth', px)}
>
	{#if reviewing}
		<DraftReview onBack={() => (reviewing = false)} onDone={draftGone} />
	{:else}
		<div class="flex min-h-0 flex-1 flex-col gap-3 pt-2">
			<div class="flex shrink-0 items-start gap-2">
				<div class="min-w-0 flex-1 px-1">
					<h2 class="truncate text-sm font-medium">Chat about the code</h2>
				</div>
				{#if chat.turns.length > 0}
					<Button
						variant="ghost"
						class="h-9 shrink-0 px-2 text-xs"
						onclick={() => {
							aside = null;
							chat.startAgain();
						}}
					>
						Start again
					</Button>
				{/if}
				<Button
					variant="ghost"
					class="size-9 shrink-0"
					aria-label="Close the chat"
					onclick={() => (open = false)}
				>
					<X class="size-4" />
				</Button>
			</div>

			{#if standing}
				<div
					class="flex shrink-0 flex-wrap items-center gap-1 rounded-lg border border-border px-2 py-1"
				>
					<p class="min-w-0 flex-1 text-xs text-muted-foreground">
						A draft is standing — {holds === '' ? NOTHING_YET : holds}.{chat.running
							? ' The chat is still writing into it.'
							: ''}
					</p>
					<Button
						variant="ghost"
						class="h-9 shrink-0 px-2 text-xs"
						disabled={chatDraft.busy || chat.running}
						onclick={() => void review()}
					>
						Review
					</Button>
					<Button
						variant="ghost"
						class="h-9 shrink-0 px-2 text-xs"
						disabled={chatDraft.busy || chat.running}
						onclick={() => void throwTheDraftAway()}
					>
						Discard
					</Button>
					<p class="w-full text-xs text-muted-foreground">{DISCARD_COSTS}</p>
				</div>
			{/if}

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
							understand first. The microphone on your keyboard types into it too.
						</p>
						{#if chatDraft.keeps}
							<p class="px-1 text-sm text-muted-foreground">{WORKS_IN_A_DRAFT}</p>
						{/if}
					{/if}

					<ChatThread
						turns={chat.turns}
						live={chat.running}
						busy={keeping !== null || chat.keepSettling}
						done={(call) => chat.done(call)}
						kept={(at) => chat.kept(at)}
						keeping={keeping
							? { at: keeping.at, ...(keepShown === null ? {} : { card: keepShown }) }
							: null}
						settling={chat.keepSettling}
						onKeep={keep}
						onKept={(allowed) => void chat.keepIt(allowed)}
						onOpen={(note) => void read(note)}
					/>

					{#if chat.trouble}
						<p class="px-1 text-sm text-destructive" role="alert">{chat.trouble}</p>
					{/if}
				</div>

				{#if chat.attached.length > 0}
					<ul class="flex shrink-0 flex-wrap gap-1">
						{#each chat.attached as file (file.path)}
							<li
								class="inline-flex min-w-0 items-center gap-1 rounded-md border border-border py-1 pr-1 pl-2 text-xs"
							>
								<span class="max-w-40 truncate">{file.name}</span>
								<Button
									variant="ghost"
									class="size-7 shrink-0"
									aria-label={`Take ${file.name} off`}
									onclick={() => void chat.takeOff(file.path)}
								>
									<X class="size-3" />
								</Button>
							</li>
						{/each}
					</ul>
				{/if}

				{#if aside}
					<p class="shrink-0 px-1 text-xs text-muted-foreground" role="alert">{aside}</p>
				{/if}

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
						maxlength={chat.roomToSay}
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
							disabled={said.trim() === '' && chat.attached.length === 0}
						>
							<ArrowUp class="size-4" />
						</Button>
					{/if}
				</form>

				<div class="flex shrink-0 flex-wrap items-center gap-1">
					<input
						bind:this={picker}
						type="file"
						multiple
						class="sr-only"
						aria-label="Attach a file"
						onchange={(event) => void take(event.currentTarget)}
					/>
					<Button
						variant="ghost"
						class="size-9 shrink-0"
						aria-label="Attach a file"
						onclick={() => picker?.click()}
					>
						<Paperclip class="size-4" />
					</Button>
					{#if models.length > 0}
						<DropdownMenu.Root>
							<DropdownMenu.Trigger>
								{#snippet child({ props })}
									<Button
										{...props}
										variant="ghost"
										class="h-9 gap-1 px-2 text-xs text-muted-foreground"
									>
										{picked?.name ?? 'Model'}
										<ChevronDown class="size-3.5" />
									</Button>
								{/snippet}
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="start" class="w-52">
								<DropdownMenu.RadioGroup
									value={chat.model ?? ''}
									onValueChange={(one) => chat.setModel(one === '' ? undefined : one)}
								>
									<DropdownMenu.RadioItem class="min-h-11" value="">
										Its own choice
									</DropdownMenu.RadioItem>
									{#each models as one (one.model)}
										<DropdownMenu.RadioItem class="min-h-11" value={one.model}>
											{one.name}
										</DropdownMenu.RadioItem>
									{/each}
								</DropdownMenu.RadioGroup>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					{/if}
					{#if answering}
						<p class="min-w-0 flex-1 text-xs text-muted-foreground">
							This one is being answered with {answering === 'its own' ? ITS_OWN : answering.name}.
							Start again to use {picked?.name ?? ITS_OWN}.
						</p>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</SideDock>
