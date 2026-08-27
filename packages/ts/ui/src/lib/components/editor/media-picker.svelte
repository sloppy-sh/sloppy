<script lang="ts">
	// Getting a picture into a note: one chosen from the device, or one already
	// in the person's own store. `./contract.ts` says what either half is handed.
	import ImagePlus from '@lucide/svelte/icons/image-plus';
	import ResponsiveModal from '../responsive-modal.svelte';
	import type { HeldPicture, NoteMedia, ShownPicture } from './contract.js';

	const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';

	let {
		open = $bindable(false),
		media,
		onpick
	}: {
		open?: boolean;
		media: NoteMedia;
		onpick: (choice: { file: File } | { held: HeldPicture }) => void;
	} = $props();

	let chooser = $state<HTMLInputElement | null>(null);
	let over = $state(false);
	let held = $state<HeldPicture[]>([]);
	let reading = $state(false);
	let unreadable = $state(false);
	let thumbnails = $state<Record<string, string>>({});

	/** What each thumbnail holds, by the upload it is of. */
	let shown: Record<string, ShownPicture> = {};

	function forget(): void {
		for (const picture of Object.values(shown)) picture.release();
		shown = {};
		thumbnails = {};
	}

	$effect(() => {
		if (!open) return;
		let live = true;
		reading = true;
		unreadable = false;
		void media
			.library()
			.then((pictures) => {
				if (!live) return;
				held = pictures;
				for (const picture of pictures) void thumbnail(picture, () => live);
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

	async function thumbnail(picture: HeldPicture, live: () => boolean): Promise<void> {
		try {
			const drawn = await media.picture(picture.upload_id);
			if (!live()) {
				drawn.release();
				return;
			}
			shown[picture.upload_id] = drawn;
			thumbnails = { ...thumbnails, [picture.upload_id]: drawn.src };
		} catch {
			// One that will not draw is simply not offered.
		}
	}

	function take(file: File | null | undefined): void {
		if (!file) return;
		onpick({ file });
		open = false;
	}

	function dropped(event: DragEvent): void {
		event.preventDefault();
		over = false;
		take(event.dataTransfer?.files?.[0]);
	}
</script>

<ResponsiveModal bind:open title="Picture" description="Add one to this note.">
	<div
		class="space-y-4 px-4 pb-[max(1rem,var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))]"
	>
		<input
			bind:this={chooser}
			type="file"
			accept={ACCEPT}
			class="sr-only"
			onchange={(event) => {
				const input = event.currentTarget;
				take(input.files?.[0]);
				input.value = '';
			}}
		/>

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			ondragover={(event) => {
				event.preventDefault();
				over = true;
			}}
			ondragleave={() => (over = false)}
			ondrop={dropped}
		>
			<button
				type="button"
				onclick={() => chooser?.click()}
				class="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-colors duration-150 ease-out hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none {over
					? 'border-primary bg-primary/5'
					: 'border-border'}"
			>
				<ImagePlus class="size-6 text-muted-foreground" />
				<span class="text-sm font-medium">Choose a picture</span>
				<span class="hidden text-xs text-muted-foreground sm:block">or drop one here</span>
			</button>
		</div>

		<div class="space-y-2">
			<p class="text-xs tracking-wide text-muted-foreground uppercase">Already in your notes</p>
			{#if reading}
				<p class="py-6 text-center text-sm text-muted-foreground">Looking…</p>
			{:else if unreadable}
				<p class="py-6 text-center text-sm text-muted-foreground">
					Sloppy could not read these just now. Try again in a moment.
				</p>
			{:else if held.length === 0}
				<p class="py-6 text-center text-sm text-muted-foreground">
					Pictures you add to a note show up here.
				</p>
			{:else}
				<div
					class="grid max-h-[40vh] grid-cols-3 gap-2 overflow-y-auto scroll-fade-y [--scroll-fade:1rem] sm:grid-cols-4"
				>
					{#each held as picture (picture.upload_id)}
						<button
							type="button"
							title={picture.filename}
							aria-label={picture.filename}
							onclick={() => {
								onpick({ held: picture });
								open = false;
							}}
							class="aspect-square overflow-hidden rounded-md border bg-muted transition-colors duration-150 ease-out hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
						>
							{#if thumbnails[picture.upload_id]}
								<img
									src={thumbnails[picture.upload_id]}
									alt={picture.filename}
									class="size-full object-cover"
								/>
							{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</ResponsiveModal>
