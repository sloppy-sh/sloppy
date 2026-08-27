<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- the route tree belongs
	   to the shells, so this package has no manifest for `resolve()` to check
	   against. */

	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';
	import { Label } from '@sloppy/ui/label';
	import { page } from '$app/state';
	import { api } from '../api.js';
	import { runtime } from '../runtime.js';
	import { serverMessage } from '../stores/errors.js';

	let instance = $state('');
	let leaving = $state(false);
	let problem = $state<string | null>(null);

	const refused = $derived(page.url.searchParams.get('sloppy_error'));

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
			problem =
				serverMessage(error) ?? 'Sloppy could not reach that address. Check it and try again.';
			leaving = false;
		}
	}
</script>

<svelte:head><title>Sign in · Sloppy</title></svelte:head>

<div
	class="pad-bottom-safe min-h-dvh px-5 pt-[max(4rem,calc(env(safe-area-inset-top)+3rem))] sm:px-8"
>
	<div class="mx-auto w-full max-w-md space-y-10 pb-24">
		<div class="space-y-3">
			<h1 class="text-3xl font-semibold tracking-tight">Sloppy</h1>
			<p class="text-muted-foreground">
				One thought, then the one it leads to. Sign in with the account you already have.
			</p>
		</div>

		<form class="space-y-4" onsubmit={begin}>
			<div class="space-y-2">
				<Label for="instance">Where your identity lives</Label>
				<Input
					id="instance"
					name="instance"
					type="url"
					inputmode="url"
					autocomplete="url"
					required
					placeholder="https://syr.example"
					bind:value={instance}
				/>
			</div>

			{#if problem ?? refused}
				<p class="text-sm text-destructive" role="alert">{problem ?? refused}</p>
			{/if}

			<Button type="submit" disabled={leaving} aria-busy={leaving} class="h-11 w-full">
				{leaving ? 'Taking you there…' : 'Continue'}
			</Button>
		</form>

		<a
			href="/settings"
			class="inline-flex min-h-11 items-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
		>
			Settings
		</a>
	</div>
</div>
