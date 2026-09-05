<script lang="ts">
	// Giving a note a look. DESIGN.md § "A note's look never uses colour": every
	// channel offered here is shape or picture, so the hue on the canvas stays
	// the reader's own question.
	import ImagePlus from '@lucide/svelte/icons/image-plus';
	import X from '@lucide/svelte/icons/x';
	import { MARK_PICTURE_PX } from '@sloppy/graph';
	import {
		isUnstyled,
		MARK_RADII,
		type NodeAppearance,
		type PictureTransition,
		pictureTurn,
		PICTURES_PER_SERIES,
		PREVIEW_SIZES,
		resolveAppearance,
		RING_STYLES,
		RING_WEIGHTS,
		seriesChannels
	} from '@sloppy/types';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { HeldPicture, NoteMedia, ShownPicture } from '../editor/contract.js';
	import { flattened } from '../editor/fit.js';
	import MediaPicker from '../editor/media-picker.svelte';
	import SeriesControls from '../picture/series-controls.svelte';
	import {
		MARK_RADIUS_LABELS,
		PREVIEW_SIZE_LABELS,
		RING_STYLE_LABELS,
		RING_WEIGHT_LABELS
	} from './labels.js';
	import MarkSwatch from './mark-swatch.svelte';
	import { shownPictures } from './shown-pictures.svelte.js';

	let {
		appearance = null,
		media,
		onchange,
		refused = null
	}: {
		appearance?: NodeAppearance | null;
		media: NoteMedia;
		/** The WHOLE look, or null for a note left plain. Rejecting puts the
		 *  choices back as they were, so throw rather than swallow. */
		onchange: (appearance: NodeAppearance | null) => Promise<void> | void;
		/** What to say when {@link onchange} rejected without words of its own. */
		refused?: string | null;
	} = $props();

	/** What the reader asked for, while it is on its way to the server. */
	let pending = $state<NodeAppearance | null | undefined>(undefined);
	let trouble = $state<string | null>(null);
	let choosing = $state(false);
	let sending = $state(false);
	let asked = 0;

	const shown = $derived(pending === undefined ? appearance : pending);
	const look = $derived(resolveAppearance(shown));
	const unstyled = resolveAppearance(null);
	const series = $derived(look.preview.pictures);
	const pictures = shownPictures(
		() => media,
		() => series
	);

	/** Which one the mark is wearing right now, read off the clock the way the
	 *  canvas reads it. */
	const opened = Date.now();
	const upNow = $derived(pictures.of(pictureTurn(look.preview, opened)));

	interface Row {
		label: string;
		channel: keyof NodeAppearance;
		values: readonly string[];
		labels: Record<string, string>;
		on: string;
		disabled: boolean;
		/** What choosing along this row gets somebody, where the row alone does
		 *  not say it. */
		says?: string;
	}

	const rows: Row[] = $derived([
		{
			label: 'Ring',
			channel: 'ring_weight' as const,
			values: RING_WEIGHTS as readonly string[],
			labels: RING_WEIGHT_LABELS as Record<string, string>,
			on: look.ringWeight as string,
			disabled: false
		},
		{
			label: 'Ring style',
			channel: 'ring_style' as const,
			values: RING_STYLES as readonly string[],
			labels: RING_STYLE_LABELS as Record<string, string>,
			on: look.ringStyle as string,
			disabled: look.ringWeight === 'none',
			says: 'A dashed ring reads as a draft.'
		},
		{
			label: 'Size',
			channel: 'mark_radius' as const,
			values: MARK_RADII as readonly string[],
			labels: MARK_RADIUS_LABELS as Record<string, string>,
			on: look.markRadius as string,
			disabled: false,
			says: 'Yours, on top of however much is folded into the note.'
		}
	]);

	const pictureSize: Row = $derived({
		label: 'Picture size',
		channel: 'preview_size',
		values: PREVIEW_SIZES,
		labels: PREVIEW_SIZE_LABELS,
		on: look.previewSize,
		disabled: false
	});

	/**
	 * A channel saying what a plain note already draws is stored as nothing set,
	 * and one that says nothing at all — a ring style with no ring, a cadence for
	 * a picture that never changes — is stored as nothing either. So a look that
	 * draws like an unstyled note is stored as one. A token this build has no
	 * renderer for is not one of those, and survives untouched.
	 */
	function tidied(next: NodeAppearance): NodeAppearance {
		const tidy = { ...next };
		if (tidy.ring_weight === unstyled.ringWeight) tidy.ring_weight = undefined;
		if (tidy.mark_radius === unstyled.markRadius) tidy.mark_radius = undefined;
		if (tidy.ring_weight === undefined || tidy.ring_style === unstyled.ringStyle) {
			tidy.ring_style = undefined;
		}
		if (tidy.preview === undefined || (tidy.preview_more ?? []).length === 0) {
			tidy.preview_more = undefined;
		}
		if (tidy.preview === undefined || tidy.preview_size === unstyled.previewSize) {
			tidy.preview_size = undefined;
		}
		const still = tidy.preview === undefined || tidy.preview_more === undefined;
		if (still || tidy.preview_every === unstyled.preview.every) tidy.preview_every = undefined;
		if (still || tidy.preview_transition === unstyled.preview.transition) {
			tidy.preview_transition = undefined;
		}
		return tidy;
	}

	async function set(next: NodeAppearance): Promise<void> {
		const mine = ++asked;
		const tidy = tidied(next);
		const whole = isUnstyled(tidy) ? null : tidy;
		pending = whole;
		trouble = null;
		try {
			await onchange(whole);
		} catch {
			trouble = refused ?? 'Sloppy could not save that. Try again in a moment.';
		} finally {
			// A second choice made while this one was in flight owns the mark now.
			if (mine === asked) pending = undefined;
		}
	}

	function pick(channel: keyof NodeAppearance, value: string | number): Promise<void> {
		return set({ ...(shown ?? {}), [channel]: value });
	}

	function keeps(pictures: readonly string[]): Promise<void> {
		return set({ ...(shown ?? {}), ...seriesChannels(pictures) });
	}

	/** A mark never draws a picture wider than this, so nothing wider is sent. */
	async function sent(file: File): Promise<string> {
		const asset = await media.send(await flattened(file, MARK_PICTURE_PX), () => {}).asset;
		return asset.upload_id;
	}

	/**
	 * One already in the notes is held at the size a NOTE draws it, many times
	 * what a mark ever shows — so one too big for a mark is cut and sent, and
	 * anything else is re-used where it lies. `null` is both of those: already
	 * small enough, and bytes that would not read.
	 */
	async function cutForAMark(held: HeldPicture): Promise<File | null> {
		let source: ShownPicture | null = null;
		try {
			source = await media.picture(held.upload_id);
			const whole = new File([await (await fetch(source.src)).blob()], held.filename, {
				type: held.mime_type
			});
			const bytes = await flattened(whole, MARK_PICTURE_PX);
			return bytes === whole ? null : bytes;
		} catch {
			return null;
		} finally {
			source?.release();
		}
	}

	async function take(choice: { file: File } | { held: HeldPicture }): Promise<void> {
		if (sending) return;
		trouble = null;
		sending = true;
		try {
			let picture: string;
			if ('held' in choice) {
				const cut = await cutForAMark(choice.held);
				picture = cut === null ? choice.held.upload_id : await sent(cut);
			} else {
				picture = await sent(choice.file);
			}
			await keeps([...series, picture]);
		} catch (error) {
			trouble =
				(error instanceof Error && error.message) ||
				'That picture could not be added. Try again in a moment.';
		} finally {
			sending = false;
		}
	}
</script>

{#snippet choices(row: Row)}
	<fieldset disabled={row.disabled} class="space-y-2 disabled:opacity-50">
		<legend class="mb-2 text-sm font-medium">{row.label}</legend>
		<div class="flex flex-wrap gap-2">
			{#each row.values as value (value)}
				<Button
					variant={row.on === value ? 'default' : 'outline'}
					class="h-11 min-w-0 rounded-full"
					aria-pressed={row.on === value}
					onclick={() => pick(row.channel, value)}
				>
					<span class="truncate">{row.labels[value]}</span>
				</Button>
			{/each}
		</div>
		{#if row.says}<p class="text-xs text-muted-foreground">{row.says}</p>{/if}
	</fieldset>
{/snippet}

<div class="space-y-6">
	<div class="flex items-center justify-center rounded-xl border bg-muted/40 py-7">
		<MarkSwatch appearance={shown} picture={upNow} size={96} />
	</div>

	{#each rows as row (row.channel)}
		{@render choices(row)}
	{/each}

	<div class="space-y-2">
		<p class="text-sm font-medium">Pictures</p>
		{#if series.length > 0}
			<ul class="flex flex-wrap gap-2">
				{#each series as picture, turn (`${turn}:${picture}`)}
					{@const src = pictures.of(picture)}
					<li>
						<button
							type="button"
							aria-label="Take picture {turn + 1} off"
							onclick={() => keeps(series.filter((_, at) => at !== turn))}
							class="relative size-18 overflow-hidden rounded-md border bg-muted transition-colors duration-150 ease-out hover:border-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
						>
							{#if src}
								<img {src} alt="" class="size-full object-cover" />
							{/if}
							<span
								class="absolute end-1 top-1 flex size-5 items-center justify-center rounded-full bg-background/85 text-muted-foreground"
							>
								<X class="size-3" />
							</span>
							{#if series.length > 1}
								<span
									class="absolute end-1 bottom-1 flex size-5 items-center justify-center rounded-full bg-primary text-[0.625rem] font-medium text-primary-foreground"
								>
									{turn + 1}
								</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		{#if series.length < PICTURES_PER_SERIES}
			<Button
				variant="outline"
				class="h-11 w-full"
				disabled={sending}
				onclick={() => (choosing = true)}
			>
				<ImagePlus class="size-4" />
				{sending ? 'Adding…' : 'Add a picture'}
			</Button>
		{:else}
			<p class="text-xs text-muted-foreground">
				That is as many pictures as one note takes turns with.
			</p>
		{/if}
	</div>

	{#if series.length > 0}
		{@render choices(pictureSize)}
	{/if}

	<SeriesControls
		count={series.length}
		every={look.preview.every}
		transition={look.preview.transition}
		onevery={(minutes: number) => pick('preview_every', minutes)}
		ontransition={(next: PictureTransition) => pick('preview_transition', next)}
	/>

	{#if trouble}
		<p class="text-sm text-destructive" role="alert">{trouble}</p>
	{/if}

	{#if !isUnstyled(shown)}
		<Button variant="ghost" class="h-11 w-full text-muted-foreground" onclick={() => set({})}>
			Leave it plain
		</Button>
	{/if}
</div>

<MediaPicker bind:open={choosing} {media} onpick={take} />
