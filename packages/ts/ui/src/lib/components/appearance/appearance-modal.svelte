<script lang="ts">
	// Giving a note a look. DESIGN.md § "A note's look never uses colour": every
	// channel offered here is shape or picture, so the hue on the canvas stays
	// the reader's own question.
	import ImagePlus from '@lucide/svelte/icons/image-plus';
	import { lookPicturePx } from '@sloppy/graph';
	import {
		isUnstyled,
		MARK_RADII,
		type NodeAppearance,
		PREVIEW_SIZES,
		resolveAppearance,
		RING_STYLES,
		RING_WEIGHTS
	} from '@sloppy/types';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { HeldPicture, NoteMedia, ShownPicture } from '../editor/contract.js';
	import { flattened } from '../editor/fit.js';
	import MediaPicker from '../editor/media-picker.svelte';
	import ResponsiveModal from '../responsive-modal.svelte';
	import {
		MARK_RADIUS_LABELS,
		PREVIEW_SIZE_LABELS,
		RING_STYLE_LABELS,
		RING_WEIGHT_LABELS
	} from './labels.js';
	import MarkSwatch from './mark-swatch.svelte';
	import { shownPicture } from './shown-picture.svelte.js';

	let {
		open = $bindable(false),
		onOpenChange,
		appearance = null,
		media,
		onchange,
		refused = null
	}: {
		open?: boolean;
		/** For the unbound `open={expr}` pattern; a bound `open` needs nothing. */
		onOpenChange?: (open: boolean) => void;
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
	const picture = shownPicture(
		() => media,
		() => (open ? shown?.preview : undefined)
	);

	interface Row {
		label: string;
		channel: keyof NodeAppearance;
		values: readonly string[];
		labels: Record<string, string>;
		on: string;
		disabled: boolean;
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
			disabled: look.ringWeight === 'none'
		},
		{
			label: 'Size',
			channel: 'mark_radius' as const,
			values: MARK_RADII as readonly string[],
			labels: MARK_RADIUS_LABELS as Record<string, string>,
			on: look.markRadius as string,
			disabled: false
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
	 * and a ring style says nothing with no ring — so a look that draws like an
	 * unstyled note is stored as one. A token this build has no renderer for is
	 * not one of those, and survives untouched.
	 */
	function tidied(next: NodeAppearance): NodeAppearance {
		const tidy = { ...next };
		if (tidy.ring_weight === unstyled.ringWeight) tidy.ring_weight = undefined;
		if (tidy.mark_radius === unstyled.markRadius) tidy.mark_radius = undefined;
		if (tidy.ring_weight === undefined || tidy.ring_style === unstyled.ringStyle) {
			tidy.ring_style = undefined;
		}
		if (tidy.preview === undefined || tidy.preview_size === unstyled.previewSize) {
			tidy.preview_size = undefined;
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

	function pick(channel: keyof NodeAppearance, value: string): Promise<void> {
		return set({ ...(shown ?? {}), [channel]: value });
	}

	/** A mark never draws a picture wider than the size its author chose shows,
	 *  so nothing wider is sent. */
	async function sent(file: File, side: number): Promise<string> {
		const asset = await media.send(await flattened(file, side), () => {}).asset;
		return asset.upload_id;
	}

	/**
	 * One already in the notes is held at the size a NOTE draws it, many times
	 * what a mark ever shows — so one too big for a mark is cut and sent, and
	 * anything else is re-used where it lies. `null` is both of those: already
	 * small enough, and bytes that would not read.
	 */
	async function cutForAMark(held: HeldPicture, side: number): Promise<File | null> {
		let source: ShownPicture | null = null;
		try {
			source = await media.picture(held.upload_id);
			const whole = new File([await (await fetch(source.src)).blob()], held.filename, {
				type: held.mime_type
			});
			const bytes = await flattened(whole, side);
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
			const side = lookPicturePx(look.markRadius, look.previewSize);
			let preview: string;
			if ('held' in choice) {
				const cut = await cutForAMark(choice.held, side);
				preview = cut === null ? choice.held.upload_id : await sent(cut, side);
			} else {
				preview = await sent(choice.file, side);
			}
			await set({ ...(shown ?? {}), preview });
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
		<legend class="mb-2 text-xs tracking-wide text-muted-foreground uppercase">
			{row.label}
		</legend>
		<div
			class="grid gap-2"
			style="grid-template-columns: repeat({row.values.length}, minmax(0, 1fr))"
		>
			{#each row.values as value (value)}
				<Button
					variant={row.on === value ? 'default' : 'outline'}
					class="h-11 min-w-0 px-2"
					aria-pressed={row.on === value}
					onclick={() => pick(row.channel, value)}
				>
					<span class="truncate">{row.labels[value]}</span>
				</Button>
			{/each}
		</div>
	</fieldset>
{/snippet}

<ResponsiveModal
	{open}
	onOpenChange={(v) => {
		open = v;
		onOpenChange?.(v);
	}}
	title="How this note looks"
	description="On the graph, wherever this note is drawn."
>
	<div
		class="space-y-6 px-4 pt-2 pb-[max(1rem,var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))]"
	>
		<div class="flex items-center justify-center rounded-xl border bg-muted/40 py-7">
			<MarkSwatch appearance={shown} picture={picture.src} size={76} />
		</div>

		{#each rows as row (row.channel)}
			{@render choices(row)}
		{/each}

		<div class="space-y-2">
			<p class="text-xs tracking-wide text-muted-foreground uppercase">Picture</p>
			<div class="flex flex-wrap gap-2">
				<Button
					variant="outline"
					class="h-11 flex-1 basis-40"
					disabled={sending}
					onclick={() => (choosing = true)}
				>
					<ImagePlus class="size-4" />
					{sending ? 'Adding…' : shown?.preview ? 'Change the picture' : 'Add a picture'}
				</Button>
				{#if shown?.preview}
					<Button
						variant="ghost"
						class="h-11 text-muted-foreground"
						disabled={sending}
						onclick={() => set({ ...(shown ?? {}), preview: undefined })}
					>
						Remove
					</Button>
				{/if}
			</div>
		</div>

		{#if shown?.preview}
			{@render choices(pictureSize)}
		{/if}

		{#if trouble}
			<p class="text-sm text-destructive" role="alert">{trouble}</p>
		{/if}

		{#if !isUnstyled(shown)}
			<Button variant="ghost" class="h-11 w-full text-muted-foreground" onclick={() => set({})}>
				Leave it plain
			</Button>
		{/if}
	</div>
</ResponsiveModal>

<MediaPicker bind:open={choosing} {media} onpick={take} />
