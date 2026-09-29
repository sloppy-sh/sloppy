<script lang="ts">
	// The changes offered on a note, as whoever writes it reads them: one at a
	// time, against what the note says now — DESIGN.md § "Whose writing".
	import type { AmendmentView, BlockView, NodeView } from '@sloppy/types';
	import { ChangedNotes, nameOr, PersonChip, ResponsiveModal, unnamedPerson } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { people } from '../stores/people.svelte.js';
	import CompassDifference from './compass-difference.svelte';
	import LineDifference from './line-difference.svelte';
	import {
		compassApart,
		looksApart,
		offerDifference,
		saysAnything,
		saysNothing,
		tagsApart,
		type WritingSide
	} from './offer-difference.js';

	let {
		open = $bindable(false),
		note,
		sections,
		offers,
		busy = false,
		says = null,
		onApprove,
		onDecline
	}: {
		open?: boolean;
		note: NodeView;
		/** The note as it stands, which is what an offer is read against. */
		sections: readonly BlockView[];
		/** Oldest first. */
		offers: readonly AmendmentView[];
		busy?: boolean;
		says?: string | null;
		onApprove: (offer: AmendmentView) => Promise<void>;
		onDecline: (offer: AmendmentView) => Promise<void>;
	} = $props();

	let reading = $state<string | null>(null);

	const shown = $derived(offers.find((one) => one.ref === reading) ?? null);

	const now = $derived<WritingSide>({
		title: note.title,
		tags: note.tags,
		...(note.edges === undefined ? {} : { edges: note.edges }),
		sections: sections.map((one) => ({ ref: one.ref, content: one.content }))
	});
	const offered = $derived<WritingSide | null>(
		shown
			? {
					title: shown.title,
					tags: shown.tags,
					...(shown.edges === undefined ? {} : { edges: shown.edges }),
					sections: shown.blocks
				}
			: null
	);
	const apart = $derived(
		offered
			? offerDifference(
					{ ref: note.ref, ...(note.address ? { address: note.address } : {}) },
					now,
					offered
				)
			: null
	);
	const tags = $derived(offered ? tagsApart(now, offered) : null);
	const compass = $derived(compassApart(now, offered ?? now));
	const lines = $derived(offered ? looksApart(now, offered) : []);

	$effect(() => {
		for (const one of offers) people.resolve(one.by);
	});

	// A note whose last offer was settled has nothing left to read here.
	$effect(() => {
		if (reading !== null && !offers.some((one) => one.ref === reading)) reading = null;
	});

	function who(did: string): string {
		return nameOr(people.of(did));
	}

	function when(at: string): string {
		const day = new Date(at);
		return Number.isNaN(day.getTime())
			? ''
			: day.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
	}

	async function settle(act: (offer: AmendmentView) => Promise<void>): Promise<void> {
		const one = shown;
		if (!one) return;
		await act(one);
	}
</script>

<ResponsiveModal
	bind:open
	title={shown ? `${who(shown.by)}’s change` : 'Offered changes'}
	description={shown
		? 'What this note would say. Take it in whole, or turn it down.'
		: 'Changes people have offered on this note.'}
>
	<div class="space-y-4 px-2 pt-4 pb-2">
		{#if !shown}
			{#if offers.length === 0}
				<p class="px-1 py-2 text-sm text-muted-foreground">Nothing is offered on this note.</p>
			{:else}
				<ul class="space-y-1">
					{#each offers as one (one.ref)}
						{@const person = people.of(one.by) ?? unnamedPerson(one.by)}
						<li>
							<button
								type="button"
								class="flex min-h-control w-full flex-col items-start gap-1 rounded-md px-2 py-2 text-left transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
								onclick={() => (reading = one.ref)}
							>
								<span class="flex w-full min-w-0 items-center gap-2">
									<PersonChip {person} size={24} handle={false} class="min-w-0 gap-2 text-sm" />
									<span class="ml-auto shrink-0 text-xs text-muted-foreground">{when(one.at)}</span>
								</span>
								{#if one.message}
									<span class="text-sm break-words text-muted-foreground">{one.message}</span>
								{/if}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		{:else}
			{#if shown.message}
				<p class="px-1 text-sm break-words">{shown.message}</p>
			{/if}

			{#if apart && saysAnything(apart)}
				<ChangedNotes notes={[apart]} />
			{:else if apart && tags && saysNothing(apart, compass, tags, lines)}
				<p class="px-1 py-2 text-sm text-muted-foreground">This offer says the same as the note.</p>
			{/if}

			<CompassDifference apart={compass} />

			<LineDifference apart={lines} />

			{#if tags && (tags.added.length > 0 || tags.removed.length > 0)}
				<p class="px-1 text-xs text-muted-foreground">
					{#if tags.added.length > 0}Adds {tags.added.join(', ')}{/if}
					{#if tags.added.length > 0 && tags.removed.length > 0}&nbsp;·&nbsp;{/if}
					{#if tags.removed.length > 0}Takes off {tags.removed.join(', ')}{/if}
				</p>
			{/if}

			<div class="space-y-2">
				<Button class="h-control w-full" disabled={busy} onclick={() => void settle(onApprove)}>
					Take it in
				</Button>
				<Button
					variant="outline"
					class="h-control w-full"
					disabled={busy}
					onclick={() => void settle(onDecline)}
				>
					Turn it down
				</Button>
				{#if offers.length > 1}
					<Button variant="ghost" class="h-control w-full" onclick={() => (reading = null)}>
						The other offers
					</Button>
				{/if}
			</div>
		{/if}

		{#if says}
			<p class="text-sm text-destructive" role="alert">{says}</p>
		{/if}
	</div>
</ResponsiveModal>
