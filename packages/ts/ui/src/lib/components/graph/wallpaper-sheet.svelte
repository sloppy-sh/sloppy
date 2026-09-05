<script lang="ts">
	// Choosing the picture under the graph — DESIGN.md § "The wallpaper".
	import Check from '@lucide/svelte/icons/check';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import type { HeldPicture, NoteMedia, ShownPicture } from '../editor/contract.js';
	import { tileSized } from '../editor/thumbnail.js';
	import ResponsiveModal from '../responsive-modal.svelte';

	/** A screenful of originals at once is how a phone loses the tab. */
	const AT_ONCE = 3;

	let {
		open = $bindable(false),
		media,
		choice,
		turns,
		onchange
	}: {
		open?: boolean;
		/** Pictures come from what the reader has already put in a note; this
		 *  surface adds none of its own. */
		media: Pick<NoteMedia, 'library' | 'picture'>;
		choice: {
			/** The pictures, in the order they take turns. Empty is no wallpaper. */
			uploads: string[];
			/** How much of the picture shows, 0–1 of what the ground can carry. */
			strength: number;
			/** Minutes a picture holds before the next takes its turn. */
			every: number;
		};
		/** The turns on offer, longest last. */
		turns: readonly { value: number; label: string }[];
		onchange: (next: typeof choice) => void;
	} = $props();

	let held = $state<HeldPicture[]>([]);
	let reading = $state(false);
	let unreadable = $state(false);
	let thumbnails = $state<Record<string, string>>({});

	let shown: Record<string, ShownPicture> = {};
	let tiles: { node: HTMLElement; picture: HeldPicture }[] = [];
	let grid: HTMLElement | null = null;
	let asked: string[] = [];
	let waiting: HeldPicture[] = [];
	let fetching = 0;
	let era = 0;

	const turnLabel = $derived(
		turns.find((turn) => turn.value === choice.every)?.label ?? turns[0].label
	);

	function forget(): void {
		era += 1;
		for (const picture of Object.values(shown)) picture.release();
		shown = {};
		thumbnails = {};
		asked = [];
		waiting = [];
	}

	$effect(() => {
		if (!open) return;
		let live = true;
		reading = true;
		unreadable = false;
		void media
			.library()
			.then((pictures) => {
				if (live) held = pictures;
			})
			.catch(() => {
				if (live) unreadable = true;
			})
			.finally(() => {
				if (live) reading = false;
			});
		return () => {
			live = false;
			forget();
		};
	});

	function want(picture: HeldPicture): void {
		if (asked.includes(picture.upload_id)) return;
		asked.push(picture.upload_id);
		waiting.push(picture);
	}

	function pump(): void {
		while (fetching < AT_ONCE && waiting.length > 0) {
			const picture = waiting.shift() as HeldPicture;
			const mine = era;
			fetching += 1;
			void media
				.picture(picture.upload_id)
				.then(tileSized)
				.then((drawn) => {
					if (mine !== era) {
						drawn.release();
						return;
					}
					shown[picture.upload_id] = drawn;
					thumbnails = { ...thumbnails, [picture.upload_id]: drawn.src };
				})
				// One that will not draw is simply not offered.
				.catch(() => undefined)
				.finally(() => {
					fetching -= 1;
					if (mine === era) pump();
				});
		}
	}

	function reach(): void {
		if (!grid) return;
		const box = grid.getBoundingClientRect();
		for (const { node, picture } of tiles) {
			const at = node.getBoundingClientRect();
			if (at.top - at.height <= box.bottom && at.bottom + at.height >= box.top) want(picture);
		}
		pump();
	}

	function scroller(node: HTMLElement) {
		grid = node;
		reach();
		return () => {
			if (grid === node) grid = null;
		};
	}

	function tile(picture: HeldPicture) {
		return (node: HTMLElement) => {
			tiles.push({ node, picture });
			reach();
			return () => {
				tiles = tiles.filter((one) => one.node !== node);
			};
		};
	}

	function toggle(upload: string): void {
		const uploads = choice.uploads.includes(upload)
			? choice.uploads.filter((one) => one !== upload)
			: [...choice.uploads, upload];
		onchange({ ...choice, uploads });
	}
</script>

<ResponsiveModal bind:open title="Picture" description="What the graph is drawn over.">
	<div
		class="space-y-5 px-4 pb-[max(1rem,var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))]"
	>
		<div class="space-y-2">
			{#if reading}
				<p class="py-6 text-center text-sm text-muted-foreground">Looking…</p>
			{:else if unreadable}
				<p class="py-6 text-center text-sm text-muted-foreground">
					Sloppy could not read your pictures just now. Try again in a moment.
				</p>
			{:else if held.length === 0}
				<p class="py-6 text-center text-sm text-muted-foreground">
					Pictures you add to a note can be used here.
				</p>
			{:else}
				<div
					class="grid max-h-[40vh] grid-cols-3 gap-2 overflow-y-auto scroll-fade-y [--scroll-fade:1rem] sm:grid-cols-4"
					onscroll={reach}
					{@attach scroller}
				>
					{#each held as picture (picture.upload_id)}
						{@const turn = choice.uploads.indexOf(picture.upload_id)}
						<button
							type="button"
							aria-label={picture.filename}
							aria-pressed={turn >= 0}
							onclick={() => toggle(picture.upload_id)}
							class="relative aspect-square overflow-hidden rounded-md border bg-muted transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none {turn >=
							0
								? 'border-primary'
								: 'hover:border-primary/50'}"
							{@attach tile(picture)}
						>
							{#if thumbnails[picture.upload_id]}
								<img
									src={thumbnails[picture.upload_id]}
									alt={picture.filename}
									class="size-full object-cover"
								/>
							{/if}
							{#if turn >= 0}
								<span
									class="absolute end-1 bottom-1 flex size-5 items-center justify-center rounded-full bg-primary text-[0.625rem] font-medium text-primary-foreground"
								>
									{#if choice.uploads.length > 1}
										{turn + 1}
									{:else}
										<Check class="size-3" />
									{/if}
								</span>
							{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>

		{#if choice.uploads.length > 0}
			<div class="space-y-2">
				<label class="text-sm" for="wallpaper-strength">How much shows</label>
				<input
					id="wallpaper-strength"
					type="range"
					min="0"
					max="100"
					step="5"
					value={Math.round(choice.strength * 100)}
					oninput={(event) =>
						onchange({ ...choice, strength: event.currentTarget.valueAsNumber / 100 })}
					class="h-11 w-full accent-primary"
				/>
			</div>

			{#if choice.uploads.length > 1}
				<div class="space-y-2">
					<span class="text-sm">Takes turns</span>
					<Select.Root
						type="single"
						value={String(choice.every)}
						onValueChange={(next: string) => onchange({ ...choice, every: Number(next) })}
					>
						<Select.Trigger class="h-11 w-full">{turnLabel}</Select.Trigger>
						<Select.Content>
							{#each turns as turn (turn.value)}
								<Select.Item value={String(turn.value)} class="min-h-11">
									{turn.label}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
					<p class="text-xs text-muted-foreground">
						The next one is up when you come back, never while you are reading.
					</p>
				</div>
			{/if}

			<Button
				variant="outline"
				class="h-11 w-full"
				onclick={() => onchange({ ...choice, uploads: [] })}
			>
				No picture
			</Button>
		{/if}
	</div>
</ResponsiveModal>
