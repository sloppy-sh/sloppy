<script lang="ts">
	// The identities a device holds, and the ways one arrives —
	// docs/ARCHITECTURE.md § "A graph off the device".
	import type { IdentityHere } from '@sloppy/local';
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';
	import { Label } from '@sloppy/ui/label';
	import { heading, kept, shut } from '../held-identity.js';
	import { runtime } from '../runtime.js';
	import { openHere, opensFiles, saveHere, savesFiles } from '../save-file.js';
	import { serverMessage } from '../stores/errors.js';
	import { session } from '../stores/session.svelte.js';

	let {
		/** Whether the offer of one made here belongs on this surface. The first
		 *  run makes one as part of opening the graph, so it does not. */
		mints = true
	}: { mints?: boolean } = $props();

	const identities = runtime.identities();

	let held = $state<IdentityHere[]>([]);
	let busy = $state<string | null>(null);
	let problem = $state<string | null>(null);
	let asking = $state(false);
	let address = $state('');
	/** Which identity is being given a name, and what has been typed for it.
	 *  Null is nobody being named. */
	let naming = $state<string | null>(null);
	let typed = $state('');

	const canCarryOut = $derived(savesFiles());
	const canBringIn = $derived(opensFiles());

	$effect(() => {
		void refresh();
	});

	/** Reading who writes here is what makes this re-read when a sign-in lands
	 *  after the surface mounted, and what tells a slower answer to stand down. */
	async function refresh(): Promise<void> {
		if (!identities) return;
		const asOf = session.viewer?.did;
		const listed = await identities.list().catch(() => held);
		if (asOf === session.viewer?.did) held = listed;
	}

	async function run(what: string, act: () => Promise<void>): Promise<void> {
		busy = what;
		problem = null;
		session.clearSignInProblem();
		try {
			await act();
		} catch (error) {
			problem = serverMessage(error) ?? 'That did not work. Try again.';
		} finally {
			busy = null;
			await refresh();
		}
	}

	function makeOne(): void {
		if (!identities) return;
		void run('make', async () => {
			await identities.makeOne();
			await session.refresh();
		});
	}

	function signIn(event: SubmitEvent): void {
		event.preventDefault();
		if (!identities) return;
		const where = address.trim();
		if (!where) {
			problem = 'Type the web address of where your identity lives.';
			return;
		}
		void run('sign-in', async () => {
			await identities.signIn(where);
		});
	}

	function bring(): void {
		if (!identities) return;
		void run('bring', async () => {
			const file = await openHere('.json,application/json');
			if (!file) return;
			await identities.bring(new Uint8Array(await file.arrayBuffer()));
			await session.refresh();
		});
	}

	function bringLocked(): void {
		if (!identities) return;
		void run('bring-locked', async () => {
			const file = await openHere('.sigil,.json,application/json');
			if (!file) return;
			await identities.bringSealed(new Uint8Array(await file.arrayBuffer()));
			await session.refresh();
		});
	}

	function carryOut(did: string): void {
		if (!identities) return;
		void run(`carry:${did}`, async () => {
			const file = await identities.carryOut(did);
			await saveHere(file.name, new Blob([file.body.slice().buffer as ArrayBuffer]));
		});
	}

	function writeAs(did: string): void {
		if (!identities) return;
		void run(`write:${did}`, async () => {
			await identities.writeAs(did);
			await session.refresh();
		});
	}

	function nameIt(one: IdentityHere): void {
		naming = naming === one.did ? null : one.did;
		typed = one.label ?? '';
		problem = null;
	}

	function callIt(event: SubmitEvent, did: string): void {
		event.preventDefault();
		if (!identities) return;
		void run(`call:${did}`, async () => {
			await identities.callIt(did, typed);
			naming = null;
		});
	}
</script>

{#if identities}
	<div class="space-y-4" data-surface="identities">
		{#if held.length > 0}
			<ul class="space-y-2">
				{#each held as one (one.did)}
					{@const locked = shut(one)}
					<li class="rounded-md border border-border bg-card p-3">
						<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
							<span class="text-sm font-medium">{heading(one)}</span>
							{#if one.writing}
								<span class="text-xs text-muted-foreground">Writing here</span>
							{/if}
						</div>
						<p class="text-sm text-muted-foreground">{kept(one)}</p>
						{#if locked}
							<p class="text-sm text-muted-foreground">{locked}</p>
						{/if}
						{#if one.lapsed}
							<p class="text-sm text-muted-foreground">
								Sign in again to keep your name and picture up to date. What you have written is
								still yours.
							</p>
						{/if}
						<div class="mt-2 flex flex-wrap gap-2">
							{#if !one.writing}
								<Button
									variant="outline"
									class="h-11"
									disabled={busy !== null}
									onclick={() => writeAs(one.did)}
								>
									Write as this one
								</Button>
							{/if}
							<Button
								variant="ghost"
								class="h-11"
								disabled={busy !== null}
								aria-expanded={naming === one.did}
								onclick={() => nameIt(one)}
							>
								{one.label ? 'Change what you call it' : 'Give it a name'}
							</Button>
							{#if one.carriable && canCarryOut}
								<Button
									variant="ghost"
									class="h-11"
									disabled={busy !== null}
									onclick={() => carryOut(one.did)}
								>
									{busy === `carry:${one.did}` ? 'Putting it together…' : 'Save a copy to move it'}
								</Button>
							{/if}
						</div>
						{#if naming === one.did}
							<form
								class="mt-2 flex flex-col gap-2 sm:flex-row"
								onsubmit={(event) => callIt(event, one.did)}
							>
								<Label for="identity-name-{one.did}" class="sr-only">What you call this one</Label>
								<Input
									id="identity-name-{one.did}"
									name="identity-name"
									type="text"
									autocomplete="off"
									placeholder="What you call it"
									bind:value={typed}
									class="h-11 sm:flex-1"
								/>
								<Button
									type="submit"
									class="h-11"
									disabled={busy !== null}
									aria-busy={busy === `call:${one.did}`}
								>
									{busy === `call:${one.did}` ? 'One moment…' : 'Save'}
								</Button>
							</form>
							<p class="mt-2 text-sm text-muted-foreground">
								A name you give here stays on this device. Leave it empty to take it off again.
							</p>
						{/if}
					</li>
				{/each}
			</ul>
			<p class="text-sm text-muted-foreground">
				A folder you started is written in as yours. In somebody else's folder you write as
				whichever of these you pick. Picking one changes what you write from then on; what you have
				already written keeps the name it was written under.
			</p>
		{/if}

		<div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
			{#if mints}
				<Button variant="outline" class="h-11" disabled={busy !== null} onclick={makeOne}>
					{busy === 'make' ? 'One moment…' : 'Start a new one here'}
				</Button>
			{/if}
			<Button
				variant="outline"
				class="h-11"
				disabled={busy !== null}
				onclick={() => (asking = !asking)}
				aria-expanded={asking}
			>
				Sign in with your identity
			</Button>
			{#if canBringIn}
				<Button variant="outline" class="h-11" disabled={busy !== null} onclick={bring}>
					{busy === 'bring' ? 'Reading it…' : 'Bring one from another device'}
				</Button>
				<Button variant="outline" class="h-11" disabled={busy !== null} onclick={bringLocked}>
					{busy === 'bring-locked' ? 'Reading it…' : 'Bring one you keep under a passphrase'}
				</Button>
			{/if}
		</div>

		{#if asking}
			<p class="text-sm text-muted-foreground">
				An identity you keep in Syner, or anywhere else of your own, signs in here.
			</p>
			<form class="flex flex-col gap-2 sm:flex-row" onsubmit={signIn}>
				<Label for="identity-home" class="sr-only">Where your identity lives</Label>
				<Input
					id="identity-home"
					name="identity-home"
					type="text"
					inputmode="url"
					autocomplete="url"
					autocapitalize="none"
					spellcheck={false}
					placeholder="keys.example.com"
					bind:value={address}
					class="h-11 sm:flex-1"
				/>
				<Button type="submit" class="h-11" disabled={busy !== null} aria-busy={busy === 'sign-in'}>
					{busy === 'sign-in' ? 'Taking you there…' : 'Continue'}
				</Button>
			</form>
			<p class="text-sm text-muted-foreground">
				You'll approve Sloppy where your identity lives and come straight back. If you keep it in
				Syner, Syner is what you'll approve with when you get there. It settles who you write as;
				what you write still stays on this device.
			</p>
		{/if}

		{#if canCarryOut && held.some((one) => one.carriable)}
			<p class="text-sm text-muted-foreground">
				Whoever has the copy of an identity writes as you, so keep it the way you'd keep a key.
			</p>
		{/if}

		{#if problem ?? session.signInProblem}
			<p class="text-sm text-destructive" role="alert">{problem ?? session.signInProblem}</p>
		{/if}
	</div>
{/if}
