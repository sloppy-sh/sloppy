<script lang="ts">
	// Asking for a project's notes to be written, in the four steps
	// docs/ARCHITECTURE.md § "Asking a tool to write the notes" sets: the words,
	// the places proposed back, the list somebody settles, and the run.
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import type { Files } from '@sloppy/local';
	import {
		DOCUMENTING_INTENT_MAX,
		DOCUMENTING_TOOLS,
		documentingToolName,
		type OwnedRef,
		type PlaceDone
	} from '@sloppy/types';
	import { ResponsiveModal, scrollFade } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';
	import { Skeleton } from '@sloppy/ui/skeleton';
	import { Textarea } from '@sloppy/ui/textarea';
	import { untrack } from 'svelte';
	import type { NoteLanding } from '../pages/page-state.js';
	import { filesIn } from '../project-code.js';
	import { documenting, type DocumentingStep } from '../stores/documenting.svelte.js';
	import { nodes } from '../stores/nodes.svelte.js';

	let {
		open = $bindable(false),
		project,
		onOpen
	}: {
		open?: boolean;
		/** The project's own files, which is where a place somebody adds by hand
		 *  comes from. */
		project: Files;
		/** Read a note the run left, at its offered change where it left one. */
		onOpen: (note: OwnedRef, at?: NoteLanding) => void;
	} = $props();

	/** Enough matches to choose between, few enough to reach the end of on a
	 *  phone. */
	const MOST_MATCHES = 12;

	/** What Sloppy knows how to ask, as somebody with none of them reads it. */
	const TOOLS_IT_ASKS = DOCUMENTING_TOOLS.map(documentingToolName).join(' or ');

	const step = $derived(documenting.step);
	const tools = $derived(documenting.tools);
	const progress = $derived(documenting.progress);
	const running = $derived(step === 'surveying' || step === 'running');

	let looking = $state('');
	/** Every place in the project somebody could add, `null` until it has been
	 *  read. */
	let inTheProject = $state.raw<string[] | null>(null);
	let readFrom: Files | null = null;

	$effect(() => {
		const held = project;
		if (step !== 'refining') return;
		untrack(() => {
			if (readFrom === held) return;
			readFrom = held;
			inTheProject = null;
			void readTheProject(held);
		});
	});

	/** Every file, and every folder on the way to one. */
	async function readTheProject(held: Files): Promise<void> {
		const paths = await filesIn(held).catch(() => []);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built whole and read out once; the state is what it is handed to.
		const places = new Set(paths);
		for (const path of paths) {
			const parts = path.split('/');
			parts.pop();
			for (let deep = 1; deep <= parts.length; deep += 1) {
				places.add(parts.slice(0, deep).join('/'));
			}
		}
		if (readFrom === held) inTheProject = [...places].sort();
	}

	const chosen = $derived(new Set(documenting.places.map((place) => place.path)));
	const matches = $derived.by(() => {
		const words = looking.trim().toLowerCase();
		const held = inTheProject;
		if (words === '' || held === null) return [];
		return held
			.filter((path) => !chosen.has(path) && path.toLowerCase().includes(words))
			.slice(0, MOST_MATCHES);
	});

	function titleOf(note: OwnedRef): string {
		const held = nodes.get(note);
		return held === undefined || held.title.trim() === '' ? 'Untitled' : held.title;
	}

	function read(done: PlaceDone): void {
		if (!done.note) return;
		open = false;
		onOpen(done.note.ref, done.note.done === 'offered' ? 'offers' : undefined);
	}

	function addLooked(path: string): void {
		documenting.add(path);
		looking = '';
	}

	const chip =
		'inline-flex min-h-9 items-center gap-1 rounded-full border border-border pl-3 text-sm';
	const chipOff =
		'inline-flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 ease-out hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none';

	const DESCRIPTIONS: Partial<Record<DocumentingStep, string>> = {
		intent: 'Say what you want written about, and why.',
		refining: 'Take out what you would rather not have written about, and add what is missing.',
		over: 'What came back.'
	};

	const rowButton =
		'flex min-h-11 w-full flex-col items-start justify-center gap-0.5 rounded-md px-2 py-2 text-left transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none';
</script>

<ResponsiveModal bind:open title="Write notes about the code" description={DESCRIPTIONS[step]}>
	<div class="space-y-4 px-2 pt-4 pb-2">
		{#if tools === null}
			<Skeleton class="h-11 w-full" />
		{:else if tools === 'untold' || tools.length === 0}
			<p class="px-1 py-2 text-sm text-muted-foreground">
				{tools === 'untold'
					? `Sloppy could not tell whether ${TOOLS_IT_ASKS} is on this machine.`
					: `Sloppy asks ${TOOLS_IT_ASKS} to write these notes, and it is not on this machine. Install it, then look again.`}
			</p>
			<Button variant="outline" class="h-11 w-full" onclick={() => void documenting.lookForTools()}>
				Look again
			</Button>
		{:else if step === 'intent'}
			<Textarea
				bind:value={() => documenting.said, (words) => documenting.say(words)}
				rows={4}
				maxlength={DOCUMENTING_INTENT_MAX}
				class="min-h-24"
				aria-label="What you want written about, and why"
				placeholder="What this project is, and what somebody new would need to understand first."
			/>
			<Button class="h-11 w-full" onclick={() => void documenting.survey()}>
				Look over the code
			</Button>
		{:else if step === 'surveying'}
			<div class="space-y-2" role="status" aria-label="Looking over the code">
				<p class="px-1 text-sm text-muted-foreground">Looking over the code.</p>
				{#each Array.from({ length: 3 }, (_, row) => row) as row (row)}
					<Skeleton class="h-11 w-full" />
				{/each}
			</div>
		{:else if step === 'refining'}
			{#if documenting.places.length === 0}
				<p class="px-1 py-2 text-sm text-muted-foreground">
					Nothing came back as worth a note. Add a place yourself, or say more and look again.
				</p>
			{:else}
				<ul class="space-y-1">
					{#each documenting.places as place, at (place.path)}
						<li class="flex min-w-0 items-start gap-1 rounded-md px-2 py-2">
							<div class="min-w-0 flex-1 py-1.5">
								<p class="text-sm break-all">{place.path}</p>
								{#if place.reason}
									<p class="text-sm text-muted-foreground">{place.reason}</p>
								{/if}
								{#if place.note}
									<p class="text-xs text-muted-foreground">Changes the note already here.</p>
								{/if}
								{#if place.tags && place.tags.length > 0}
									<ul class="mt-1 flex flex-wrap items-center gap-1.5">
										{#each place.tags as tag (tag)}
											<li class={chip}>
												{tag}
												<button
													type="button"
													class={chipOff}
													aria-label="Do not tag {place.path} {tag}"
													onclick={() => documenting.untag(place.path, tag)}
												>
													<X class="size-3.5" />
												</button>
											</li>
										{/each}
									</ul>
								{/if}
							</div>
							<Button
								variant="ghost"
								class="size-11 shrink-0"
								aria-label="Write about {place.path} earlier"
								disabled={at === 0}
								onclick={() => documenting.move(place.path, -1)}
							>
								<ArrowUp class="size-4" />
							</Button>
							<Button
								variant="ghost"
								class="size-11 shrink-0"
								aria-label="Write about {place.path} later"
								disabled={at === documenting.places.length - 1}
								onclick={() => documenting.move(place.path, 1)}
							>
								<ArrowDown class="size-4" />
							</Button>
							<Button
								variant="ghost"
								class="size-11 shrink-0"
								aria-label="Leave out {place.path}"
								onclick={() => documenting.drop(place.path)}
							>
								<X class="size-4" />
							</Button>
						</li>
					{/each}
				</ul>
			{/if}

			<div class="space-y-1">
				<Input
					bind:value={looking}
					class="h-11"
					autocomplete="off"
					aria-label="Add somewhere else in the project"
					placeholder="Add a file or folder"
				/>
				{#if matches.length > 0}
					<ul
						class="max-h-[30vh] space-y-0.5 overflow-y-auto scroll-fade-y [--scroll-fade:1rem]"
						{@attach scrollFade('y')}
					>
						{#each matches as path (path)}
							<li>
								<button type="button" class={rowButton} onclick={() => addLooked(path)}>
									<span class="flex w-full min-w-0 items-center gap-2 text-sm">
										<Plus class="size-4 shrink-0 text-muted-foreground" />
										<span class="min-w-0 break-all">{path}</span>
									</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			<div class="space-y-2">
				<Button
					class="h-11 w-full"
					disabled={documenting.places.length === 0}
					onclick={() => void documenting.run()}
				>
					Write these notes
				</Button>
				<Button variant="ghost" class="h-11 w-full" onclick={() => documenting.askAgain()}>
					Say something else
				</Button>
			</div>
		{:else if progress}
			{#if progress.stage === 'reading'}
				<p class="px-1 text-sm text-muted-foreground" role="status">Reading the code.</p>
			{:else if progress.stage === 'writing'}
				<p class="px-1 text-sm text-muted-foreground" role="status">
					Writing about {progress.at}.
				</p>
			{:else if progress.places.length === 0}
				<p class="px-1 text-sm text-muted-foreground" role="status">Nothing was written.</p>
			{/if}

			{#if progress.places.length > 0}
				<ul class="space-y-1">
					{#each progress.places as done (done.path)}
						<li>
							{#if done.note}
								<button type="button" class={rowButton} onclick={() => read(done)}>
									<span class="min-w-0 text-sm break-all">{done.path}</span>
									<span class="min-w-0 text-sm break-words text-muted-foreground">
										{titleOf(done.note.ref)}
									</span>
									{#if done.note.done === 'offered'}
										<span class="text-xs text-muted-foreground">
											A change is offered on it — read it and take it in.
										</span>
									{/if}
								</button>
								{#if done.note.suggested && done.note.suggested.length > 0}
									<div class="space-y-2 px-2 pb-2">
										<p class="text-xs text-muted-foreground">
											Tags it suggests. Nothing goes on until you say so.
										</p>
										<ul class="flex flex-wrap items-center gap-1.5">
											{#each done.note.suggested as tag (tag)}
												<li class="{chip} pr-3">{tag}</li>
											{/each}
										</ul>
										<Button
											variant="outline"
											class="h-11 w-full"
											onclick={() => void documenting.takeIn(done)}
										>
											Tag it {done.note.suggested.join(', ')}
										</Button>
									</div>
								{/if}
							{:else}
								<div class="flex min-h-11 flex-col justify-center px-2 py-2">
									<p class="text-sm break-all">{done.path}</p>
									<p class="text-xs text-muted-foreground">Nothing to say about this one.</p>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{/if}

		{#if documenting.trouble}
			<p class="px-1 text-sm text-destructive" role="alert">{documenting.trouble}</p>
		{/if}

		{#if running}
			<Button
				variant="outline"
				class="h-11 w-full"
				disabled={documenting.stopping}
				onclick={() => void documenting.stop()}
			>
				Stop
			</Button>
		{:else if step === 'over'}
			<Button variant="ghost" class="h-11 w-full" onclick={() => documenting.askAgain()}>
				Ask for something else
			</Button>
		{/if}
	</div>
</ResponsiveModal>
