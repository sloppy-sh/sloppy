<script lang="ts" module>
	import type {
		Address,
		CommentAccess,
		OwnedRef,
		PublishedNoteChange,
		PublishedVersion
	} from '@sloppy/types';

	/** A branch as it stands published: the chain a person reads back, newest
	 *  version first, and who the author invites to answer it. */
	export interface PublishedBranch {
		versions: readonly PublishedVersion[];
		comments: CommentAccess;
	}

	export interface PublishModalProps {
		open?: boolean;
		/** The branch's root, as a person cites it. */
		address: Address;
		/** Absent where nothing here is published yet. */
		published?: PublishedBranch | null;
		/** A branch above this one that already carries it, if there is one. */
		carriedBy?: Address | null;
		/** Branches under this one that were published inviting fewer people. */
		narrower?: readonly Address[];
		/** True where a note in this branch has changed since the newest version.
		 *  False says nothing: it is silent where it cannot tell. */
		changedSince?: boolean;
		/** Why the last act did not land, in the caller's words. */
		refused?: string | null;
		onpublish: () => Promise<void>;
		oncomments: (access: CommentAccess) => Promise<void>;
		onunpublish: () => Promise<void>;
		/** What the writing did between two versions, read when somebody asks. */
		onchanges: (from: OwnedRef, to: OwnedRef) => Promise<readonly PublishedNoteChange[]>;
	}
</script>

<script lang="ts">
	// Publishing a branch, and everything a person does to one afterwards. What
	// publishing exposes is said here, at the decision, and nowhere else —
	// DESIGN.md § Forms.
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import type { PublishedSectionChange } from '@sloppy/types';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import ConfirmModal from '../confirm/confirm-modal.svelte';
	import ResponsiveModal from '../responsive-modal.svelte';
	import { scrollFade } from '$lib/scroll-fade.svelte.js';
	import { when } from '../social/when.js';

	let {
		open = $bindable(false),
		address,
		published = null,
		carriedBy = null,
		narrower = [],
		changedSince = false,
		refused = null,
		onpublish,
		oncomments,
		onunpublish,
		onchanges
	}: PublishModalProps = $props();

	const newest = $derived(published?.versions[0] ?? null);

	let working = $state(false);
	let takingDown = $state(false);
	/** The version whose difference from the one before it is being read, and
	 *  what came back. */
	let opened = $state<OwnedRef | null>(null);
	let difference = $state<{ of: OwnedRef; changes: readonly PublishedNoteChange[] } | null>(null);
	let unreadable = $state<string | null>(null);

	const shown = $derived(difference?.of === opened ? difference.changes : null);

	const terms: { value: CommentAccess; label: string; says: string }[] = [
		{ value: 'anyone', label: 'Anyone', says: 'Anyone reading it can answer.' },
		{ value: 'nobody', label: 'Nobody', says: 'You are not taking answers here.' }
	];

	async function act(what: () => Promise<void>): Promise<void> {
		working = true;
		try {
			await what();
		} catch {
			// `refused` is what the caller says about it.
		} finally {
			working = false;
		}
	}

	/** The version before `of` in the chain, which is what it is compared with.
	 *  The oldest has none, so nothing to open. */
	function precursor(of: OwnedRef): PublishedVersion | undefined {
		const chain = published?.versions ?? [];
		const at = chain.findIndex((version) => version.ref === of);
		return at < 0 ? undefined : chain[at + 1];
	}

	async function openChanges(version: PublishedVersion): Promise<void> {
		if (opened === version.ref) {
			opened = null;
			return;
		}
		const before = precursor(version.ref);
		if (!before) return;
		opened = version.ref;
		unreadable = null;
		try {
			const changes = await onchanges(before.ref, version.ref);
			difference = { of: version.ref, changes };
		} catch {
			difference = null;
			unreadable = 'Sloppy could not read what changed. Try again in a moment.';
		}
	}

	function became(change: PublishedNoteChange): string {
		if (change.change === 'added') return 'New';
		return change.change === 'removed' ? 'Gone' : 'Changed';
	}

	/** What became of a note's sections, where the note itself is not new — every
	 *  section of a new note arrived with it, and counting them says nothing. */
	function sectionsOf(change: PublishedNoteChange): string | null {
		if (change.change !== 'changed' || change.sections.length === 0) return null;
		const counted = (kind: PublishedSectionChange['change']) =>
			change.sections.filter((section) => section.change === kind).length;
		const parts = [
			[counted('added'), 'added'],
			[counted('changed'), 'rewritten'],
			[counted('removed'), 'taken out']
		] as const;
		const said = parts
			.filter(([count]) => count > 0)
			.map(([count, word]) => `${count} ${count === 1 ? 'section' : 'sections'} ${word}`);
		return said.length > 0 ? said.join(', ') : null;
	}

	// A sheet reopened on another note must not show the difference read for the
	// last one, and a chain that has moved on must not keep an old panel open.
	$effect(() => {
		if (open) return;
		opened = null;
		difference = null;
		unreadable = null;
	});
</script>

<ResponsiveModal
	bind:open
	title={published ? `${address} is published` : `Publish ${address}?`}
	class="sm:max-w-lg"
>
	<div class="space-y-5 px-2 pt-3">
		{#if published && newest}
			<section class="space-y-2">
				<p class="text-sm text-muted-foreground">
					Anyone who can find your profile can read this branch.
				</p>
				<ul class="max-h-64 space-y-0.5 overflow-y-auto scroll-fade-y" {@attach scrollFade('y')}>
					{#each published.versions as version (version.ref)}
						{@const openable = precursor(version.ref) !== undefined}
						<li>
							<button
								type="button"
								disabled={!openable}
								aria-expanded={openable ? opened === version.ref : undefined}
								onclick={() => openChanges(version)}
								class="flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-left transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:hover:bg-transparent motion-reduce:transition-none"
							>
								<span class="shrink-0 address text-sm">Version {version.sequence}</span>
								<span class="min-w-0 flex-1 truncate text-sm text-muted-foreground">
									{when(version.published_at)}
								</span>
								{#if openable}
									<ChevronDown
										class="size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-out motion-reduce:transition-none {opened ===
										version.ref
											? 'rotate-180'
											: ''}"
									/>
								{/if}
							</button>

							{#if opened === version.ref}
								<div class="space-y-2 border-l border-border py-2 pl-3">
									{#if unreadable}
										<p class="text-sm text-destructive" role="alert">{unreadable}</p>
									{:else if !shown}
										<Skeleton class="h-9 w-full" />
									{:else if shown.length === 0}
										<p class="text-sm text-muted-foreground">
											The writing was the same as the version before it.
										</p>
									{:else}
										<ul class="space-y-1.5">
											{#each shown as change (change.note.ref)}
												<li class="space-y-0.5">
													<div class="flex items-baseline gap-2">
														<span class="shrink-0 address text-xs text-muted-foreground">
															{change.note.address}
														</span>
														<span class="min-w-0 flex-1 truncate text-sm">
															{change.note.title || 'Untitled'}
														</span>
														<Badge variant="outline" class="shrink-0 text-muted-foreground">
															{became(change)}
														</Badge>
													</div>
													{#if sectionsOf(change)}
														<p class="text-xs text-muted-foreground">{sectionsOf(change)}</p>
													{/if}
												</li>
											{/each}
										</ul>
									{/if}
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			</section>

			<section class="space-y-2">
				{#if changedSince}
					<p class="text-sm text-muted-foreground">This branch has changed since then.</p>
				{/if}
				<p class="text-sm text-muted-foreground">
					Publishing again sends {address} as it stands now. Every version before it stays readable.
				</p>
				{#each narrower as under (under)}
					<p class="text-sm text-muted-foreground">
						{under} is published inviting fewer people to answer. What is published here carries it on
						these terms.
					</p>
				{/each}
				<Button class="h-11 w-full" disabled={working} onclick={() => act(onpublish)}>
					Publish again
				</Button>
			</section>

			<section class="space-y-2">
				<h3 class="text-sm font-medium">Who may answer</h3>
				{#each terms as term (term.value)}
					<button
						type="button"
						disabled={working}
						aria-pressed={published.comments === term.value}
						onclick={() => act(() => oncomments(term.value))}
						class="flex min-h-12 w-full items-center gap-3 rounded-md px-2 text-left transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
					>
						<Check
							class="size-4 shrink-0 {published.comments === term.value
								? 'text-foreground'
								: 'text-transparent'}"
						/>
						<span class="min-w-0 flex-1">
							<span class="block text-sm">{term.label}</span>
							<span class="block text-xs text-muted-foreground">{term.says}</span>
						</span>
					</button>
				{/each}
			</section>

			{#if refused}
				<p class="text-sm text-destructive" role="alert">{refused}</p>
			{/if}

			<Button
				variant="ghost"
				class="h-11 w-full text-destructive hover:bg-destructive/10"
				disabled={working}
				onclick={() => {
					open = false;
					takingDown = true;
				}}
			>
				Take it down
			</Button>
		{:else}
			<div class="space-y-3 text-sm text-muted-foreground">
				<p>
					Everything under {address} goes out: every note in it, finished or not, and every picture in
					them.
				</p>
				<p>
					Anyone who can find your profile can read it. There is no address to keep back and nobody
					to let in.
				</p>
				<p>If you take it down, whoever has already read it keeps their copy.</p>
				<p>Anyone reading it may answer, until you say otherwise here.</p>
				{#if carriedBy}
					<p>{carriedBy} already carries this branch, on its own terms.</p>
				{/if}
				{#each narrower as under (under)}
					<p>
						{under} is published inviting fewer people to answer. What you publish here carries it on
						these terms.
					</p>
				{/each}
			</div>

			{#if refused}
				<p class="text-sm text-destructive" role="alert">{refused}</p>
			{/if}

			<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
				<Button
					variant="outline"
					class="h-11 sm:h-9"
					disabled={working}
					onclick={() => (open = false)}
				>
					Cancel
				</Button>
				<Button class="h-11 sm:h-9" disabled={working} onclick={() => act(onpublish)}>
					Publish
				</Button>
			</div>
		{/if}
	</div>
</ResponsiveModal>

<ConfirmModal
	bind:open={takingDown}
	title="Take {address} down?"
	description="Sloppy stops serving it, and the pictures in it stop being readable. Whoever has already read it keeps their copy of the writing."
	confirmLabel="Take it down"
	{refused}
	onconfirm={onunpublish}
/>
