<script lang="ts">
	// Turning the record on, reading it and handing it over. What goes in it,
	// and what is kept out of it, is `stores/what-happened.svelte.ts`.
	import { CopyButton, ResponsiveModal } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Label } from '@sloppy/ui/label';
	import { Switch } from '@sloppy/ui/switch';
	import { saveHere, savesFiles } from '../save-file.js';
	import { whatHappened } from '../stores/what-happened.svelte.js';

	let reading = $state(false);
	let saving = $state(false);
	let trouble = $state<string | null>(null);

	const canSave = savesFiles();
	const kept = $derived(whatHappened.kept);

	async function handOver(): Promise<void> {
		saving = true;
		trouble = null;
		try {
			const name = `sloppy-record-${new Date().toISOString().slice(0, 10)}.txt`;
			await saveHere(name, new Blob([whatHappened.asText()], { type: 'text/plain' }));
		} catch {
			trouble = 'Sloppy could not put the record anywhere just now. Try again.';
		} finally {
			saving = false;
		}
	}

	/** The time of day it happened, to the millisecond, which is what two of
	 *  them are lined up by. */
	function clock(at: string): string {
		return at.slice(11, 23);
	}
</script>

<div class="space-y-3" data-surface="what-happened">
	<div class="flex items-start gap-3">
		<Switch
			id="what-happened"
			checked={whatHappened.on}
			onCheckedChange={(on) => whatHappened.record(on)}
		/>
		<div class="min-w-0 flex-1 space-y-1">
			<Label for="what-happened" class="text-sm font-normal">
				Keep a record while I use Sloppy
			</Label>
			<p class="text-xs text-muted-foreground">
				It holds what Sloppy was doing and anything that went wrong — never your notes, and never
				what you say to the chat. It keeps the last few hundred things, and lets them go when you
				close Sloppy.
			</p>
		</div>
	</div>

	{#if whatHappened.on}
		<p class="text-sm text-muted-foreground" role="status">
			Sloppy is keeping a record{kept.length === 0 ? '' : ` — ${kept.length} things so far`}.
		</p>
	{/if}

	{#if kept.length > 0}
		<div class="flex flex-wrap items-center gap-2">
			<Button variant="outline" class="h-control" onclick={() => (reading = true)}>Read it</Button>
			{#if canSave}
				<Button
					variant="outline"
					class="h-control"
					disabled={saving}
					onclick={() => void handOver()}
				>
					{saving ? 'One moment…' : 'Save it'}
				</Button>
			{/if}
			<Button variant="ghost" class="h-control" onclick={() => whatHappened.clear()}
				>Clear it</Button
			>
			<CopyButton value={whatHappened.asText()} label="Copy the record" />
		</div>
		{#if trouble}
			<p class="text-sm text-destructive" role="alert">{trouble}</p>
		{/if}
	{/if}
</div>

<ResponsiveModal bind:open={reading} title="What happened" fill>
	{#if kept.length === 0}
		<p class="py-2 text-sm text-muted-foreground">
			Nothing here yet. Leave this on, do the thing that went wrong, and it will show up here.
		</p>
	{:else}
		<ul class="text-xs">
			{#each kept as one, place (place)}
				<li class="flex gap-3 border-b border-border py-2 last:border-b-0">
					<time class="shrink-0 font-mono text-muted-foreground" datetime={one.at}>
						{clock(one.at)}
					</time>
					<p class="min-w-0 flex-1 break-words {one.kind === 'trouble' ? 'text-destructive' : ''}">
						{one.said}
					</p>
				</li>
			{/each}
		</ul>
	{/if}
</ResponsiveModal>
