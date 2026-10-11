<script lang="ts">
	// A look as a file: copied, saved, opened and pasted — DESIGN.md § "A look
	// is a file".
	import { Button } from '@sloppy/ui/button';
	import { Label } from '@sloppy/ui/label';
	import { Textarea } from '@sloppy/ui/textarea';
	import { onDestroy } from 'svelte';
	import { lookId, lookNow, readLook, rulesWithheld, wearLook } from '../look-file.js';
	import { openHere, opensFiles, saveHere, savesFiles } from '../save-file.js';
	import { prefs } from '../stores/prefs.svelte.js';
	import OwnCss from './own-css.svelte';

	/** How long "Copied" stands before the offer comes back. */
	const SAID_FOR_MS = 2500;
	/** What a copy of the look leaves behind, where the rules of their own on it
	 *  are ones a look cannot carry. */
	const WITHOUT_THE_RULES = ', without the rules that reach the web.';

	const canSave = savesFiles();
	const canOpen = opensFiles();
	/** Whether the look on holds rules a copy of it leaves out. */
	const withheld = $derived(rulesWithheld(prefs.current.css));

	/** Which controls a line answers for, so it stands with them rather than
	 *  wherever this section ends. */
	type Answering = 'the files' | 'the box';

	let said = $state<{ line: string; wrong: boolean; at: Answering } | null>(null);
	let working = $state(false);
	let copied = $state(false);
	let pasted = $state('');
	let clearing: ReturnType<typeof setTimeout> | undefined;

	onDestroy(() => clearTimeout(clearing));

	function say(at: Answering, line: string, amiss = false): void {
		said = { line, wrong: amiss, at };
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
			if (withheld) say('the files', `Copied${WITHOUT_THE_RULES}`);
		} catch {
			say(
				'the files',
				canSave
					? 'Sloppy could not copy that. Save the look to a file instead.'
					: 'Sloppy could not copy that. Open Sloppy in a browser to copy a look.',
				true
			);
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
			if (withheld) say('the files', `Saved${WITHOUT_THE_RULES}`);
		} catch {
			say('the files', 'Sloppy could not put that in a file just now. Try again.', true);
		} finally {
			working = false;
		}
	}

	async function take(at: Answering, text: string): Promise<boolean> {
		const read = readLook(text);
		if (typeof read === 'string') {
			say(at, read, true);
			return false;
		}
		const why = await wearLook(read);
		if (why !== null) {
			say(at, why, true);
			return false;
		}
		say(
			at,
			read.preferences === undefined
				? `Now wearing ${read.name}.`
				: `Now wearing ${read.name}, and your settings came with it.`
		);
		return true;
	}

	async function open(): Promise<void> {
		working = true;
		said = null;
		try {
			const chosen = await openHere('.json');
			if (!chosen) return;
			await take('the files', await chosen.text());
		} catch {
			say('the files', 'Sloppy could not read that file. Try another.', true);
		} finally {
			working = false;
		}
	}

	async function usePasted(): Promise<void> {
		working = true;
		said = null;
		try {
			if (await take('the box', pasted)) pasted = '';
		} finally {
			working = false;
		}
	}
</script>

{#snippet answer(at: Answering)}
	{#if said !== null && said.at === at}
		{#if said.wrong}
			<p class="text-sm text-destructive" role="alert">{said.line}</p>
		{:else}
			<p class="text-sm text-muted-foreground" role="status">{said.line}</p>
		{/if}
	{/if}
{/snippet}

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
		{@render answer('the files')}
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
		{@render answer('the box')}
	</div>

	<OwnCss />
</div>
