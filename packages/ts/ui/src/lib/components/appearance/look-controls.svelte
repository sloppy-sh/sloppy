<script lang="ts">
	// Giving a note a look. DESIGN.md § "A note's look never uses colour": every
	// channel offered here is shape or picture, so the hue on the canvas stays
	// the reader's own question.
	import ImagePlus from '@lucide/svelte/icons/image-plus';
	import X from '@lucide/svelte/icons/x';
	import { MARK_PICTURE_PX } from '@sloppy/graph';
	import {
		isUnstyled,
		MARK_RADIUS_SCALE,
		MARK_SCALE_MAX,
		MARK_SCALE_MIN,
		type NodeAppearance,
		type PictureTransition,
		pictureTurn,
		PICTURES_PER_SERIES,
		PREVIEW_COVER_MAX,
		PREVIEW_COVER_MIN,
		PREVIEW_SIZE_COVER,
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
	import { RING_STYLE_LABELS, RING_WEIGHT_LABELS } from './labels.js';
	import LookSlider from './look-slider.svelte';
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
	/** What a slider is under a thumb that has not been let go, so the swatch
	 *  follows the drag and only the release is saved. */
	let dragged = $state<NodeAppearance | null>(null);
	let trouble = $state<string | null>(null);
	let choosing = $state(false);
	let sending = $state(false);
	let asked = 0;

	const saved = $derived(pending === undefined ? appearance : pending);
	const shown = $derived(dragged === null ? saved : { ...(saved ?? {}), ...dragged });
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
		key: string;
		values: readonly string[];
		labels: Record<string, string>;
		/** Empty where nothing is chosen, which is a style with no ring to break. */
		on: string;
		choose: (value: string) => Promise<void>;
		/** What choosing along this row gets somebody, where the row alone does
		 *  not say it. */
		says?: string;
	}

	const rows: Row[] = $derived([
		{
			label: 'Ring',
			key: 'ring_weight',
			values: RING_WEIGHTS as readonly string[],
			labels: RING_WEIGHT_LABELS as Record<string, string>,
			on: look.ringWeight as string,
			choose: (value) => pick('ring_weight', value)
		},
		{
			label: 'Ring style',
			key: 'ring_style',
			values: RING_STYLES as readonly string[],
			labels: RING_STYLE_LABELS as Record<string, string>,
			on: look.ringWeight === 'none' ? '' : (look.ringStyle as string),
			choose: breaks,
			says: 'A broken ring reads as a draft.'
		}
	]);

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
		if (tidy.ring_weight === undefined || tidy.ring_style === unstyled.ringStyle) {
			tidy.ring_style = undefined;
		}
		if (tidy.mark_scale === unstyled.markScale) tidy.mark_scale = undefined;
		if (stepped(MARK_RADIUS_SCALE, tidy.mark_radius) === unstyled.markScale) {
			tidy.mark_radius = undefined;
		}
		if (tidy.preview === undefined || (tidy.preview_more ?? []).length === 0) {
			tidy.preview_more = undefined;
		}
		if (tidy.preview === undefined || tidy.preview_cover === unstyled.previewCover) {
			tidy.preview_cover = undefined;
		}
		if (
			tidy.preview === undefined ||
			stepped(PREVIEW_SIZE_COVER, tidy.preview_size) === unstyled.previewCover
		) {
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

	/** The whole look goes back on every choice, so the channels with a bound go
	 *  back as this build read them — a series past eight or a cadence past a week
	 *  is more than a request carries. Tokens have no bound, and one this build
	 *  cannot draw passes through untouched. */
	const editable = $derived({
		...(shown ?? {}),
		...seriesChannels(series),
		preview_every: look.preview.every
	});

	function pick(channel: keyof NodeAppearance, value: string | number): Promise<void> {
		return set({ ...editable, [channel]: value });
	}

	/** What a step is worth, or nothing for one this build cannot draw. */
	function stepped(ladder: Record<string, number>, step: string | undefined): number | undefined {
		return step !== undefined && Object.hasOwn(ladder, step) ? ladder[step] : undefined;
	}

	/** A style says nothing with no ring to break, so choosing one gives the
	 *  note a ring to see it on. */
	function breaks(style: string): Promise<void> {
		return set({
			...editable,
			ring_style: style,
			ring_weight: look.ringWeight === 'none' ? 'regular' : editable.ring_weight
		});
	}

	/** The step a number says finely goes with it, so a look never stores the
	 *  same channel twice. */
	function sized(mark_scale: number): NodeAppearance {
		return { ...editable, mark_scale, mark_radius: undefined };
	}

	function covers(preview_cover: number): NodeAppearance {
		return { ...editable, preview_cover, preview_size: undefined };
	}

	function letGo(next: NodeAppearance): Promise<void> {
		dragged = null;
		return set(next);
	}

	function keeps(pictures: readonly string[]): Promise<void> {
		return set({ ...editable, ...seriesChannels(pictures) });
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
	<fieldset class="space-y-2">
		<legend class="mb-2 text-sm font-medium">{row.label}</legend>
		<div class="flex flex-wrap gap-2">
			{#each row.values as value (value)}
				<Button
					variant={row.on === value ? 'default' : 'outline'}
					class="h-11 min-w-0 rounded-full"
					aria-pressed={row.on === value}
					onclick={() => row.choose(value)}
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

	{#each rows as row (row.key)}
		{@render choices(row)}
	{/each}

	<LookSlider
		label="Size"
		says="Yours, on top of however much is folded into the note."
		value={look.markScale}
		min={MARK_SCALE_MIN}
		max={MARK_SCALE_MAX}
		step={0.01}
		ondrag={(next) => (dragged = { mark_scale: next, mark_radius: undefined })}
		onchange={(next) => letGo(sized(next))}
	/>

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
		<LookSlider
			label="How much it covers"
			says="All the way covers the ring, which is a look of its own."
			value={look.previewCover}
			min={PREVIEW_COVER_MIN}
			max={PREVIEW_COVER_MAX}
			step={0.0025}
			ondrag={(next) => (dragged = { preview_cover: next, preview_size: undefined })}
			onchange={(next) => letGo(covers(next))}
		/>
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
