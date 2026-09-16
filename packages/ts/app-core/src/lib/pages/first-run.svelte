<script lang="ts">
	import type { IdentityHere } from '@sloppy/local';
	import { Button } from '@sloppy/ui/button';
	import IdentitySettings from '../components/identity-settings.svelte';
	import { runtime } from '../runtime.js';
	import { session } from '../stores/session.svelte.js';

	let {
		onopened,
		/** Somebody whose folder is no longer where they put it, rather than
		 *  somebody who has never had one. */
		missing = false
	}: { onopened: (folder: string) => void; missing?: boolean } = $props();

	const vault = runtime.vault();
	const identities = runtime.identities();

	let opening = $state(false);
	let problem = $state<string | null>(null);
	let held = $state<IdentityHere[]>([]);
	/** Which ask the list on screen came from, so a slower one that started
	 *  first cannot write over a later answer. */
	let asked = 0;

	const writing = $derived(held.find((one) => one.writing));

	$effect(() => {
		// Reading who is signed in is what makes this re-read when a sign-in lands
		// after the surface mounted, which is the ordinary case on a first run.
		void session.viewer;
		void refresh();
	});

	/** Null is a device that would not say what it holds, which is never read as
	 *  holding none — minting a second identity over one already here would
	 *  orphan every graph written under it. */
	async function refresh(): Promise<IdentityHere[] | null> {
		if (!identities) return [];
		const mine = ++asked;
		try {
			const listed = await identities.list();
			if (mine === asked) {
				held = listed;
				problem = null;
			}
			return listed;
		} catch (error) {
			if (mine === asked) problem = said(error);
			return null;
		}
	}

	/** The shell says what went wrong in words fit to show; anything else that
	 *  went wrong is not in any. */
	function shellSaid(error: unknown): string | null {
		return typeof error === 'string' && error.trim() ? error : null;
	}

	/** What to show for something that went wrong holding an identity, which
	 *  says what a person can do about it where it says anything at all. */
	function said(error: unknown): string {
		const words = shellSaid(error) ?? (error instanceof Error ? error.message : null);
		return words?.trim()
			? words
			: 'Sloppy could not read the identities on this device. Try again.';
	}

	async function begin() {
		if (!vault) return;
		opening = true;
		problem = null;
		try {
			const listed = await refresh();
			if (listed === null) return;
			if (identities && listed.length === 0) {
				await identities.makeOne();
				await refresh();
			}
			const folder = await vault.open();
			if (!folder) return;
			await session.carryProfile();
			onopened(folder);
		} catch (error) {
			problem =
				shellSaid(error) ??
				(vault.asks
					? 'Sloppy could not write in that folder. Try another one.'
					: 'Sloppy could not make a place for your notes on this device.');
		} finally {
			opening = false;
		}
	}
</script>

<svelte:head><title>Sloppy</title></svelte:head>

<div
	class="pad-bottom-safe min-h-dvh px-5 pt-[max(4rem,calc(env(safe-area-inset-top)+3rem))] sm:px-8"
>
	<div class="mx-auto w-full max-w-md space-y-10 pb-24">
		<div class="space-y-3">
			<h1 class="text-3xl font-semibold tracking-tight">Sloppy</h1>
			<p class="text-muted-foreground">One thought, then the one it leads to.</p>
		</div>

		<div class="space-y-4">
			<p class="text-balance">
				{#if missing}
					The folder your notes are in is not where it was. Open it again, or choose another one.
				{:else if vault?.asks}
					Your notes are files in a folder you choose. Pick an empty one, or make a new one along
					the way.
				{:else}
					Your notes are kept on this device.
				{/if}
			</p>
			<p class="text-sm text-muted-foreground">
				What you write stays on this device.
				{#if vault?.asks}
					The folder is yours — move it or back it up like any other.
				{/if}
			</p>

			{#if problem}
				<p class="text-sm text-destructive" role="alert">{problem}</p>
			{/if}

			<Button
				type="button"
				disabled={opening}
				aria-busy={opening}
				class="h-11 w-full"
				onclick={() => void begin()}
			>
				{#if opening}
					One moment…
				{:else if vault?.asks}
					Choose a folder
				{:else}
					Start writing
				{/if}
			</Button>
		</div>

		{#if identities}
			<div class="space-y-4 border-t border-border pt-8">
				{#if writing}
					<p class="text-sm text-muted-foreground">
						{#if writing.name}
							You'll be writing as {writing.name}.
						{:else}
							You'll be writing as the identity on this device.
						{/if}
					</p>
				{:else}
					<p class="text-sm text-muted-foreground">
						Starting here gives you an identity of your own, with nothing asked. Or use one you
						already keep somewhere.
					</p>
				{/if}
				<IdentitySettings mints={false} />
			</div>
		{/if}
	</div>
</div>
