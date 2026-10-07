<script lang="ts">
	// The head of the chat: which thread you are in, the way to every other one,
	// and what can be done to this one — DESIGN.md § Layout.
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import { CHAT_THREAD_NAME_MAX, type Ulid } from '@sloppy/types';
	import { ResponsiveModal } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import * as DropdownMenu from '@sloppy/ui/dropdown-menu';
	import { Input } from '@sloppy/ui/input';
	import { onDestroy } from 'svelte';
	import { draftHolds } from '../draft-said.js';
	import { chat, type DraftOnDelete } from '../stores/chat.svelte.js';
	import { chatDraft } from '../stores/chat-draft.svelte.js';

	let {
		/** Read the draft of the thread in front of somebody, which is where a
		 *  delete that could not merge it says to go. */
		onReview
	}: { onReview: () => void } = $props();

	/** What the head reads for a chat nothing has been said into yet. */
	const NEW_THREAD = 'New thread';

	const COPIED = 'Copied.';
	const UNCOPIED = 'Sloppy could not copy it here. Select the chat and copy it yourself.';

	/** How long what just happened stays on screen. */
	const SAID_FOR = 4000;

	const thread = $derived(chat.current);
	const live = $derived(chat.threads);
	const archived = $derived(chat.archived);
	const holds = $derived(chatDraft.counts ? draftHolds(chatDraft.counts) : '');
	/** Whether this thread's draft holds writing nobody has taken in yet, which
	 *  is what makes deleting it a question rather than an act. */
	const unmerged = $derived(chatDraft.standing !== null && (holds !== '' || chatDraft.wrote));
	const draftSays = $derived(
		holds !== ''
			? `Its draft holds ${holds}. Merge it first, or it goes with the thread.`
			: 'The chat has written into its draft. Merge it first, or it goes with the thread.'
	);

	let renaming = $state(false);
	let typed = $state('');
	let field = $state.raw<HTMLInputElement | null>(null);
	let said = $state<string | null>(null);
	let asking = $state(false);
	let refused = $state<string | null>(null);
	let saying: ReturnType<typeof setTimeout> | undefined;

	onDestroy(() => clearTimeout(saying));

	$effect(() => {
		if (!renaming) return;
		field?.focus();
		field?.select();
	});

	function tell(words: string): void {
		said = words;
		clearTimeout(saying);
		saying = setTimeout(() => (said = null), SAID_FOR);
	}

	function beginRename(): void {
		typed = thread?.name ?? '';
		renaming = true;
	}

	function rename(): void {
		if (!renaming) return;
		renaming = false;
		void chat.rename(typed);
	}

	async function copy(): Promise<void> {
		const whole = chat.copyAsMarkdown();
		if (whole === '') return;
		try {
			await navigator.clipboard.writeText(whole);
			tell(COPIED);
		} catch {
			tell(UNCOPIED);
		}
	}

	function ask(): void {
		refused = null;
		asking = true;
	}

	async function remove(draft: DraftOnDelete): Promise<void> {
		const id = thread?.id;
		if (id === undefined) return;
		refused = null;
		if (await chat.remove(id, draft)) asking = false;
		else refused = chat.trouble;
	}

	function putBackThis(): void {
		const id = thread?.id;
		if (id !== undefined) void chat.putBack(id);
	}

	function readTheDraft(): void {
		asking = false;
		onReview();
	}
</script>

<div class="min-w-0 flex-1">
	<div class="flex items-center gap-1">
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						class="size-9 shrink-0"
						aria-label="More about this thread"
					>
						<Ellipsis class="size-4" />
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="start" class="w-56">
				<DropdownMenu.Item class="min-h-control" disabled={thread === null} onSelect={beginRename}>
					Rename
				</DropdownMenu.Item>
				{#if thread?.archived_at !== undefined}
					<DropdownMenu.Item class="min-h-control" onSelect={putBackThis}>
						Put back
					</DropdownMenu.Item>
				{:else}
					<DropdownMenu.Item
						class="min-h-control"
						disabled={thread === null}
						onSelect={() => void chat.archive()}
					>
						Archive
					</DropdownMenu.Item>
				{/if}
				<DropdownMenu.Item
					class="min-h-control"
					disabled={thread === null}
					onSelect={() => void copy()}
				>
					Copy the whole chat
				</DropdownMenu.Item>
				<DropdownMenu.Item class="min-h-control" disabled={thread === null} onSelect={ask}>
					Delete
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>

		{#if renaming}
			<Input
				bind:ref={field}
				bind:value={typed}
				maxlength={CHAT_THREAD_NAME_MAX}
				class="h-9 min-w-0 flex-1 text-sm"
				aria-label="What this thread is called"
				onblur={rename}
				onkeydown={(event) => {
					if (event.key === 'Enter') rename();
					else if (event.key === 'Escape') renaming = false;
				}}
			/>
		{:else}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							class="h-9 min-w-0 flex-1 justify-start gap-1 px-2"
							aria-label="Which thread"
						>
							<span class="truncate text-sm font-medium">{thread?.name ?? NEW_THREAD}</span>
							<ChevronDown class="size-3.5 shrink-0 text-muted-foreground" />
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="start" class="w-72">
					<DropdownMenu.Item class="min-h-control" onSelect={() => void chat.startThread()}>
						New thread
					</DropdownMenu.Item>
					{#if live.length > 0}
						<DropdownMenu.Separator />
						<DropdownMenu.RadioGroup
							value={thread?.id ?? ''}
							onValueChange={(id) => void chat.openThread(id as Ulid)}
						>
							{#each live as one (one.id)}
								<DropdownMenu.RadioItem class="min-h-control" value={one.id}>
									<span class="block min-w-0 flex-1 truncate">{one.name}</span>
									{#if chat.answeringAway(one.id)}
										<span
											class="shrink-0 text-xs text-muted-foreground"
											aria-label={`${one.name} is still answering`}
										>
											answering
										</span>
									{/if}
								</DropdownMenu.RadioItem>
							{/each}
						</DropdownMenu.RadioGroup>
					{/if}
					{#if archived.length > 0}
						<DropdownMenu.Separator />
						<DropdownMenu.Group>
							<DropdownMenu.GroupHeading class="text-xs">Archived</DropdownMenu.GroupHeading>
							{#each archived as one (one.id)}
								<DropdownMenu.Item
									class="min-h-control"
									aria-label={`Put ${one.name} back`}
									onSelect={() => void chat.putBack(one.id)}
								>
									<span class="min-w-0 flex-1 truncate">{one.name}</span>
									<span class="shrink-0 text-xs text-muted-foreground">Put back</span>
								</DropdownMenu.Item>
							{/each}
						</DropdownMenu.Group>
					{/if}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		{/if}
	</div>
	{#if said}
		<p class="px-1 text-xs text-muted-foreground" role="status">{said}</p>
	{/if}
</div>

<ResponsiveModal
	bind:open={asking}
	title="Delete this thread?"
	description={unmerged
		? draftSays
		: 'This thread and what was said in it go. Your own notes are untouched.'}
>
	<div class="flex flex-col gap-2 px-2 pt-4">
		{#if refused}
			<p class="text-sm text-destructive" role="alert">{refused}</p>
			{#if unmerged}
				<Button variant="outline" class="h-control sm:h-9" onclick={readTheDraft}>
					Read the draft
				</Button>
			{/if}
		{/if}
		{#if unmerged}
			<Button class="h-control sm:h-9" onclick={() => void remove('merge')}>
				Merge it, then delete
			</Button>
			<Button variant="outline" class="h-control sm:h-9" onclick={() => void remove('discard')}>
				Delete it with the thread
			</Button>
			<Button variant="ghost" class="h-control sm:h-9" onclick={() => (asking = false)}>
				Keep the thread
			</Button>
		{:else}
			<Button class="h-control sm:h-9" onclick={() => void remove('discard')}>Delete</Button>
			<Button variant="ghost" class="h-control sm:h-9" onclick={() => (asking = false)}>
				Keep it
			</Button>
		{/if}
	</div>
</ResponsiveModal>
