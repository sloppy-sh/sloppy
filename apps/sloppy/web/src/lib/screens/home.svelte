<script lang="ts">
	import { resolve } from '$app/paths';
	import { session } from '$lib/session.svelte';

	const viewer = $derived(session.viewer);
	let leaving = $state(false);

	async function signOut() {
		leaving = true;
		await session.signOut();
	}
</script>

{#if viewer}
	<div class="space-y-10">
		<h1 class="text-3xl font-semibold tracking-tight">Sloppy</h1>

		<p class="leading-relaxed text-muted-foreground">
			Signed in as <span class="break-all text-foreground select-text">{viewer.did}</span>, at
			{new URL(viewer.syr_instance_url).host}.
		</p>

		<div class="flex flex-wrap items-center gap-3">
			<a
				href={resolve('/settings')}
				class="inline-flex h-11 items-center justify-center
					rounded-md border border-border bg-card px-4 text-sm
					font-medium transition-colors duration-150 ease-out hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
					focus-visible:ring-offset-background focus-visible:outline-none"
			>
				Settings
			</a>
			<button
				type="button"
				onclick={signOut}
				disabled={leaving}
				class="inline-flex h-11 items-center
					justify-center rounded-md px-4 text-sm font-medium text-muted-foreground
					transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
					focus-visible:ring-offset-background focus-visible:outline-none disabled:opacity-60"
			>
				Sign out
			</button>
		</div>
	</div>
{/if}
