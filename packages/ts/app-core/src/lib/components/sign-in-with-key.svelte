<script lang="ts">
	// Signing in with the key somebody already has for an address they already
	// go by — docs/ARCHITECTURE.md § "Signing in with a key of your own".
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';
	import { Label } from '@sloppy/ui/label';
	import { Textarea } from '@sloppy/ui/textarea';
	import { api } from '../api.js';
	import { session } from '../stores/session.svelte.js';
	import { serverMessage } from '../stores/errors.js';

	let address = $state('');
	let statement = $state<string | null>(null);
	let goodFor = $state(0);
	let signature = $state('');
	let working = $state(false);
	let copied = $state(false);
	let problem = $state<string | null>(null);

	async function ask(event: SubmitEvent) {
		event.preventDefault();
		working = true;
		problem = null;
		try {
			const asked = await api.signInChallenge({ principal: `mailto:${address.trim()}` });
			statement = asked.statement;
			goodFor = Math.max(1, Math.round((Date.parse(asked.expires_at) - Date.now()) / 60_000));
			signature = '';
			copied = false;
		} catch (error) {
			problem = serverMessage(error) ?? 'Sloppy could not start that just now. Try again.';
		} finally {
			working = false;
		}
	}

	async function finish(event: SubmitEvent) {
		event.preventDefault();
		if (!statement) return;
		working = true;
		problem = null;
		try {
			const settled = await api.answerChallenge({ statement, signature: signature.trim() });
			session.adopt(settled.viewer, settled.token);
		} catch (error) {
			problem = serverMessage(error) ?? 'Sloppy could not sign you in just now. Try again.';
			working = false;
		}
	}

	async function copy() {
		if (!statement) return;
		try {
			await navigator.clipboard.writeText(statement);
			copied = true;
		} catch {
			problem = 'Sloppy could not copy that. Select the text and copy it yourself.';
		}
	}

	function startAgain() {
		statement = null;
		signature = '';
		problem = null;
	}
</script>

{#if statement === null}
	<form class="space-y-4" onsubmit={ask}>
		<div class="space-y-2">
			<Label for="own-key-address">Your email address</Label>
			<Input
				id="own-key-address"
				name="own-key-address"
				type="email"
				inputmode="email"
				autocomplete="email"
				required
				placeholder="alice@example.com"
				bind:value={address}
			/>
			<p class="text-sm text-muted-foreground">
				Sign in with the key you already use for this address.
			</p>
		</div>

		{#if problem}
			<p class="text-sm text-destructive" role="alert">{problem}</p>
		{/if}

		<Button type="submit" disabled={working} aria-busy={working} class="h-11 w-full">
			{working ? 'Just a moment…' : 'Continue'}
		</Button>
	</form>
{:else}
	<form class="space-y-4" onsubmit={finish}>
		<div class="space-y-2">
			<p class="text-sm">Sign this exactly as it is, then paste what your key gives back.</p>
			<pre
				class="max-h-48 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs break-all whitespace-pre-wrap select-all">{statement}</pre>
			<Button type="button" variant="outline" class="h-11 w-full" onclick={copy}>
				{copied ? 'Copied' : 'Copy the text'}
			</Button>
			<p class="text-sm text-muted-foreground">
				Good once, for the next {goodFor}
				{goodFor === 1 ? 'minute' : 'minutes'}.
			</p>
		</div>

		<div class="space-y-2">
			<Label for="own-key-signature">What your key gave back</Label>
			<Textarea
				id="own-key-signature"
				name="own-key-signature"
				rows={6}
				required
				spellcheck={false}
				class="font-mono text-xs"
				bind:value={signature}
			/>
		</div>

		{#if problem}
			<p class="text-sm text-destructive" role="alert">{problem}</p>
		{/if}

		<Button type="submit" disabled={working} aria-busy={working} class="h-11 w-full">
			{working ? 'Signing you in…' : 'Sign in'}
		</Button>
		<Button
			type="button"
			variant="ghost"
			disabled={working}
			class="h-11 w-full"
			onclick={startAgain}
		>
			Start again
		</Button>
	</form>
{/if}
