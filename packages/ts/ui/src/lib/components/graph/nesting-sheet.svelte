<script lang="ts" module>
	/** What a number somebody wrote says about where their note sits, and what
	 *  they can do about it. `here` is how the note it springs from reads today,
	 *  absent where it springs from nothing. */
	export type NestingAsk = { address: string; here?: string } & (
		| {
				kind: 'carry';
				/** How the note the number springs from reads today. */
				under: string;
				/** The number that leads to that note, where it is no longer at it. */
				wasAt?: string;
				/** The number it takes there, absent where the run decides it. */
				takes?: string;
		  }
		| { kind: 'branch' }
		| {
				kind: 'nowhere';
				parent: string;
				/** How much of what this person keeps has been read: only `whole`
				 *  may say there is no such note. */
				looking: 'whole' | 'reading' | 'short';
		  }
	);
</script>

<script lang="ts">
	// A number that says the note springs from somewhere it does not, and the
	// choice between carrying the note there and keeping it where it is with that
	// number. AI.md § "The Genealogy Is the Protocol".
	import { Button } from '$lib/components/ui/button/index.js';
	import ResponsiveModal from '../responsive-modal.svelte';

	let {
		open = $bindable(false),
		onOpenChange,
		ask,
		refused = null,
		busy = false,
		oncarry,
		onkeep,
		onelse,
		onlookagain
	}: {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		ask: NestingAsk;
		/** Why it did not land, in words to show. */
		refused?: string | null;
		/** The act is with the server, so the choices stop taking taps. */
		busy?: boolean;
		/** Carry the note to where the number says it springs from. */
		oncarry: () => void;
		/** Keep it where it is, and let it carry that number. */
		onkeep: () => void;
		/** Back to the field to write another number. */
		onelse: () => void;
		/** Read the graphs that would not open, so the answer can settle. */
		onlookagain?: () => void;
	} = $props();

	const title = $derived.by(() => {
		if (ask.kind !== 'nowhere') return 'Where should this note sit?';
		if (ask.looking === 'reading') return `Still looking for a note at ${ask.parent}`;
		return ask.looking === 'short'
			? `Sloppy could not find a note at ${ask.parent}`
			: `There is no note at ${ask.parent} yet`;
	});

	const description = $derived.by(() => {
		const springs =
			ask.kind === 'carry'
				? ask.wasAt
					? `${ask.address} springs from ${ask.wasAt}, which now leads to ${ask.under}.`
					: `${ask.address} springs from ${ask.under}.`
				: ask.kind === 'branch'
					? `${ask.address} is a branch's own number.`
					: ask.looking === 'whole'
						? `${ask.address} springs from ${ask.parent}, and nothing here carries that number.`
						: `${ask.address} springs from ${ask.parent}.`;
		return `${springs} ${ask.here ? `This note springs from ${ask.here}.` : 'This note springs from nothing.'}`;
	});

	const keeping = $derived(
		ask.here ? `Keep it under ${ask.here} as ${ask.address}` : `Keep it as ${ask.address}`
	);
</script>

<ResponsiveModal bind:open {onOpenChange} {title} {description}>
	<div class="space-y-3 px-2 pt-4 pb-2">
		{#if ask.kind === 'nowhere' && ask.looking === 'short'}
			<p class="px-2 text-sm text-muted-foreground">
				Sloppy could not open all of your graphs, so a note at {ask.parent} may be missing here.
			</p>
			{#if onlookagain}
				<Button variant="outline" class="h-11 w-full" disabled={busy} onclick={onlookagain}>
					Look again
				</Button>
			{/if}
		{/if}

		{#if ask.kind !== 'nowhere'}
			<Button
				variant="outline"
				class="h-auto min-h-11 w-full flex-col items-start gap-0.5 py-2 text-left whitespace-normal"
				disabled={busy}
				onclick={oncarry}
			>
				<span class="text-sm">
					{ask.kind === 'branch'
						? 'Make it a branch of its own'
						: ask.wasAt
							? `Move it under ${ask.wasAt}, now ${ask.under}`
							: `Move it under ${ask.under}`}
				</span>
				<span class="text-xs font-normal text-muted-foreground">
					{ask.kind === 'branch'
						? `It becomes ${ask.address}, and everything under it comes along.`
						: ask.takes
							? `It becomes ${ask.takes}, and everything under it comes along.`
							: `It takes the next number under ${ask.under}, and everything under it comes along.`}
				</span>
			</Button>
		{/if}

		<Button
			variant="outline"
			class="h-auto min-h-11 w-full flex-col items-start gap-0.5 py-2 text-left whitespace-normal"
			disabled={busy}
			onclick={onkeep}
		>
			<span class="text-sm">{keeping}</span>
			<span class="text-xs font-normal text-muted-foreground">
				Only the number changes; nothing moves.
			</span>
		</Button>

		{#if refused}
			<p class="px-2 text-sm text-destructive" role="alert">{refused}</p>
		{/if}

		<Button variant="ghost" class="h-11 w-full" disabled={busy} onclick={onelse}>
			{ask.kind === 'nowhere' ? 'Pick another number' : 'Cancel'}
		</Button>
	</div>
</ResponsiveModal>
