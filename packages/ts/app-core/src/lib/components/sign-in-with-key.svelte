<script lang="ts">
	// Signing in with the key somebody already has for an address they already
	// go by — docs/ARCHITECTURE.md § "Signing in with a key of your own".
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
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
	let showingHow = $state(false);

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

		<div class="rounded-md border border-border">
			<button
				type="button"
				class="flex min-h-control w-full items-center justify-between gap-3 px-3 text-left text-sm hover:bg-muted"
				aria-expanded={showingHow}
				aria-controls="how-your-key-is-found"
				onclick={() => (showingHow = !showingHow)}
			>
				<span>How Sloppy finds your key</span>
				<ChevronDown
					class="size-4 shrink-0 transition-transform {showingHow ? 'rotate-180' : ''}"
					aria-hidden="true"
				/>
			</button>
			{#if showingHow}
				<div id="how-your-key-is-found" class="space-y-3 px-3 pb-3 text-sm text-muted-foreground">
					<p>
						Sloppy looks your key up by your address, so the public half has to be somewhere it can
						be found first. Either one of these is enough:
					</p>
					<ul class="list-disc space-y-2 pl-5">
						<li>
							<span class="text-foreground">Publish it at keys.openpgp.org.</span> Upload the public half
							and answer the mail it sends you. This works for an address at any provider — Gmail, Outlook
							and Yahoo included.
						</li>
						<li>
							<span class="text-foreground">Or serve it from your own domain</span>, if the address
							is at one you run. Publishing it there means nobody else has to be asked at all.
						</li>
					</ul>
					<p>
						Nothing of yours is uploaded from this screen, and the half you keep secret never leaves
						your machine.
					</p>
				</div>
			{/if}
		</div>

		{#if problem}
			<p class="text-sm text-destructive" role="alert">{problem}</p>
		{/if}

		<Button type="submit" disabled={working} aria-busy={working} class="h-control w-full">
			{working ? 'Just a moment…' : 'Continue'}
		</Button>
	</form>
{:else}
	<form class="space-y-4" onsubmit={finish}>
		<div class="space-y-2">
			<p class="text-sm">Sign this exactly as it is, then paste the signature back.</p>
			<pre
				class="max-h-48 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs break-all whitespace-pre-wrap select-all">{statement}</pre>
			<Button type="button" variant="outline" class="h-control w-full" onclick={copy}>
				{copied ? 'Copied' : 'Copy the text'}
			</Button>
			<p class="text-sm text-muted-foreground">
				Good once, for the next {goodFor}
				{goodFor === 1 ? 'minute' : 'minutes'}.
			</p>
		</div>

		<div class="space-y-2">
			<Label for="own-key-signature">The signature</Label>
			<Textarea
				id="own-key-signature"
				name="own-key-signature"
				rows={6}
				required
				spellcheck={false}
				class="font-mono text-xs"
				bind:value={signature}
			/>
			<p class="text-sm text-muted-foreground">
				A detached signature, or the whole signed text with the signature in it.
			</p>
			<p class="text-sm text-muted-foreground">
				With GnuPG: save the text to a file and run
				<code class="rounded bg-muted px-1 py-0.5 text-xs"
					>gpg --detach-sign --armor --local-user you@example.com the-file</code
				>, then paste what lands beside it.
			</p>
		</div>

		{#if problem}
			<p class="text-sm text-destructive" role="alert">{problem}</p>
		{/if}

		<Button type="submit" disabled={working} aria-busy={working} class="h-control w-full">
			{working ? 'Signing you in…' : 'Sign in'}
		</Button>
		<Button
			type="button"
			variant="ghost"
			disabled={working}
			class="h-control w-full"
			onclick={startAgain}
		>
			Start again
		</Button>
	</form>
{/if}
