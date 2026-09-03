<script lang="ts" module>
	import type { Address, CommentAccess, PublishedVersion } from '@sloppy/types';

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
	}
</script>

<script lang="ts">
	// Publishing a branch, and everything a person does to one afterwards. What
	// publishing exposes is said here, at the decision, and nowhere else —
	// DESIGN.md § Forms.
	import Check from '@lucide/svelte/icons/check';
	import { Button } from '$lib/components/ui/button/index.js';
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
		onunpublish
	}: PublishModalProps = $props();

	const newest = $derived(published?.versions[0] ?? null);

	let working = $state(false);
	let takingDown = $state(false);
	/** True once the take-down itself has been refused, so the sheet's refusal
	 *  for some other act is not re-shown over a question about this one. */
	let downRefused = $state(false);

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
						<li class="flex min-h-9 items-center gap-3 px-2">
							<span class="shrink-0 address text-sm">Version {version.sequence}</span>
							<span class="min-w-0 flex-1 truncate text-sm text-muted-foreground">
								{when(version.published_at)}
							</span>
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
					downRefused = false;
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
					Anyone who can find your profile can read it. There is no link to keep back and nobody to
					let in.
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
	refused={downRefused ? refused : null}
	onconfirm={takeDown}
/>
