<script lang="ts">
	// Choosing the picture under the graph — DESIGN.md § "The wallpaper", and
	// § "A picture that takes turns" for everything it shares with a mark's.
	import Check from '@lucide/svelte/icons/check';
	import ImagePlus from '@lucide/svelte/icons/image-plus';
	import X from '@lucide/svelte/icons/x';
	import type { PictureSeries, PictureTransition } from '@sloppy/types';
	import { Button } from '$lib/components/ui/button/index.js';
	import { refusedWith } from '$lib/refusal.js';
	import ConfirmModal from '../confirm/confirm-modal.svelte';
	import type { HeldPicture, NoteMedia, ShownPicture } from '../editor/contract.js';
	import { fitted, NOTE_PX } from '../editor/fit.js';
	import MediaPicker from '../editor/media-picker.svelte';
	import { tileSized } from '../editor/thumbnail.js';
	import SeriesControls from '../picture/series-controls.svelte';
	import ResponsiveModal from '../responsive-modal.svelte';

	/** A screenful of originals at once is how a phone loses the tab. */
	const AT_ONCE = 3;

	let {
		open = $bindable(false),
		media,
		choice,
		onchange
	}: {
		open?: boolean;
		media: NoteMedia;
		choice: PictureSeries & {
			/** How much of the picture shows, 0–1 of what the ground can carry. */
			strength: number;
		};
		onchange: (next: typeof choice) => void;
	} = $props();

	let held = $state<HeldPicture[]>([]);
	let reading = $state(false);
	let unreadable = $state(false);
	let thumbnails = $state<Record<string, string>>({});
	let choosing = $state(false);
	let sending = $state(false);
	let trouble = $state<string | null>(null);
	let editing = $state(false);
	let dropping = $state<HeldPicture | null>(null);
	let confirming = $state(false);
	let refused = $state<string | null>(null);

	let shown: Record<string, ShownPicture> = {};
	let tiles: { node: HTMLElement; picture: HeldPicture }[] = [];
	let grid: HTMLElement | null = null;
	let asked: string[] = [];
	let waiting: HeldPicture[] = [];
	let fetching = 0;
	let era = 0;

	function forget(): void {
		era += 1;
		for (const picture of Object.values(shown)) picture.release();
		shown = {};
		thumbnails = {};
		asked = [];
		waiting = [];
		editing = false;
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

	function toggle(picture: string): void {
		const pictures = choice.pictures.includes(picture)
			? choice.pictures.filter((one) => one !== picture)
			: [...choice.pictures, picture];
		onchange({ ...choice, pictures });
	}

	/** Straight into the turn it was added for: somebody who went looking for a
	 *  picture came here to put it behind their graph. */
	async function take(picked: { file: File } | { held: HeldPicture }): Promise<void> {
		if (sending) return;
		trouble = null;
		sending = true;
		try {
			if ('held' in picked) {
				if (!choice.pictures.includes(picked.held.upload_id)) toggle(picked.held.upload_id);
				return;
			}
			const asset = await media.send(await fitted(picked.file, NOTE_PX), () => {}).asset;
			toggle(asset.upload_id);
			// The picture is already behind the graph; a grid that would not read
			// again is no reason to say it failed.
			held = await media.library().catch(() => held);
		} catch (error) {
			trouble = refusedWith(error, 'That picture could not be added. Try again in a moment.');
		} finally {
			sending = false;
		}
	}

	/** Out of the person's own store, so a ground still on it goes too. */
	async function drop(): Promise<void> {
		const picture = dropping;
		if (!picture) return;
		refused = null;
		try {
			await media.remove(picture.upload_id);
		} catch (error) {
			refused = refusedWith(error, 'That picture could not be removed. Try again in a moment.');
			throw error;
		}
		held = held.filter((one) => one.upload_id !== picture.upload_id);
		shown[picture.upload_id]?.release();
		delete shown[picture.upload_id];
		thumbnails = Object.fromEntries(
			Object.entries(thumbnails).filter(([id]) => id !== picture.upload_id)
		);
		asked = asked.filter((id) => id !== picture.upload_id);
		waiting = waiting.filter((one) => one.upload_id !== picture.upload_id);
		if (choice.pictures.includes(picture.upload_id)) {
			onchange({
				...choice,
				pictures: choice.pictures.filter((one) => one !== picture.upload_id)
			});
		}
		dropping = null;
		if (held.length === 0) editing = false;
	}
</script>

<ResponsiveModal bind:open title="Picture" description="What the graph is drawn over.">
	<div
		class="space-y-5 px-4 pb-[max(1rem,var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))]"
	>
		<div class="space-y-2">
			{#if held.length > 0 && !reading && !unreadable}
				<div class="flex items-baseline justify-between gap-3">
					<p class="text-xs tracking-wide text-muted-foreground uppercase">Your pictures</p>
					<button
						type="button"
						class="text-xs text-muted-foreground hover:text-foreground"
						onclick={() => (editing = !editing)}
					>
						{editing ? 'Done' : 'Edit'}
					</button>
				</div>
			{/if}
			{#if reading}
				<p class="py-6 text-center text-sm text-muted-foreground">Looking…</p>
			{:else if unreadable}
				<p class="py-6 text-center text-sm text-muted-foreground">
					Sloppy could not read your pictures just now. Try again in a moment.
				</p>
			{:else if held.length === 0}
				<p class="py-6 text-center text-sm text-muted-foreground">
					Choose a picture, or use one you have already put in a note.
				</p>
			{:else}
				<div
					class="grid max-h-[40vh] grid-cols-3 gap-2 overflow-y-auto scroll-fade-y [--scroll-fade:1rem] sm:grid-cols-4"
					onscroll={reach}
					{@attach scroller}
				>
					{#each held as picture (picture.upload_id)}
						{@const turn = choice.pictures.indexOf(picture.upload_id)}
						<button
							type="button"
							aria-label={editing ? `Remove ${picture.filename}` : picture.filename}
							aria-pressed={editing ? undefined : turn >= 0}
							onclick={() => {
								if (editing) {
									dropping = picture;
									refused = null;
									confirming = true;
									return;
								}
								toggle(picture.upload_id);
							}}
							class="relative aspect-square overflow-hidden rounded-md border bg-muted transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none {editing
								? 'hover:border-destructive'
								: turn >= 0
									? 'border-primary'
									: 'hover:border-primary/50'}"
							{@attach tile(picture)}
						>
							{#if thumbnails[picture.upload_id]}
								<img
									src={thumbnails[picture.upload_id]}
									alt={picture.filename}
									class="size-full object-cover {editing ? 'opacity-60' : ''}"
								/>
							{/if}
							{#if editing}
								<span
									class="absolute end-1 top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
								>
									<X class="size-3" />
								</span>
							{:else if turn >= 0}
								<span
									class="absolute end-1 bottom-1 flex size-5 items-center justify-center rounded-full bg-primary text-[0.625rem] font-medium text-primary-foreground"
								>
									{#if choice.pictures.length > 1}
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

			<Button
				variant="outline"
				class="h-control w-full"
				disabled={sending}
				onclick={() => (choosing = true)}
			>
				<ImagePlus class="size-4" />
				{sending ? 'Adding…' : 'Choose a picture'}
			</Button>

			{#if trouble}
				<p class="text-sm text-destructive" role="alert">{trouble}</p>
			{/if}
		</div>

		{#if choice.pictures.length > 0}
			<div class="space-y-2">
				<label class="text-sm font-medium" for="wallpaper-strength">How much shows</label>
				<input
					id="wallpaper-strength"
					type="range"
					min="0"
					max="100"
					step="5"
					value={Math.round(choice.strength * 100)}
					oninput={(event) =>
						onchange({ ...choice, strength: event.currentTarget.valueAsNumber / 100 })}
					class="h-control w-full accent-primary"
				/>
			</div>

			<SeriesControls
				count={choice.pictures.length}
				every={choice.every}
				transition={choice.transition}
				onevery={(minutes: number) => onchange({ ...choice, every: minutes })}
				ontransition={(next: PictureTransition) => onchange({ ...choice, transition: next })}
			/>

			<Button
				variant="outline"
				class="h-control w-full"
				onclick={() => onchange({ ...choice, pictures: [] })}
			>
				No picture
			</Button>
		{/if}
	</div>
</ResponsiveModal>

<MediaPicker
	bind:open={choosing}
	{media}
	title="From your device"
	description="It goes behind the graph."
	offersHeld={false}
	onpick={(picked) => void take(picked)}
/>

<ConfirmModal
	bind:open={confirming}
	title="Remove this picture?"
	description="It goes from behind your graphs, and any note showing it stops showing it. If you published a note with it, that copy stays until you take the branch down."
	confirmLabel="Remove"
	{refused}
	onconfirm={drop}
/>
