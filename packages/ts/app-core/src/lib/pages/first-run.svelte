<script lang="ts">
	import { Button } from '@sloppy/ui/button';
	import { runtime } from '../runtime.js';

	let {
		onopened,
		/** Somebody whose folder is no longer where they put it, rather than
		 *  somebody who has never had one. */
		missing = false
	}: { onopened: (folder: string) => void; missing?: boolean } = $props();

	const vault = runtime.vault();

	let opening = $state(false);
	let problem = $state<string | null>(null);

	/** The shell says what went wrong in words fit to show; anything else that
	 *  went wrong is not in any. */
	function shellSaid(error: unknown): string | null {
		return typeof error === 'string' && error.trim() ? error : null;
	}

	async function begin() {
		if (!vault) return;
		opening = true;
		problem = null;
		try {
			const folder = await vault.open();
			if (folder) onopened(folder);
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
				Nothing here leaves the device, and there is nobody to sign in to.
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
	</div>
</div>
