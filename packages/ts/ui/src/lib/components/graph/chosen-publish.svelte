<script lang="ts">
	// Publishing every note somebody chose, asked once for the whole set. What a
	// publish exposes is `terms.ts`, which the single-note sheet reads too.
	import type { Address } from '@sloppy/types';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		alreadyCarried,
		KEEPS_TERMS,
		narrowerSays,
		publishingAgain,
		publishingSays
	} from '../publish/terms.js';
	import ResponsiveModal from '../responsive-modal.svelte';

	let {
		open = $bindable(false),
		count,
		alreadyOut = 0,
		keepsTerms = false,
		carriedBy = [],
		narrower = [],
		answersReach = true,
		refused = null,
		onpublish
	}: {
		open?: boolean;
		count: number;
		/** How many of them already root a publication, which go out again as
		 *  another version of it. */
		alreadyOut?: number;
		/** True where one of those was published inviting fewer people to answer,
		 *  which publishing again leaves as it is. */
		keepsTerms?: boolean;
		/** Branches rooted above the chosen notes that already carry them, each with
		 *  how many of those notes it carries. */
		carriedBy?: readonly { address: Address; notes: number }[];
		/** Branches under the chosen notes published inviting fewer people. */
		narrower?: readonly Address[];
		/** False where answers people write will never reach this person, so the
		 *  sheet promises none. */
		answersReach?: boolean;
		/** Why the last attempt did not land, in the caller's words. */
		refused?: string | null;
		onpublish: () => void | Promise<void>;
	} = $props();

	let working = $state(false);

	async function publish(): Promise<void> {
		working = true;
		try {
			await onpublish();
			open = false;
		} catch {
			// Left open, so the same button tries again; `refused` is what to say.
		} finally {
			working = false;
		}
	}
</script>

<ResponsiveModal
	bind:open
	title={count === 1 ? 'Publish this note?' : `Publish these ${count.toLocaleString()} notes?`}
>
	<div class="space-y-5 px-2 pt-4">
		<div class="space-y-3 text-sm text-muted-foreground">
			{#each publishingSays({ notes: count }, answersReach) as line (line)}
				<p>{line}</p>
			{/each}
			{#if alreadyOut > 0}
				<p>{publishingAgain({ notes: alreadyOut })}</p>
				{#if keepsTerms}
					<p>{KEEPS_TERMS}</p>
				{/if}
			{/if}
			{#each carriedBy as by (by.address)}
				<p>{alreadyCarried({ notes: by.notes }, by.address)}</p>
			{/each}
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
			<Button class="h-11 sm:h-9" disabled={working} onclick={() => void publish()}>
				{count === 1 ? 'Publish it' : `Publish ${count.toLocaleString()} notes`}
			</Button>
		</div>
	</div>
</ResponsiveModal>
