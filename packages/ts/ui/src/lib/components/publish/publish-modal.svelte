<script lang="ts" module>
	import type {
		Address,
		CommentAccess,
		OwnedRef,
		PublishedVersion,
		UnpublishedChanges
	} from '@sloppy/types';
	import type { VersionComparison } from './version-changes.svelte';

	/** A branch as it stands published: the version a reader gets, the chain
	 *  behind it newest first, the version just before the oldest of those, and
	 *  who the author invites to answer it. */
	export interface PublishedBranch {
		latest: PublishedVersion;
		/** Empty until the chain has been read, and `latest` is the whole of what
		 *  is known then. */
		versions: readonly PublishedVersion[];
		/** The publish before the oldest one listed, where the chain runs back
		 *  further than a person is shown. What the oldest listed one is read
		 *  against, and never a row of its own. */
		earlier?: PublishedVersion;
		comments: CommentAccess;
	}

	/** What somebody has to be given before they can read a published branch,
	 *  beside the address: who wrote it, and where the graph is answered. */
	export interface ReaderNeeds {
		identity?: string;
		where?: string;
	}

	export interface PublishModalProps {
		open?: boolean;
		/** The branch's root, as a person cites it. */
		address: Address;
		reader?: ReaderNeeds;
		/** Absent where nothing here is published yet. */
		published?: PublishedBranch | null;
		/** A branch above this one that already carries it, if there is one. */
		carriedBy?: Address | null;
		/** Branches under this one that were published inviting fewer people. */
		narrower?: readonly Address[];
		/** True where a note in this branch has changed since the newest version.
		 *  False says nothing: it is silent where it cannot tell. What
		 *  {@link onpending} answers replaces it the moment it arrives. */
		changedSince?: boolean;
		/** False where answers people write will never reach this person, so the
		 *  sheet promises none. What readers are invited to do is unaffected. */
		answersReach?: boolean;
		/** Why the last act did not land, in the caller's words. */
		refused?: string | null;
		/** What one publish changed, a page at a time: the difference between two
		 *  of this branch's versions, in that order. `null` where it could not be
		 *  read, which {@link refused} then says. */
		onchanges: (from: OwnedRef, to: OwnedRef, cursor?: string) => Promise<VersionComparison | null>;
		/** What the branch has done since the newest version went out. `null`
		 *  where it could not be read, which leaves {@link changedSince} standing. */
		onpending: () => Promise<UnpublishedChanges | null>;
		onpublish: () => Promise<void>;
		oncomments: (access: CommentAccess) => Promise<void>;
		onunpublish: () => Promise<void>;
	}
</script>

<script lang="ts">
	// Publishing a branch, and everything a person does to one afterwards. What
	// publishing exposes is said here, at the decision, and nowhere else —
	// DESIGN.md § Forms.
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Check from '@lucide/svelte/icons/check';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import ConfirmModal from '../confirm/confirm-modal.svelte';
	import ResponsiveModal from '../responsive-modal.svelte';
	import { scrollFade } from '$lib/scroll-fade.svelte.js';
	import { when } from '../social/when.js';
	import PendingChanges from './pending-changes.svelte';
	import { alreadyCarried, narrowerSays, publishingAgain, publishingSays } from './terms.js';
	import VersionChanges from './version-changes.svelte';

	let {
		open = $bindable(false),
		address,
		reader = {},
		published = null,
		carriedBy = null,
		narrower = [],
		changedSince = false,
		answersReach = true,
		refused = null,
		onchanges,
		onpending,
		onpublish,
		oncomments,
		onunpublish
	}: PublishModalProps = $props();

	const chain = $derived(
		published ? (published.versions.length > 0 ? published.versions : [published.latest]) : []
	);

	let working = $state(false);
	/** What the branch has done since it was last published, once the instance
	 *  has answered. Until then the sheet has only {@link changedSince}. */
	let pending = $state<UnpublishedChanges | null>(null);
	let takingDown = $state(false);
	/** True once the take-down itself has been refused, so the sheet's refusal
	 *  for some other act is not re-shown over a question about this one. */
	let downRefused = $state(false);

	/** The publish being read, and the one it is read against — absent where this
	 *  is the first, which nothing precedes. */
	let reviewing = $state<PublishedVersion | null>(null);
	let against = $state<PublishedVersion | null>(null);
	let compared = $state<VersionComparison | null>(null);
	let reading = $state(false);
	/** The newest ask. The back arrow stays live while one is in flight, so an
	 *  answer to a question that has been left behind is dropped rather than
	 *  drawn under the heading of the one that replaced it. */
	let latest = 0;

	/** The version published before this one, as far as the chain in hand goes.
	 *  Past the end of the list, the one the caller kept back for exactly this. */
	function before(at: number): PublishedVersion | undefined {
		return chain[at + 1] ?? (at === chain.length - 1 ? published?.earlier : undefined);
	}

	function comparable(version: PublishedVersion, at: number): boolean {
		return version.sequence === 1 || before(at) !== undefined;
	}

	/** One page of one comparison, kept only while it is still the one being
	 *  read. */
	async function ask(
		from: PublishedVersion,
		to: PublishedVersion,
		cursor: string | undefined,
		keep: (page: VersionComparison) => void
	): Promise<void> {
		const mine = ++latest;
		reading = true;
		try {
			const page = await onchanges(from.ref, to.ref, cursor);
			if (mine !== latest || !page) return;
			keep(page);
		} finally {
			if (mine === latest) reading = false;
		}
	}

	async function review(
		version: PublishedVersion,
		earlier: PublishedVersion | undefined
	): Promise<void> {
		latest += 1;
		reviewing = version;
		against = earlier ?? null;
		compared = null;
		if (!earlier) return;
		await ask(earlier, version, undefined, (page) => {
			compared = page;
		});
	}

	/** The next page of one comparison, with anything it repeats left out — a
	 *  note that moved, moved once. */
	async function more(cursor: string): Promise<void> {
		const to = reviewing;
		const from = against;
		if (!to || !from) return;
		await ask(from, to, cursor, (page) => {
			const held = new Set((compared?.changes ?? []).map((one) => one.note.ref));
			compared = {
				changes: [
					...(compared?.changes ?? []),
					...page.changes.filter((one) => !held.has(one.note.ref))
				],
				...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor })
			};
		});
	}

	// Nothing about one comparison belongs to the next thing this sheet is
	// opened for.
	$effect(() => {
		if (open) return;
		latest += 1;
		reading = false;
		reviewing = null;
		against = null;
		compared = null;
	});

	/** The version the answer in hand is measured against, so a re-render that
	 *  hands the sheet an equal branch does not ask all over again. */
	let askedAgainst: OwnedRef | null = null;
	/** The newest ask, so an answer to a question that has been left behind is
	 *  dropped rather than drawn against the version that replaced it. */
	let asking = 0;

	// Writing moves while the sheet is shut, so what it says the branch has done
	// is read again every time somebody opens it, and again after a publish.
	$effect(() => {
		const version = open && published ? published.latest.ref : null;
		if (version === askedAgainst) return;
		askedAgainst = version;
		pending = null;
		const mine = ++asking;
		if (version === null) return;
		void onpending().then((answer) => {
			if (mine === asking) pending = answer;
		});
	});

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

	async function takeDown(): Promise<void> {
		downRefused = false;
		try {
			await onunpublish();
		} catch (error) {
			downRefused = true;
			throw error;
		}
	}
</script>

<ResponsiveModal
	bind:open
	title={reviewing
		? against
			? `What version ${reviewing.sequence} changed`
			: `Version ${reviewing.sequence}`
		: published
			? `${address} is published`
			: `Publish ${address}?`}
	class="sm:max-w-lg"
>
	<div class="space-y-5 px-2 pt-3">
		{#if reviewing}
			<button
				type="button"
				onclick={() => {
					latest += 1;
					reading = false;
					reviewing = null;
				}}
				class="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
			>
				<ArrowLeft class="size-4" />
				Publishing
			</button>

			{#if against}
				<p class="text-sm text-muted-foreground">
					Against version {against.sequence}, published {when(against.published_at)}.
				</p>
				{#if reading && !compared}
					<Skeleton class="h-24 w-full" />
				{:else if compared}
					<VersionChanges
						changes={compared.changes}
						nextCursor={compared.nextCursor}
						busy={reading}
						onmore={more}
					/>
				{/if}
			{:else}
				<p class="text-sm text-muted-foreground">
					This is where {address} was first published, so everything in it went out at once.
				</p>
			{/if}

			{#if refused}
				<p class="text-sm text-destructive" role="alert">{refused}</p>
			{/if}
		{:else if published}
			<section class="space-y-2">
				<p class="text-sm text-muted-foreground">
					Anyone who can find your profile can read this branch.
				</p>
				<ul class="max-h-64 space-y-0.5 overflow-y-auto scroll-fade-y" {@attach scrollFade('y')}>
					{#each chain as version, at (version.ref)}
						{#if comparable(version, at)}
							<li>
								<button
									type="button"
									onclick={() => review(version, before(at))}
									class="flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-left transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
								>
									<span class="shrink-0 address text-sm">Version {version.sequence}</span>
									<span class="min-w-0 flex-1 truncate text-sm text-muted-foreground">
										{when(version.published_at)}
									</span>
									<span class="sr-only">
										{before(at) ? 'See what it changed' : 'See what was first published'}
									</span>
									<ChevronRight class="size-4 shrink-0 text-muted-foreground" />
								</button>
							</li>
						{:else}
							<li class="flex min-h-11 items-center gap-3 px-2">
								<span class="shrink-0 address text-sm">Version {version.sequence}</span>
								<span class="min-w-0 flex-1 truncate text-sm text-muted-foreground">
									{when(version.published_at)}
								</span>
							</li>
						{/if}
					{/each}
				</ul>
			</section>

			{#if reader.identity || reader.where}
				<section class="space-y-2">
					<h3 class="text-sm font-medium">What a reader needs</h3>
					<p class="text-sm text-muted-foreground">Send somebody this and they can read it.</p>
					<dl class="space-y-2">
						<div>
							<dt class="text-xs text-muted-foreground">This branch</dt>
							<dd class="address text-sm break-all select-text">{address}</dd>
						</div>
						{#if reader.identity}
							<div>
								<dt class="text-xs text-muted-foreground">Your identity</dt>
								<dd class="address text-sm break-all select-text">{reader.identity}</dd>
							</div>
						{/if}
						{#if reader.where}
							<div>
								<dt class="text-xs text-muted-foreground">Where your graph is</dt>
								<dd class="address text-sm break-all select-text">{reader.where}</dd>
							</div>
						{/if}
					</dl>
				</section>
			{/if}

			<section class="space-y-2">
				{#if pending}
					{#if pending.total > 0}
						<p class="text-sm text-muted-foreground">This branch has changed since then.</p>
						<PendingChanges changes={pending.changes} total={pending.total} />
					{/if}
				{:else if changedSince}
					<p class="text-sm text-muted-foreground">This branch has changed since then.</p>
				{/if}
				<p class="text-sm text-muted-foreground">{publishingAgain({ address })}</p>
				{#each narrower as under (under)}
					<p class="text-sm text-muted-foreground">{narrowerSays(under, 'already')}</p>
				{/each}
				<Button class="h-11 w-full" disabled={working} onclick={() => act(onpublish)}>
					Publish again
				</Button>
			</section>

			<section class="space-y-2">
				<h3 class="text-sm font-medium">Who may answer</h3>
				{#if !answersReach}
					<p class="text-sm text-muted-foreground">
						Answers still reach people reading it elsewhere — you just will not see them here.
					</p>
				{/if}
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
					downRefused = false;
					takingDown = true;
				}}
			>
				Take it down
			</Button>
		{:else}
			<div class="space-y-3 text-sm text-muted-foreground">
				{#each publishingSays({ address }, answersReach) as line (line)}
					<p>{line}</p>
				{/each}
				{#if carriedBy}
					<p>{alreadyCarried({ address }, carriedBy)}</p>
				{/if}
				{#each narrower as under (under)}
					<p>{narrowerSays(under, 'going')}</p>
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
	description="Nobody new can read it, and the pictures in it stop opening. Whoever has already read it keeps their copy of the writing."
	confirmLabel="Take it down"
	refused={downRefused ? refused : null}
	onconfirm={takeDown}
/>
