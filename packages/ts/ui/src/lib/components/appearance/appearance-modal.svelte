<script lang="ts">
	// Giving a note a look. DESIGN.md § "A note's look never uses colour": every
	// channel offered here is shape or picture, so the hue on the canvas stays
	// the reader's own question.
	import ImagePlus from '@lucide/svelte/icons/image-plus';
	import { MARK_PICTURE_PX } from '@sloppy/graph';
	import {
		isUnstyled,
		MARK_RADII,
		type NodeAppearance,
		resolveAppearance,
		RING_STYLES,
		RING_WEIGHTS
	} from '@sloppy/types';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { HeldPicture, NoteMedia } from '../editor/contract.js';
	import { fitted } from '../editor/fit.js';
	import MediaPicker from '../editor/media-picker.svelte';
	import ResponsiveModal from '../responsive-modal.svelte';
	import { MARK_RADIUS_LABELS, RING_STYLE_LABELS, RING_WEIGHT_LABELS } from './labels.js';
	import MarkSwatch from './mark-swatch.svelte';

	let {
		open = $bindable(false),
		onOpenChange,
		appearance = null,
		picture = null,
		media,
		onchange,
		refused = null
	}: {
		open?: boolean;
		/** For the unbound `open={expr}` pattern; a bound `open` needs nothing. */
		onOpenChange?: (open: boolean) => void;
		appearance?: NodeAppearance | null;
		/** The note's picture, already resolved for an `<img>`. */
		picture?: string | null;
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

	const rows = $derived([
		{
			label: 'Ring',
			channel: 'ring_weight' as const,
			values: RING_WEIGHTS as readonly string[],
			labels: RING_WEIGHT_LABELS as Record<string, string>,
			on: look.ringWeight as string,
			plain: unstyled.ringWeight as string,
			disabled: false
		},
		{
			label: 'Ring style',
			channel: 'ring_style' as const,
			values: RING_STYLES as readonly string[],
			labels: RING_STYLE_LABELS as Record<string, string>,
			on: look.ringStyle as string,
			plain: unstyled.ringStyle as string,
			disabled: look.ringWeight === 'none'
		},
		{
			label: 'Size',
			channel: 'mark_radius' as const,
			values: MARK_RADII as readonly string[],
			labels: MARK_RADIUS_LABELS as Record<string, string>,
			on: look.markRadius as string,
			plain: unstyled.markRadius as string,
			disabled: false
		}
	]);

	async function set(next: NodeAppearance): Promise<void> {
		const mine = ++asked;
		const whole = isUnstyled(next) ? null : next;
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

	/** The value a mark draws with nothing set is stored as nothing set, so a
	 *  look that says nothing is never a look. */
	function pick(channel: keyof NodeAppearance, value: string, plain: string): Promise<void> {
		const next = { ...(shown ?? {}), [channel]: value === plain ? undefined : value };
		if (next.ring_weight === undefined) next.ring_style = undefined;
		return set(next);
	}

	async function take(choice: { file: File } | { held: HeldPicture }): Promise<void> {
		if (sending) return;
		trouble = null;
		if ('held' in choice) {
			await set({ ...(shown ?? {}), preview: choice.held.upload_id });
			return;
		}
		sending = true;
		try {
			// A mark never draws a picture wider than this, so nothing wider is sent.
			const bytes = await fitted(choice.file, MARK_PICTURE_PX);
			const asset = await media.send(bytes, () => {}).asset;
			await set({ ...(shown ?? {}), preview: asset.upload_id });
		} catch (error) {
			trouble =
				(error instanceof Error && error.message) ||
				'That picture could not be added. Try again in a moment.';
		} finally {
			sending = false;
		}
	}
</script>

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
			<MarkSwatch appearance={shown} {picture} size={76} />
		</div>

		{#each rows as row (row.channel)}
			<fieldset disabled={row.disabled} class="space-y-2 disabled:opacity-50">
				<legend class="mb-2 text-xs tracking-wide text-muted-foreground uppercase">
					{row.label}
				</legend>
				<div class="flex flex-wrap gap-2">
					{#each row.values as value (value)}
						<Button
							variant={row.on === value ? 'default' : 'outline'}
							class="h-11 flex-1 basis-20"
							aria-pressed={row.on === value}
							onclick={() => pick(row.channel, value, row.plain)}
						>
							{row.labels[value]}
						</Button>
					{/each}
				</div>
			</fieldset>
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
