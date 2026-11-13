<script lang="ts">
	// Serving the folders open here to a headset — docs/ARCHITECTURE.md
	// § "A headset beside the desk".
	import type { ServeReach } from '@sloppy/types';
	import { PairedHeadsets, ServeCode, ServeReachChoice, ServeTicket } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';
	import { Label } from '@sloppy/ui/label';
	import { Switch } from '@sloppy/ui/switch';
	import { SERVED_ELSEWHERE, serving } from '../stores/serving.svelte.js';

	const WENT_WRONG = 'Serving could not start here. Try again.';

	let busy = $state(false);
	let problem = $state<string | null>(null);
	let forgetting = $state<string | null>(null);
	let typedRelay = $state(serving.choice.relay ?? '');
	let relayProblem = $state<string | null>(null);

	const on = $derived(serving.serving !== undefined);
	const connected = $derived(serving.connections);

	function said(thrown: unknown): string {
		return thrown instanceof Error && thrown.message ? thrown.message : WENT_WRONG;
	}

	async function doing(act: () => Promise<unknown>): Promise<void> {
		busy = true;
		problem = null;
		try {
			await act();
		} catch (thrown) {
			problem = said(thrown);
		} finally {
			busy = false;
		}
	}

	function turn(wanted: boolean): void {
		void doing(() => (wanted ? serving.start() : serving.stop()));
	}

	function pair(): void {
		void doing(() => serving.pair());
	}

	function pick(reach: ServeReach): void {
		void doing(() => serving.choose(reach, serving.choice.relay));
	}

	/** A relay is a web address; empty is the public ones. */
	function relayFrom(typed: string): string | undefined | null {
		const trimmed = typed.trim();
		if (trimmed === '') return undefined;
		try {
			const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
			return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
		} catch {
			return null;
		}
	}

	function useRelay(event: SubmitEvent): void {
		event.preventDefault();
		const relay = relayFrom(typedRelay);
		if (relay === null) {
			relayProblem = "That doesn't look like a web address. Try something like relay.example.com.";
			return;
		}
		relayProblem = null;
		typedRelay = relay ?? '';
		void doing(() => serving.choose('anywhere', relay));
	}

	function forget(id: string): void {
		forgetting = id;
		problem = null;
		serving
			.forget(id)
			.catch((thrown) => (problem = said(thrown)))
			.finally(() => (forgetting = null));
	}
</script>

{#snippet found(name: string | undefined)}
	{#if name}
		It finds this desk as <span class="font-medium text-foreground">{name}</span>.
	{:else}
		It finds this desk under this computer's name.
	{/if}
{/snippet}

{#if !serving.possible}
	<p class="text-sm text-muted-foreground">{SERVED_ELSEWHERE}</p>
{:else}
	<p class="text-sm text-muted-foreground">
		Read the folders open here standing among them, in a headset. A headset reads what is here; it
		cannot change anything.
	</p>

	<div class="flex items-start gap-3">
		<Switch id="serve-on" bind:checked={() => on, (wanted) => turn(wanted)} disabled={busy} />
		<div class="min-w-0 flex-1 space-y-1">
			<Label for="serve-on" class="text-sm font-normal">Serve to a headset</Label>
			<p class="text-xs text-muted-foreground">
				{#if !on}
					Off. Nothing here can be read from a headset.
				{:else if connected === 0}
					On. No headset is reading now.
				{:else if connected === 1}
					On. One headset is reading now.
				{:else}
					On. {connected} headsets are reading now.
				{/if}
			</p>
			{#if on}
				<p class="text-xs text-muted-foreground">Stays on when Sloppy opens again.</p>
			{/if}
		</div>
	</div>

	{#if problem ?? serving.says}
		<p class="text-sm text-destructive" role="alert">{problem ?? serving.says}</p>
	{/if}

	{#if serving.serving}
		<div class="space-y-2">
			<p class="text-sm font-medium">Pairing</p>
			{#if serving.serving.pairing}
				<ServeCode code={serving.serving.pairing.code} until={serving.serving.pairing.until} />
				<p class="text-sm text-muted-foreground">
					Enter it on the headset. It pairs one headset, and goes once that one has.
					{@render found(serving.serving.name)}
				</p>
			{:else}
				<p class="text-sm text-muted-foreground">
					A headset that has not paired with this desk needs a code, once.
					{@render found(serving.serving.name)}
				</p>
			{/if}
			<Button variant="outline" class="h-control" disabled={busy} onclick={pair}>
				Pair a headset
			</Button>
		</div>
	{/if}

	<ServeReachChoice reach={serving.choice.reach} disabled={busy} onpick={pick} />

	{#if serving.choice.reach === 'anywhere'}
		<form class="space-y-2" onsubmit={useRelay}>
			<Label for="serve-relay" class="text-sm font-normal">A relay of your own</Label>
			<p class="text-xs text-muted-foreground">
				Leave it empty to use a public one, or give the web address of one you run.
			</p>
			<div class="flex flex-col gap-2 sm:flex-row">
				<Input
					id="serve-relay"
					name="relay"
					type="text"
					inputmode="url"
					autocapitalize="none"
					spellcheck={false}
					placeholder="relay.example.com"
					bind:value={typedRelay}
					class="h-control sm:flex-1"
				/>
				<Button type="submit" variant="outline" class="h-control" disabled={busy}>Use this</Button>
			</div>
			{#if relayProblem}
				<p class="text-sm text-destructive" role="alert">{relayProblem}</p>
			{/if}
		</form>

		{#if serving.serving?.reach === 'anywhere'}
			<div class="space-y-2">
				<p class="text-sm font-medium">For a headset on another network</p>
				<ServeTicket ticket={serving.serving.ticket} />
			</div>
		{/if}
	{/if}

	{#if serving.serving}
		<div class="space-y-2">
			<p class="text-sm font-medium">Paired headsets</p>
			<PairedHeadsets paired={serving.serving.paired} {forgetting} onforget={forget} />
		</div>
	{/if}
{/if}
