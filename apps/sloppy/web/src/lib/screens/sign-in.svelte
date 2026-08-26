<script lang="ts">
	import { resolve } from '$app/paths';
	import { api, runtime } from '@sloppy/app-core';
	import { reason } from '$lib/errors';
	import { session } from '$lib/session.svelte';

	let instance = $state('');
	let leaving = $state(false);
	let problem = $state<string | null>(null);

	async function begin(event: SubmitEvent) {
		event.preventDefault();
		leaving = true;
		problem = null;
		try {
			const { consent_url } = await api.startLogin({
				instance_url: instance.trim(),
				redirect: `${location.origin}/`
			});
			const open = runtime.openExternal();
			if (open) await open(consent_url);
			else location.assign(consent_url);
		} catch (error) {
			problem = reason(error, 'Sloppy could not reach that address. Check it and try again.');
			leaving = false;
		}
	}
</script>

<svelte:head><title>Sign in · Sloppy</title></svelte:head>

<div class="space-y-10">
	<h1 class="text-3xl font-semibold tracking-tight">Sloppy</h1>

	<form class="space-y-4" onsubmit={begin}>
		<div class="space-y-2">
			<label class="block text-sm font-medium" for="instance">Where your identity lives</label>
			<input
				id="instance"
				name="instance"
				type="url"
				inputmode="url"
				autocomplete="url"
				required
				placeholder="https://syr.example"
				bind:value={instance}
				class="h-11 w-full rounded-md border
					border-input bg-card px-3 text-base placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring
					focus-visible:outline-none"
			/>
		</div>

		{#if problem ?? session.unreachable}
			<p class="text-sm text-destructive" role="alert">{problem ?? session.unreachable}</p>
		{/if}

		<button
			type="submit"
			disabled={leaving}
			class="inline-flex h-11 w-full
				items-center justify-center rounded-md bg-primary px-4 text-sm
				font-medium text-primary-foreground transition-opacity duration-150 ease-out hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring
				focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none
				disabled:opacity-60"
		>
			Continue
		</button>
	</form>

	<a
		href={resolve('/settings')}
		class="inline-block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
	>
		Settings
	</a>
</div>
