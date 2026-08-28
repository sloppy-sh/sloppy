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
	let here = $state<string | undefined>(undefined);
	let asking = $state(false);
	let unanswered = $state(false);

	const refused = $derived(page.url.searchParams.get('sloppy_error'));

	// Somebody with no identity anywhere has to be offered one, or the only way
	// in is an address they would have to be told.
	$effect(() => {
		void offer();
	});

	async function offer() {
		asking = true;
		try {
			here = await api.ownInstance();
			unanswered = false;
		} catch {
			unanswered = true;
		} finally {
			asking = false;
		}
	}

	async function begin(event: SubmitEvent) {
		event.preventDefault();
		await go(instance.trim());
	}

	async function go(instanceUrl: string) {
		leaving = true;
		problem = null;
		try {
			const { consent_url } = await api.startLogin({
				instance_url: instanceUrl,
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
			<p class="text-muted-foreground">One thought, then the one it leads to.</p>
		</div>

		{#if here || unanswered}
			<div class="space-y-3">
				{#if here}
					<Button type="button" disabled={leaving} class="h-11 w-full" onclick={() => go(here!)}>
						Start here
					</Button>
					<p class="text-sm text-muted-foreground">
						Make an identity on this Sloppy, or sign in with one you already have.
					</p>
				{:else}
					<p class="text-sm text-muted-foreground" role="status">
						Sloppy could not offer you an identity here just now.
					</p>
					<Button
						type="button"
						variant="outline"
						disabled={asking}
						class="h-11 w-full"
						onclick={() => void offer()}
					>
						{asking ? 'Trying…' : 'Try again'}
					</Button>
				{/if}
			</div>

			<div class="flex items-center gap-3" aria-hidden="true">
				<span class="h-px flex-1 bg-border"></span>
				<span class="text-xs text-muted-foreground">or</span>
				<span class="h-px flex-1 bg-border"></span>
			</div>
		{/if}

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
