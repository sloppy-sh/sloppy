<script lang="ts" module>
	import type { NoteComment, NoteReaction, StoreRef } from '@sloppy/types';
	import type { NoteEmoji } from '../editor/contract.js';
	import type { Person } from '../identity/person.js';
	import type { ReactionPick } from './reaction-picker.svelte';

	/** Whoever a surface is about to name, and the ask that resolves them. */
	export interface ConversationPeople {
		of: (did: string) => Person | null;
		resolve: (did: string) => void;
	}

	export interface ConversationProps {
		comments: readonly NoteComment[];
		reactions: readonly NoteReaction[];
		/** The signed-in identity: what they wrote is what they can take back. */
		mine: string;
		people: ConversationPeople;
		/** Where {@link ConversationProps.mine}'s own catalog is read from — the
		 *  only one a reaction may be picked out of. */
		emoji: NoteEmoji;
		loading?: boolean;
		/** Why the conversation would not read, in the caller's words. */
		unreadable?: string | null;
		onsay: (content: string, replyTo?: StoreRef) => Promise<void>;
		onunsay: (commentId: StoreRef) => Promise<void>;
		onreact: (pick: ReactionPick) => Promise<void>;
		onunreact: (reactionId: StoreRef) => Promise<void>;
	}
</script>

<script lang="ts">
	// What people said on a note, and the way to say something back. A reader
	// reaches only their own identity store and those of the people they follow,
	// so this shows what those hold and never claims to show more —
	// docs/ARCHITECTURE.md § "Federating the graph".
	import SmilePlus from '@lucide/svelte/icons/smile-plus';
	import X from '@lucide/svelte/icons/x';
	import { NOTE_COMMENT_MAX } from '@sloppy/types';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import Avatar from '../identity/avatar.svelte';
	import { nameOf } from '../identity/person.js';
	import ReactionPicker from './reaction-picker.svelte';
	import { emojiCatalogs } from '../../emoji/catalogs.svelte.js';
	import { when } from './when.js';

	let {
		comments,
		reactions,
		mine,
		people,
		emoji,
		loading = false,
		unreadable = null,
		onsay,
		onunsay,
		onreact,
		onunreact
	}: ConversationProps = $props();

	let draft = $state('');
	let replyingTo = $state<NoteComment | null>(null);
	let saying = $state(false);
	let refused = $state<string | null>(null);
	let picking = $state(false);

	const ownEmoji = $derived(emojiCatalogs.of(mine, emoji.catalog));

	const said = $derived(new Map(comments.map((comment) => [comment.comment_id, comment])));

	/** The comment at the head of the thread this one is in. A `reply_to` naming
	 *  something the reader cannot see is an ordinary state of a thread, so that
	 *  comment heads its own. */
	function threadHead(comment: NoteComment): NoteComment {
		let at = comment;
		// One step per comment at most. Past that the chain has looped, and a
		// comment in a loop heads its own thread rather than disappearing.
		for (let step = 0; step < comments.length; step += 1) {
			const above = at.reply_to === undefined ? undefined : said.get(at.reply_to);
			if (!above) return at;
			at = above;
		}
		return comment;
	}

	const threads = $derived(
		comments
			.filter((one) => threadHead(one) === one)
			.map((head) => ({
				head,
				replies: comments.filter((one) => one !== head && threadHead(one) === head)
			}))
	);

	const speakers = $derived([
		...new Set([
			...comments.map((comment) => comment.author),
			...reactions.map((reaction) => reaction.author)
		])
	]);

	$effect(() => {
		for (const did of speakers) people.resolve(did);
	});

	function named(did: string): string {
		const person = people.of(did);
		return person ? nameOf(person) : 'Somebody';
	}

	async function say(): Promise<void> {
		const content = draft.trim();
		if (!content || saying) return;
		saying = true;
		refused = null;
		try {
			await onsay(content, replyingTo?.comment_id);
			draft = '';
			replyingTo = null;
		} catch (error) {
			refused = says(error, 'That could not be posted. Try again in a moment.');
		} finally {
			saying = false;
		}
	}

	async function pick(chosen: ReactionPick): Promise<void> {
		refused = null;
		try {
			await onreact(chosen);
		} catch (error) {
			refused = says(error, 'That reaction could not be added. Try again in a moment.');
		}
	}

	async function unreact(reaction: NoteReaction): Promise<void> {
		refused = null;
		try {
			await onunreact(reaction.reaction_id);
		} catch (error) {
			refused = says(error, 'That reaction could not be removed. Try again in a moment.');
		}
	}

	async function unsay(one: NoteComment): Promise<void> {
		refused = null;
		try {
			await onunsay(one.comment_id);
		} catch (error) {
			refused = says(error, 'That could not be removed. Try again in a moment.');
		}
	}

	function shownAs(reaction: NoteReaction): string {
		return reaction.kind === 'character' ? reaction.character : reaction.emoji.shortcode;
	}

	function says(error: unknown, otherwise: string): string {
		return error instanceof Error && error.message ? error.message : otherwise;
	}
</script>

{#snippet chip(reaction: NoteReaction)}
	{#if reaction.kind === 'character'}
		<span class="text-base leading-none">{reaction.character}</span>
	{:else}
		<img src={reaction.emoji.src} alt={reaction.emoji.shortcode} class="size-4 object-contain" />
	{/if}
	<span class="max-w-24 truncate">{named(reaction.author)}</span>
{/snippet}

{#snippet comment(one: NoteComment)}
	{@const person = people.of(one.author)}
	<article class="flex gap-3">
		{#if person}
			<Avatar {person} size={28} />
		{:else}
			<Skeleton class="size-7 shrink-0 rounded-full" />
		{/if}
		<div class="min-w-0 flex-1 space-y-1">
			<div class="flex items-baseline gap-2">
				<span class="truncate text-sm font-medium">{named(one.author)}</span>
				<span class="shrink-0 text-xs text-muted-foreground">{when(one.created_at)}</span>
			</div>
			<p class="text-sm whitespace-pre-wrap">{one.content}</p>
			<div class="flex items-center gap-1">
				<Button
					variant="ghost"
					class="-ml-2 h-9 px-2 text-xs text-muted-foreground"
					onclick={() => (replyingTo = one)}
				>
					Reply
				</Button>
				{#if one.author === mine}
					<Button
						variant="ghost"
						size="icon"
						class="size-9 text-muted-foreground hover:text-destructive"
						aria-label="Take this back"
						onclick={() => unsay(one)}
					>
						<X class="size-3.5" />
					</Button>
				{/if}
			</div>
		</div>
	</article>
{/snippet}

<section class="@container space-y-4 border-t border-border pt-6">
	<div class="space-y-1">
		<h2 class="text-sm font-medium text-muted-foreground">Conversation</h2>
		<p class="text-xs text-muted-foreground">
			You see what you and the people you follow have written.
		</p>
	</div>

	<div class="flex flex-wrap items-center gap-1.5">
		{#each reactions as reaction (reaction.reaction_id)}
			{#if reaction.author === mine}
				<button
					type="button"
					aria-label="Take back your {shownAs(reaction)}"
					onclick={() => unreact(reaction)}
					class="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 px-2.5 text-xs transition-colors duration-150 ease-out hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
				>
					{@render chip(reaction)}
				</button>
			{:else}
				<span
					class="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs text-muted-foreground"
				>
					{@render chip(reaction)}
				</span>
			{/if}
		{/each}
		<Button
			variant="ghost"
			size="icon"
			class="size-9 text-muted-foreground"
			aria-label="React to this note"
			onclick={() => (picking = true)}
		>
			<SmilePlus class="size-4" />
		</Button>
	</div>

	{#if loading && comments.length === 0}
		<Skeleton class="h-16 w-full" />
	{:else if unreadable && comments.length === 0}
		<p class="text-sm text-destructive" role="alert">{unreadable}</p>
	{:else if threads.length === 0}
		<p class="text-sm text-muted-foreground">Nothing said here yet.</p>
	{:else}
		<ul class="space-y-5">
			{#each threads as thread (thread.head.comment_id)}
				<li class="space-y-4">
					{@render comment(thread.head)}
					{#if thread.replies.length > 0}
						<ul class="space-y-4 border-l border-border pl-3">
							{#each thread.replies as reply (reply.comment_id)}
								<li>{@render comment(reply)}</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<div class="space-y-2">
		{#if replyingTo}
			<div class="flex items-center gap-2 text-xs text-muted-foreground">
				<span class="min-w-0 truncate">Answering {named(replyingTo.author)}</span>
				<Button
					variant="ghost"
					size="icon"
					class="size-8"
					aria-label="Answer the note instead"
					onclick={() => (replyingTo = null)}
				>
					<X class="size-3.5" />
				</Button>
			</div>
		{/if}
		<Textarea
			bind:value={draft}
			rows={2}
			maxlength={NOTE_COMMENT_MAX}
			placeholder="Say something"
			aria-label="Say something"
			class="min-h-16"
		/>
		{#if refused}
			<p class="text-sm text-destructive" role="alert">{refused}</p>
		{/if}
		<Button
			class="h-11 w-full @md:h-9 @md:w-fit"
			disabled={saying || draft.trim() === ''}
			onclick={say}
		>
			Post
		</Button>
	</div>
</section>

<ReactionPicker bind:open={picking} custom={ownEmoji} onpick={pick} />
