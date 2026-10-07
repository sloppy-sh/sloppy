<script lang="ts">
	// One note of a draft, read where the draft is being reviewed — DESIGN.md
	// § "Reading a draft". It takes the review's place in the chat's own dock
	// rather than opening a second one, so it is reached at every width.
	import type { OwnedRef } from '@sloppy/types';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import { HeldStack, type ReferenceReader } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Skeleton } from '@sloppy/ui/skeleton';
	import { draftHeading, sectionsDrafted } from '../draft-said.js';
	import { noteEmoji } from '../note-surface.js';
	import { chatDraft, type DraftedNote, type DraftSide } from '../stores/chat-draft.svelte.js';
	import { session } from '../stores/session.svelte.js';

	let {
		opened = $bindable(null)
	}: {
		/** The note being read, and which of the two copies it is read from. */
		opened?: { ref: OwnedRef; side: DraftSide } | null;
	} = $props();

	/** What a row opens to for a note one side does not hold. */
	const BINNED = 'The draft puts this note in the bin.';
	const NOT_YOURS_YET = 'Your folder has no such note yet.';
	const UNWRITTEN = 'Nothing written in it.';

	const SIDES: { side: DraftSide; named: string }[] = [
		{ side: 'draft', named: 'In the draft' },
		{ side: 'folder', named: 'In your folder' }
	];

	const read = $derived(chatDraft.read);
	const name = $derived(opened ? draftHeading(read?.named.get(opened.ref)) : 'A note');
	const emoji = $derived(noteEmoji(session.viewer?.did ?? '').catalog);

	/** The copy that came back, and the row it was asked for. */
	let held = $state.raw<{ ref: OwnedRef; side: DraftSide; note: DraftedNote | null } | null>(null);

	/** The note in front of the reader. `undefined` is one still on its way. */
	const showing = $derived(
		held && opened && held.ref === opened.ref && held.side === opened.side ? held.note : undefined
	);

	/** Which of its sections the draft wrote, so the one a reader is looking for
	 *  is marked rather than hunted for. */
	const drafted = $derived(
		showing && read && opened?.side === 'draft'
			? sectionsDrafted(read.difference, opened.ref, showing.sections)
			: new Set<OwnedRef>()
	);

	/** A reference inside the note leads to that note on the side it was read
	 *  from, because that is the copy the reader is looking at. */
	const references: ReferenceReader = {
		read: async (note) => (await chatDraft.asRead(opened?.side ?? 'draft', note))?.note ?? null,
		open: (note) => (opened = { ref: note, side: opened?.side ?? 'draft' })
	};

	$effect(() => {
		const asked = opened;
		if (!asked) return;
		let live = true;
		void chatDraft.asRead(asked.side, asked.ref).then((note) => {
			if (live) held = { ...asked, note };
		});
		return () => {
			live = false;
		};
	});
</script>

{#if opened}
	{@const side = opened.side}
	{@const ref = opened.ref}
	<div class="flex min-h-0 flex-1 flex-col gap-3 pt-2">
		<div class="flex shrink-0 items-center gap-2">
			<Button
				variant="ghost"
				class="size-9 shrink-0"
				aria-label="Back to the draft"
				onclick={() => (opened = null)}
			>
				<ChevronLeft class="size-4" />
			</Button>
			<h2 class="min-w-0 flex-1 truncate text-sm font-medium">{name}</h2>
		</div>

		<div class="min-h-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto px-1">
			<div class="flex flex-wrap gap-1">
				{#each SIDES as one (one.side)}
					<Button
						variant={side === one.side ? 'secondary' : 'ghost'}
						class="h-9 rounded-full text-xs"
						aria-pressed={side === one.side}
						onclick={() => (opened = { ref, side: one.side })}
					>
						{one.named}
					</Button>
				{/each}
			</div>

			{#if showing === undefined}
				<Skeleton class="mt-4 h-24 w-full" />
			{:else if !showing}
				<p class="py-8 text-center text-muted-foreground">
					{side === 'draft' ? BINNED : NOT_YOURS_YET}
				</p>
			{:else if showing.sections.length === 0}
				<p class="py-8 text-center text-muted-foreground">{UNWRITTEN}</p>
			{:else}
				{@const shown = showing}
				<div class="mt-4 space-y-4">
					{#each shown.sections as section (section.ref)}
						<div class="space-y-1">
							{#if drafted.has(section.ref)}
								<p class="text-xs text-muted-foreground">Written into by the chat</p>
							{/if}
							<HeldStack
								note={shown.note}
								author={shown.note.created_by}
								blocks={[section]}
								pictures={{ held: true, picture: (upload) => shown.picture(upload) }}
								{references}
								{emoji}
							/>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/if}
