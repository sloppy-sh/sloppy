<script lang="ts">
	// Who gates a note's writing, and the choice the people entitled to make it
	// are offered — DESIGN.md § "Whose writing".
	import type { DidSyr, Principal } from '@sloppy/types';
	import { isNamed, nameOf, ResponsiveModal } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { people } from '../stores/people.svelte.js';

	let {
		open = $bindable(false),
		owner,
		me,
		busy = false,
		refused = null,
		onchange
	}: {
		open?: boolean;
		/** Absent is a note anybody writing in this graph writes straight into. */
		owner?: Principal;
		me: DidSyr;
		busy?: boolean;
		refused?: string | null;
		/** `null` leaves the note open to anybody writing in this graph. */
		onchange: (owner: DidSyr | null) => Promise<void>;
	} = $props();

	const mine = $derived(owner === me);
	const theirs = $derived(owner !== undefined && !mine);

	const them = $derived.by(() => {
		if (!theirs || owner === undefined) return 'somebody else';
		const person = people.of(owner);
		return person && isNamed(person) ? nameOf(person) : 'somebody else';
	});

	$effect(() => {
		if (theirs && owner !== undefined) people.resolve(owner);
	});
</script>

<ResponsiveModal
	bind:open
	title="Who writes this note"
	description="A change anybody else makes is offered, and shows once whoever writes it takes it in."
>
	<div class="space-y-2 px-2 pt-4 pb-2">
		<Button
			variant={owner === undefined ? 'secondary' : 'outline'}
			class="h-11 w-full justify-start"
			aria-pressed={owner === undefined}
			disabled={busy}
			onclick={() => void onchange(null)}
		>
			Anyone writing in this graph
		</Button>
		<Button
			variant={mine ? 'secondary' : 'outline'}
			class="h-11 w-full justify-start"
			aria-pressed={mine}
			disabled={busy}
			onclick={() => void onchange(me)}
		>
			Only you
		</Button>
		{#if theirs}
			<p class="px-1 text-sm text-muted-foreground">Only {them} writes it now.</p>
		{/if}

		{#if refused}
			<p class="text-sm text-destructive" role="alert">{refused}</p>
		{/if}
	</div>
</ResponsiveModal>
