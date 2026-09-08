<script lang="ts" module>
	/** What a number somebody wrote says about where their note sits, and what
	 *  they can do about it. `here` is how the note it springs from reads today,
	 *  absent where it springs from nothing. */
	export type NestingAsk = { address: string; here?: string } & (
		| {
				kind: 'carry';
				/** How the note the number springs from reads. */
				under: string;
				/** The number it takes there, absent where the run decides it. */
				takes?: string;
		  }
		| { kind: 'branch' }
		| { kind: 'nowhere'; parent: string }
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
		onelse
	}: {
		open?: boolean;
		/** For the unbound `open={expr}` pattern; a bound `open` needs nothing. */
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
	} = $props();

	const title = $derived(
		ask.kind === 'nowhere' ? `There is no note at ${ask.parent} yet` : 'Where should this note sit?'
	);

	const description = $derived.by(() => {
		const springs =
			ask.kind === 'carry'
				? `${ask.address} springs from ${ask.under}.`
				: ask.kind === 'branch'
					? `${ask.address} is a branch's own number.`
					: `${ask.address} springs from ${ask.parent}, and nothing here carries that number.`;
		return `${springs} ${ask.here ? `This note springs from ${ask.here}.` : 'This note springs from nothing.'}`;
	});

	const keeping = $derived(
		ask.here ? `Keep it under ${ask.here} as ${ask.address}` : `Keep it as ${ask.address}`
	);
</script>

<ResponsiveModal bind:open {onOpenChange} {title} {description}>
	<div class="space-y-3 px-2 pt-4 pb-2">
		{#if ask.kind !== 'nowhere'}
			<Button
				variant="outline"
				class="h-auto min-h-11 w-full flex-col items-start gap-0.5 py-2 text-left whitespace-normal"
				disabled={busy}
				onclick={oncarry}
			>
				<span class="text-sm">
					{ask.kind === 'carry' ? `Move it under ${ask.under}` : 'Make it a branch of its own'}
				</span>
				<span class="text-xs font-normal text-muted-foreground">
					{ask.kind === 'branch'
						? `It becomes ${ask.address}, and everything under it comes along.`
						: ask.takes
							? `It becomes ${ask.takes}, and everything under it comes along.`
							: 'Everything under it comes along.'}
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
