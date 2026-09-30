<script lang="ts" module>
	/** One line of work, here or somewhere else. */
	export interface LineRow {
		/** A line here by its own name, one kept somewhere else as `origin/main`. */
		name: string;
		/** The version it stands at. */
		head: string;
		/** Whether the folder is on it. */
		here: boolean;
		/** Whether it is kept somewhere else rather than here, which is the only
		 *  thing that decides what can be done with it. */
		elsewhere: boolean;
		/** How far it is from the line it follows, both absent where it follows
		 *  none — which is not the same as being level with something. */
		ahead?: number;
		behind?: number;
	}
</script>

<script lang="ts">
	// The lines of work a folder holds and the ones it has heard of — DESIGN.md
	// § "The history as a picture".
	import Check from '@lucide/svelte/icons/check';
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';

	let {
		lines,
		anyVersion = false,
		busy = false,
		unsettled = false,
		standingOn,
		onStartLine,
		onWorkOn,
		onBringIn,
		onDrop,
		onStartFrom
	}: {
		lines: readonly LineRow[];
		/** Whether a version has been kept at all: a line starts from one. */
		anyVersion?: boolean;
		busy?: boolean;
		/** Whether notes are still in two versions, which holds a merge back. */
		unsettled?: boolean;
		/** The short name of the version the folder stands on, absent where it is
		 *  on a line — which is when a row says it is the one being worked on. */
		standingOn?: string;
		onStartLine: (name: string) => Promise<boolean>;
		onWorkOn: (name: string) => Promise<boolean>;
		onBringIn: (name: string) => Promise<boolean>;
		onDrop: (name: string) => Promise<boolean>;
		/** A line here starting at what one kept somewhere else stands at. */
		onStartFrom: (name: string, head: string) => Promise<boolean>;
	} = $props();

	let naming = $state('');

	const here = $derived(lines.filter((one) => !one.elsewhere));
	const away = $derived(lines.filter((one) => one.elsewhere));

	/** How far a line is from the one it follows. Nothing where it follows
	 *  none, which is not the same as being level with something. */
	function distance(one: LineRow): string {
		if (one.ahead === undefined || one.behind === undefined) return '';
		if (one.ahead === 0 && one.behind === 0) return 'Level with where it is also kept';
		return [one.ahead ? `${one.ahead} ahead` : '', one.behind ? `${one.behind} behind` : '']
			.filter((said) => said !== '')
			.join(', ');
	}

	/** What a line kept somewhere else is called here: `origin/main` is `main`. */
	function bareName(name: string): string {
		return name.slice(name.indexOf('/') + 1);
	}

	async function startLine(): Promise<void> {
		const name = naming.trim();
		if (name === '') return;
		if (await onStartLine(name)) naming = '';
	}
</script>

<div class="space-y-4">
	{#if standingOn}
		<p class="text-xs text-muted-foreground" role="status">
			Working on a version, {standingOn}.
		</p>
	{/if}

	<ul class="space-y-2" aria-label="Lines of work here">
		{#each here as one (one.name)}
			<li class="space-y-1" data-line={one.name}>
				{#if one.here}
					<div class="flex items-baseline gap-2">
						<span class="w-4 shrink-0 text-muted-foreground">
							<Check class="size-4" aria-hidden="true" />
						</span>
						<span class="min-w-0 flex-1 truncate text-sm">{one.name}</span>
					</div>
					<div class="flex flex-wrap items-center gap-2 pl-6">
						<span class="text-xs text-muted-foreground">You are working on this one.</span>
						{#if distance(one)}
							<span class="text-xs text-muted-foreground">{distance(one)}</span>
						{/if}
					</div>
				{:else}
					<button
						type="button"
						class="flex min-h-control w-full items-baseline gap-2 rounded-lg ps-6 pe-1 text-left hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
						disabled={busy}
						onclick={() => void onWorkOn(one.name)}
					>
						<span class="min-w-0 flex-1 truncate text-sm">{one.name}</span>
						{#if distance(one)}
							<span class="shrink-0 text-xs text-muted-foreground">{distance(one)}</span>
						{/if}
					</button>
					<div class="flex flex-wrap gap-2 pl-6">
						<Button
							variant="outline"
							class="h-9 rounded-full text-xs"
							disabled={busy || unsettled}
							onclick={() => void onBringIn(one.name)}
						>
							Bring it in
						</Button>
						<Button
							variant="ghost"
							class="h-9 rounded-full text-xs"
							disabled={busy}
							onclick={() => void onDrop(one.name)}
						>
							Let it go
						</Button>
					</div>
				{/if}
			</li>
		{/each}
	</ul>

	{#if away.length > 0}
		<div class="space-y-2">
			<h4 class="text-xs text-muted-foreground">Kept somewhere else</h4>
			<ul class="space-y-2" aria-label="Lines of work kept somewhere else">
				{#each away as one (one.name)}
					<li class="flex flex-wrap items-center gap-2" data-line={one.name}>
						<span class="min-w-0 flex-1 truncate pl-6 text-sm">{one.name}</span>
						<Button
							variant="ghost"
							class="h-9 shrink-0 rounded-full text-xs"
							disabled={busy}
							onclick={() => void onStartFrom(bareName(one.name), one.head)}
						>
							Start one here
						</Button>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<div class="flex gap-2">
		<Input
			bind:value={naming}
			class="h-control flex-1"
			autocomplete="off"
			maxlength={128}
			placeholder="another-way"
			aria-label="Name a new line of work"
			onkeydown={(e) => {
				if (e.key !== 'Enter') return;
				e.preventDefault();
				void startLine();
			}}
		/>
		<Button
			variant="outline"
			class="h-control shrink-0"
			disabled={busy || !anyVersion || naming.trim() === ''}
			onclick={startLine}
		>
			Start it here
		</Button>
	</div>
	{#if !anyVersion}
		<p class="text-xs text-muted-foreground">Keep a version first, and a line can start from it.</p>
	{/if}
</div>
