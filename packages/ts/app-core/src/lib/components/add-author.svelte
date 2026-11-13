<script lang="ts">
	// Naming somebody whose writing a note carries that reached it some other
	// way — DESIGN.md § "Whose writing".
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import { asPrincipal, type Principal } from '@sloppy/types';
	import { ResponsiveModal } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';
	import { Label } from '@sloppy/ui/label';

	let {
		authors,
		busy = false,
		refused = null,
		onadd
	}: {
		authors: readonly Principal[];
		busy?: boolean;
		refused?: string | null;
		/** Resolves `true` once the note carries them. */
		onadd: (author: Principal) => Promise<boolean>;
	} = $props();

	let open = $state(false);
	let typed = $state('');
	let problem = $state<string | null>(null);

	async function add(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const author = asPrincipal(typed);
		if (!author) {
			problem =
				'Type who they are as did:syr:…, as mailto: and their email address, or as @ and their W3ID.';
			return;
		}
		if (authors.includes(author)) {
			problem = 'They already wrote this note.';
			return;
		}
		problem = null;
		if (await onadd(author)) {
			typed = '';
			open = false;
		}
	}
</script>

<button
	type="button"
	onclick={() => {
		problem = null;
		open = true;
	}}
	class="inline-flex min-h-9 items-center gap-1.5 rounded-md px-1.5 text-sm text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
>
	<UserPlus class="size-3.5 shrink-0" />
	Add an author
</button>

<ResponsiveModal
	bind:open
	title="Add an author"
	description="Somebody whose writing this note carries. Once added, an author stays on the note."
>
	<form class="space-y-3 px-2 pt-4 pb-2" onsubmit={add}>
		<Label for="add-author" class="sr-only">Who they are</Label>
		<Input
			id="add-author"
			bind:value={typed}
			class="h-control"
			placeholder="@0f6b… or did:syr:… or mailto:…"
			autocapitalize="none"
			autocomplete="off"
			spellcheck={false}
		/>
		{#if problem ?? refused}
			<p class="text-sm text-destructive" role="alert">{problem ?? refused}</p>
		{/if}
		<Button type="submit" class="h-control w-full" disabled={busy || typed.trim() === ''}>
			Add
		</Button>
	</form>
</ResponsiveModal>
