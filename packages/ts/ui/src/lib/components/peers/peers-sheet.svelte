<script lang="ts">
	// Reading somebody else's graph: the regions already held and what has been
	// published since, the notes of the reader's own that strangers answered, the
	// people the reader follows, and the way to find somebody who is neither.
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Search from '@lucide/svelte/icons/search';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import UserMinus from '@lucide/svelte/icons/user-minus';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import { type OwnedRef, peerOrigin, type PublishedVersion } from '@sloppy/types';
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { nameOf, nameOr } from '../identity/person.js';
	import VersionChanges, { type VersionComparison } from '../publish/version-changes.svelte';
	import { when } from '../social/when.js';
	import ResponsiveModal from '../responsive-modal.svelte';
	import { byNotebook } from './notebooks.js';
	import type { Answered, HeldRegion, Peer, PublishedThere } from './peer.js';
	import PeerName from './peer-name.svelte';
	import PublishedRoots from './published-roots.svelte';

	let {
		open = $bindable(false),
		regions,
		following,
		answers = [],
		asking = null,
		busy = false,
		says = null,
		onEnter,
		onDrop,
		onLook,
		onPull,
		onRefresh,
		onChain,
		onChanges,
		onFollow,
		onUnfollow,
		onOpenAnswer,
		onRetry
	}: {
		open?: boolean;
		regions: readonly HeldRegion[];
		following: readonly Peer[];
		/** The reader's own notes strangers answered, oldest first. */
		answers?: readonly Answered[];
		/** Somebody the sheet opens ready to ask about, where it was raised for
		 *  them rather than by the reader. */
		asking?: { identity: string; from?: string } | null;
		busy?: boolean;
		/** Why the last thing asked for did not happen. */
		says?: string | null;
		/** Given while one of the two lists above is still to be read, so the
		 *  reader can ask for it again. */
		onRetry?: () => void;
		/** Read this region on the canvas. */
		onEnter: (ref: HeldRegion['ref']) => void;
		onDrop: (ref: HeldRegion['ref']) => void;
		/** What somebody publishes, on the instance named or on this one. A page at
		 *  a time; `cursor` asks for the one after. The first argument is who was
		 *  asked after — an identifier, or the name they are known by there — and
		 *  `identity` on the answer is who that turned out to be. */
		onLook: (
			who: string,
			where: string | undefined,
			cursor?: string
		) => Promise<PublishedThere | null>;
		/** Take a copy of one of them; the publication names its own author. */
		onPull: (where: string | undefined, publication: OwnedRef) => void;
		/** Read a region already held afresh, without leaving this. */
		onRefresh: (region: HeldRegion) => void;
		/** The versions of a held region's publication, newest first. `null` where
		 *  its author's instance did not answer. */
		onChain: (region: HeldRegion) => Promise<readonly PublishedVersion[] | null>;
		/** What the writing did between the version held and a newer one. */
		onChanges: (
			region: HeldRegion,
			to: PublishedVersion,
			cursor?: string
		) => Promise<VersionComparison | null>;
		onFollow: (identity: string) => void;
		onUnfollow: (identity: string) => void;
		/** Read one of the reader's own notes, where the conversation on it is. */
		onOpenAnswer?: (note: OwnedRef) => void;
	} = $props();

	let identity = $state('');
	let where = $state('');
	/** Whose listing is on screen, and where it was read from. */
	let looking = $state<{ identity: string; where: string | undefined } | null>(null);
	let found = $state<PublishedThere | null>(null);
	let refused = $state<string | null>(null);
	/** The newest version of each held publication, once its author has answered. */
	let newest = $state<Record<OwnedRef, PublishedVersion>>({});
	/** The region whose difference is being read, and against which version. */
	let comparing = $state<{ region: OwnedRef; to: PublishedVersion } | null>(null);
	let compared = $state<VersionComparison | null>(null);
	let reading = $state(false);
	/** The newest ask, so an answer to a question left behind is dropped rather
	 *  than drawn under the heading of the one that replaced it. */
	let latest = 0;

	const heldPublications = $derived(new Set(regions.map((region) => region.publication)));
	const lookingAt = $derived(following.find((one) => one.identity === looking?.identity) ?? null);
	const heldNotebooks = $derived(
		byNotebook(
			regions,
			(region) => ({ whose: region.identity, graph: region.graph, notebook: region.notebook }),
			'A notebook they did not name'
		)
	);
	const answerNotebooks = $derived(
		byNotebook(
			answers,
			(answer) => ({ graph: answer.graph, notebook: answer.notebook }),
			'A notebook you did not name'
		)
	);

	/** What each held region is asked about once: a copy taken again is a new
	 *  question, and the chain behind it may have moved. A question that went
	 *  unanswered is let go of, so raising the sheet again asks it. */
	const chainAsked = new SvelteSet<string>();

	$effect(() => {
		if (!open) return;
		const holding = regions;
		untrack(() => {
			for (const region of holding) {
				const question = `${region.publication}\n${region.version.ref}`;
				if (chainAsked.has(question)) continue;
				chainAsked.add(question);
				void onChain(region).then((chain) => {
					if (!chain) {
						chainAsked.delete(question);
						return;
					}
					const top = chain[0];
					if (top) newest = { ...newest, [region.publication]: top };
				});
			}
		});
	});

	/** Whoever the sheet was last raised about, so raising it again for the same
	 *  person after the reader has typed does not overwrite what they typed. */
	let primed: string | null = null;

	$effect(() => {
		const ask = open ? asking : null;
		if (!ask) {
			if (!open) primed = null;
			return;
		}
		if (ask.identity === primed) return;
		primed = ask.identity;
		untrack(() => {
			where = ask.from ?? '';
			void look(ask.identity);
		});
	});

	// Nothing about one comparison belongs to the next thing this sheet is
	// opened for.
	$effect(() => {
		if (open) return;
		latest += 1;
		reading = false;
		comparing = null;
		compared = null;
	});

	/** Nothing typed is this instance, which is the whole of it for somebody
	 *  whose graph is kept here. */
	function instance(named: string): string | undefined | null {
		if (named.trim() === '') return undefined;
		return peerOrigin(named);
	}

	/** What somebody was handed, as the two lines this asks for: a name carries
	 *  the instance it is kept on, so one paste fills both. An identifier carries
	 *  no `@`. */
	function split(typed: string): { who: string; at?: string } {
		const trimmed = typed.trim();
		const cut = trimmed.lastIndexOf('@');
		if (cut <= 0) return { who: trimmed };
		return { who: trimmed.slice(0, cut), at: trimmed.slice(cut + 1) };
	}

	/** Somebody the reader already follows is asked at the instance known for
	 *  them rather than at whatever the box was last used for, and the box then
	 *  shows it so it can be changed. */
	async function lookAtFollowed(peer: Peer): Promise<void> {
		where = peer.from ?? '';
		await look(peer.identity);
	}

	async function look(typed: string): Promise<void> {
		const named = split(typed);
		if (named.at) where = named.at;
		const at = instance(named.at ?? where);
		if (at === null) {
			refused = 'That does not look like a web address. Theirs looks like https://sloppy.example';
			return;
		}
		refused = null;
		identity = named.who;
		found = null;
		looking = null;
		const page = await onLook(named.who, at);
		if (!page) return;
		looking = { identity: page.identity, where: at };
		found = page;
	}

	async function more(cursor: string): Promise<void> {
		if (!looking) return;
		const page = await onLook(looking.identity, looking.where, cursor);
		if (!page) return;
		found = {
			identity: found?.identity ?? page.identity,
			publications: [...(found?.publications ?? []), ...page.publications],
			...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor })
		};
	}

	/** What a held region is called where an act on it has to name one: the
	 *  address its author gave it, and whose branch it is where they gave none,
	 *  since one row of several has to be told from the rest. */
	function names(region: HeldRegion): string {
		return region.address ?? `${nameOr(region.person)}'s branch`;
	}

	/** The version a region's author serves now, where it is past the one held. */
	function published(region: HeldRegion): PublishedVersion | null {
		const top = newest[region.publication];
		return top && top.sequence > region.version.sequence ? top : null;
	}

	/** One page of one comparison, kept only while it is still the one being
	 *  read. */
	async function ask(
		region: HeldRegion,
		to: PublishedVersion,
		cursor: string | undefined,
		keep: (page: VersionComparison) => void
	): Promise<void> {
		const mine = ++latest;
		reading = true;
		try {
			const page = await onChanges(region, to, cursor);
			if (mine !== latest || !page) return;
			keep(page);
		} finally {
			if (mine === latest) reading = false;
		}
	}

	async function compare(region: HeldRegion, to: PublishedVersion): Promise<void> {
		if (comparing?.region === region.ref) {
			latest += 1;
			reading = false;
			comparing = null;
			compared = null;
			return;
		}
		comparing = { region: region.ref, to };
		compared = null;
		await ask(region, to, undefined, (page) => {
			compared = page;
		});
	}

	/** The next page of one comparison, with anything it repeats left out — a
	 *  note that moved, moved once. */
	async function moreChanges(cursor: string): Promise<void> {
		const reviewing = comparing;
		const region = regions.find((one) => one.ref === reviewing?.region);
		if (!reviewing || !region) return;
		await ask(region, reviewing.to, cursor, (page) => {
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
</script>

<ResponsiveModal
	bind:open
	title="Other people's graphs"
	description="A branch somebody publishes can be read here, with the addresses its author gave it."
>
	<div class="space-y-6 px-2 pt-4 pb-2">
		{#if regions.length > 0}
			<section class="space-y-2">
				<h3 class="text-sm font-medium">What you are holding</h3>
				{#each heldNotebooks as notebook (notebook.key)}
					<section class="space-y-1">
						{#if heldNotebooks.length > 1}
							<h4 class="px-1 pt-1 text-xs font-medium text-muted-foreground">{notebook.title}</h4>
						{/if}
						<ul class="space-y-1">
							{#each notebook.rows as region (region.ref)}
								{@const out = published(region)}
								<li class="space-y-1 py-1">
									<div class="flex items-center gap-3">
										<button
											type="button"
											class="flex min-w-0 flex-1 items-center gap-3 rounded-md py-2 text-left hover:bg-muted"
											onclick={() => {
												open = false;
												onEnter(region.ref);
											}}
										>
											<span class="min-w-6 shrink-0 address">{region.address ?? ''}</span>
											<span class="min-w-0 flex-1">
												<span class="block truncate text-sm">{nameOr(region.person)}</span>
												{#if !region.person}
													<span
														class="block truncate font-mono text-xs text-muted-foreground select-text"
														>{region.identity}</span
													>
												{/if}
											</span>
										</button>
										<Button
											variant="ghost"
											size="icon"
											class="size-9 shrink-0 rounded-full"
											aria-label={`Read ${names(region)} again`}
											disabled={busy}
											onclick={() => onRefresh(region)}
										>
											<RefreshCw class="size-4" />
										</Button>
										<Button
											variant="ghost"
											size="icon"
											class="size-9 shrink-0 rounded-full"
											aria-label={`Stop holding ${names(region)}`}
											disabled={busy}
											onclick={() => onDrop(region.ref)}
										>
											<Trash2 class="size-4" />
										</Button>
									</div>

									<p class="px-1 text-xs text-muted-foreground">
										Version {region.version.sequence}, read {when(region.readAt)}.
										{#if out}
											Version {out.sequence} is out.
										{/if}
									</p>

									{#if out}
										<Button
											variant="ghost"
											class="h-9 rounded-full px-2 text-xs"
											disabled={busy}
											onclick={() => compare(region, out)}
										>
											{comparing?.region === region.ref ? 'Never mind' : 'What changed'}
										</Button>
									{/if}

									{#if comparing?.region === region.ref}
										{#if reading && !compared}
											<Skeleton class="h-24 w-full" />
										{:else if compared}
											<div class="pt-1 pl-1">
												<VersionChanges
													changes={compared.changes}
													nextCursor={compared.nextCursor}
													busy={reading}
													onmore={moreChanges}
												/>
											</div>
										{/if}
									{/if}
								</li>
							{/each}
						</ul>
					</section>
				{/each}
			</section>
		{/if}

		{#if answers.length > 0}
			<section class="space-y-2">
				<h3 class="text-sm font-medium">Answers on your notes</h3>
				<p class="text-xs text-muted-foreground">
					From people you do not follow. What somebody you follow said is on the note itself.
				</p>
				{#each answerNotebooks as notebook (notebook.key)}
					<section class="space-y-1">
						{#if answerNotebooks.length > 1}
							<h4 class="px-1 pt-1 text-xs font-medium text-muted-foreground">{notebook.title}</h4>
						{/if}
						<ul class="space-y-1">
							{#each notebook.rows as answer (answer.note)}
								<li>
									<button
										type="button"
										class="flex w-full min-w-0 items-center gap-3 rounded-md py-2 text-left hover:bg-muted"
										onclick={() => {
											open = false;
											onOpenAnswer?.(answer.note);
										}}
									>
										{#if answer.address !== undefined}
											<span class="shrink-0 address">{answer.address}</span>
										{/if}
										<span class="min-w-0 flex-1">
											<span class="block truncate text-sm">{answer.title || 'Untitled'}</span>
											<span class="block truncate text-xs text-muted-foreground"
												>{#each answer.voices as voice, index (voice.identity)}{index > 0
														? ', '
														: ''}<span class={voice.person ? undefined : 'font-mono select-text'}
														>{voice.person ? nameOf(voice.person) : voice.identity}</span
													>{/each}</span
											>
										</span>
									</button>
								</li>
							{/each}
						</ul>
					</section>
				{/each}
			</section>
		{/if}

		{#if following.length > 0}
			<section class="space-y-2">
				<h3 class="text-sm font-medium">Who you follow</h3>
				<ul class="space-y-1">
					{#each following as one (one.identity)}
						<li class="flex items-center gap-3">
							<PeerName peer={one} class="min-w-0 flex-1" />
							<Button
								variant="ghost"
								class="h-9 shrink-0 rounded-full"
								disabled={busy}
								onclick={() => lookAtFollowed(one)}
							>
								What they publish
							</Button>
							<Button
								variant="ghost"
								size="icon"
								class="size-9 shrink-0 rounded-full"
								aria-label={`Stop following ${nameOr(one.person)}`}
								disabled={busy}
								onclick={() => onUnfollow(one.identity)}
							>
								<UserMinus class="size-4" />
							</Button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<section class="space-y-2">
			<h3 class="text-sm font-medium">Find somebody</h3>
			<Input
				bind:value={identity}
				class="h-11"
				autocomplete="off"
				spellcheck="false"
				placeholder="alice@sloppy.example"
				aria-label="Who to read"
			/>
			<Input
				bind:value={where}
				class="h-11"
				autocomplete="off"
				spellcheck="false"
				inputmode="url"
				placeholder="https://sloppy.example"
				aria-label="Where their graph is"
			/>
			<p class="text-xs text-muted-foreground">
				Paste what they gave you — the name they go by, or their identifier. Leave the second line
				empty if their graph is kept here.
			</p>
			<Button
				variant="outline"
				class="h-11 w-full"
				disabled={busy || identity.trim() === ''}
				onclick={() => look(identity)}
			>
				<Search class="size-4" />
				See what they publish
			</Button>
		</section>

		{#if refused}
			<p class="text-sm text-destructive" role="alert">{refused}</p>
		{/if}
		{#if says}
			<p class="text-sm text-destructive" role="alert">{says}</p>
		{/if}
		{#if onRetry && !busy}
			<Button variant="outline" class="h-11 w-full" onclick={onRetry}>Try again</Button>
		{/if}

		{#if looking}
			{@const at = looking}
			<section class="space-y-2 border-t pt-4">
				<div class="flex items-center gap-3">
					{#if lookingAt}
						<PeerName peer={lookingAt} class="min-w-0 flex-1" />
					{:else}
						<span class="min-w-0 flex-1 truncate font-mono text-xs select-text">{at.identity}</span>
					{/if}
					{#if lookingAt === null}
						<Button
							variant="ghost"
							class="h-9 shrink-0 rounded-full"
							disabled={busy}
							onclick={() => onFollow(at.identity)}
						>
							<UserPlus class="size-4" />
							Follow
						</Button>
					{/if}
				</div>
				{#if found}
					<PublishedRoots
						publications={found.publications}
						nextCursor={found.nextCursor}
						{busy}
						held={heldPublications}
						onpull={(publication) => onPull(at.where, publication)}
						onmore={more}
					/>
				{/if}
			</section>
		{/if}
	</div>
</ResponsiveModal>
