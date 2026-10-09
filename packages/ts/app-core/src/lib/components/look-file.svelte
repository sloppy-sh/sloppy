<script lang="ts">
	// A look as a file: copied, saved, opened and pasted — DESIGN.md § "A look
	// is a file".
	import { Button } from '@sloppy/ui/button';
	import { Label } from '@sloppy/ui/label';
	import { Textarea } from '@sloppy/ui/textarea';
	import { onDestroy } from 'svelte';
	import { lookId, lookNow, readLook, wearLook } from '../look-file.js';
	import { openHere, opensFiles, saveHere, savesFiles } from '../save-file.js';
	import OwnCss from './own-css.svelte';

	/** How long "Copied" stands before the offer comes back. */
	const SAID_FOR_MS = 2500;

	const canSave = savesFiles();
	const canOpen = opensFiles();

	let said = $state<string | null>(null);
	let wrong = $state(false);
	let working = $state(false);
	let copied = $state(false);
	let pasted = $state('');
	let clearing: ReturnType<typeof setTimeout> | undefined;

	onDestroy(() => clearTimeout(clearing));

	function say(line: string, amiss = false): void {
		said = line;
		wrong = amiss;
	}

	async function copy(): Promise<void> {
		working = true;
		said = null;
		try {
			const look = await lookNow(false);
			await navigator.clipboard.writeText(JSON.stringify(look, null, 2));
			clearTimeout(clearing);
			copied = true;
			clearing = setTimeout(() => (copied = false), SAID_FOR_MS);
		} catch {
			say('Sloppy could not copy that just now. Try again.', true);
		} finally {
			working = false;
		}
	}

	async function save(withPreferences: boolean): Promise<void> {
		working = true;
		said = null;
		try {
			const look = await lookNow(withPreferences);
			const name = `${lookId(look.name)}${withPreferences ? '-settings' : ''}.json`;
			await saveHere(name, new Blob([JSON.stringify(look, null, 2)], { type: 'application/json' }));
		} catch {
			say('Sloppy could not put that in a file just now. Try again.', true);
		} finally {
			working = false;
		}
	}

	async function take(text: string): Promise<boolean> {
		const read = readLook(text);
		if (typeof read === 'string') {
			say(read, true);
			return false;
		}
		const why = await wearLook(read);
		if (why !== null) {
			say(why, true);
			return false;
		}
		say(`Now wearing ${read.name}.`);
		return true;
	}

	async function open(): Promise<void> {
		working = true;
		said = null;
		try {
			const chosen = await openHere('.json');
			if (!chosen) return;
			await take(await chosen.text());
		} catch {
			say('Sloppy could not read that file. Try another.', true);
		} finally {
			working = false;
		}
	}

	async function usePasted(): Promise<void> {
		working = true;
		said = null;
		try {
			if (await take(pasted)) pasted = '';
		} finally {
			working = false;
		}
	}
</script>

<div class="space-y-6">
	<div class="space-y-3">
		<div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
			<Button
				variant="outline"
				disabled={working}
				class="h-control w-full sm:w-auto"
				onclick={copy}
			>
				{copied ? 'Copied' : 'Copy'}
			</Button>
			{#if canSave}
				<Button
					variant="outline"
					disabled={working}
					class="h-control w-full sm:w-auto"
					onclick={() => save(false)}
				>
					Save a look…
				</Button>
				<Button
					variant="outline"
					disabled={working}
					class="h-control w-full sm:w-auto"
					onclick={() => save(true)}
				>
					Save my settings…
				</Button>
			{/if}
			{#if canOpen}
				<Button
					variant="outline"
					disabled={working}
					class="h-control w-full sm:w-auto"
					onclick={open}
				>
					Open a look…
				</Button>
			{/if}
		</div>
		<p class="text-sm text-muted-foreground">
			Your look is a small file. Send one to somebody and their Sloppy reads like yours. A look you
			open changes what it says and leaves the rest of yours alone.
		</p>
	</div>

	<div class="space-y-2">
		<Label for="look-pasted">Paste a look</Label>
		<Textarea
			id="look-pasted"
			name="look-pasted"
			rows={4}
			spellcheck={false}
			class="font-mono text-xs"
			bind:value={pasted}
		/>
		<Button
			disabled={working || pasted.trim() === ''}
			class="h-control w-full sm:w-auto"
			onclick={usePasted}
		>
			Use this look
		</Button>
	</div>

	{#if said}
		{#if wrong}
			<p class="text-sm text-destructive" role="alert">{said}</p>
		{:else}
			<p class="text-sm text-muted-foreground" aria-live="polite">{said}</p>
		{/if}
	{/if}

	<OwnCss />
</div>
