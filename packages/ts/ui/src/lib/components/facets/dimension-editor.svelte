<script lang="ts">
	// Declaring a dimension and the values it may take. DESIGN.md § Hue is why a
	// dimension may pin a hue and why there are exactly eight to pin.
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import { FACET_SLOT_COUNT, type FacetSlot, type LabelDimensionView } from '@sloppy/types';
	import { untrack } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { cn } from '$lib/utils.js';
	import ResponsiveModal from '../responsive-modal.svelte';
	import type { DimensionDraft, EditedValue } from './contract.js';

	let {
		open = $bindable(false),
		dimension,
		onsave,
		refused = null
	}: {
		open?: boolean;
		/** Absent declares a new dimension. */
		dimension?: LabelDimensionView;
		/** Rejecting leaves the editor up, so the same button tries again. */
		onsave: (draft: DimensionDraft) => Promise<void>;
		/** The server's own words for a save that did not land, where it gave any. */
		refused?: string | null;
	} = $props();

	const SLOTS = Array.from({ length: FACET_SLOT_COUNT }, (_, i) => (i + 1) as FacetSlot);

	let name = $state('');
	let values = $state<EditedValue[]>([]);
	let slot = $state<FacetSlot | undefined>(undefined);
	let saving = $state(false);
	let seeded = $state(false);
	let rows = $state<HTMLElement[]>([]);
	let focusAt = $state<number | null>(null);

	const group = $props.id();
	const naming = $derived(dimension?.name ?? 'this dimension');
	const ready = $derived(name.trim().length > 0 && !saving);
	// An absent field on a PATCH means "leave this alone", so a pinned hue has no
	// way to say "go back to none" and the option is not offered as one that works.
	const unpinnable = $derived(dimension?.color_slot === undefined);

	$effect(() => {
		if (!open) {
			seeded = false;
			return;
		}
		if (seeded) return;
		seeded = true;
		untrack(() => {
			name = dimension?.name ?? '';
			values = (dimension?.values ?? []).map((value) => ({ was: value, now: value }));
			slot = dimension?.color_slot;
		});
	});

	$effect(() => {
		if (focusAt === null) return;
		rows[focusAt]?.querySelector('input')?.focus();
		focusAt = null;
	});

	function addValue(): void {
		values = [...values, { now: '' }];
		focusAt = values.length - 1;
	}

	async function save(): Promise<void> {
		saving = true;
		try {
			await onsave({ name: name.trim(), values, color_slot: slot });
			open = false;
		} catch {
			// Left up so the same button tries again; `refused` is what to say.
		} finally {
			saving = false;
		}
	}

	const swatch =
		'inline-flex size-11 items-center justify-center rounded-full border transition-colors duration-150 ease-out peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background motion-reduce:transition-none';
</script>

<ResponsiveModal
	bind:open
	title={dimension ? `Edit ${dimension.name}` : 'New dimension'}
	description="One question your notes are sorted by, and the answers it allows."
	class="sm:max-w-lg"
>
	<div class="space-y-6 px-2 pt-4">
		<div class="space-y-2">
			<label for="{group}-name" class="text-sm font-medium">Name</label>
			<Input
				id="{group}-name"
				bind:value={name}
				maxlength={64}
				placeholder="domain"
				autocomplete="off"
			/>
		</div>

		<div class="space-y-2">
			<p class="text-sm font-medium">Values</p>
			<p class="text-sm text-muted-foreground">
				The answers this dimension allows. A note holds one of them.
			</p>
			<ul class="space-y-2">
				{#each values as value, at (at)}
					<li bind:this={rows[at]} class="flex items-center gap-2">
						<Input
							bind:value={values[at].now}
							maxlength={64}
							autocomplete="off"
							aria-label="Value {at + 1}"
							placeholder="biology"
						/>
						<Button
							variant="ghost"
							size="icon"
							class="size-11 shrink-0"
							aria-label={value.was ? `Remove ${value.was}` : 'Remove this value'}
							onclick={() => (values = values.filter((_, other) => other !== at))}
						>
							<X class="size-4" />
						</Button>
					</li>
				{/each}
			</ul>
			<Button variant="outline" class="h-11" onclick={addValue}>
				<Plus class="size-4" />
				Add a value
			</Button>
		</div>

		<fieldset class="space-y-2">
			<legend class="text-sm font-medium">Colour</legend>
			<p class="text-sm text-muted-foreground">
				The hue the graph uses while {naming} is the lens.
			</p>
			<div class="flex flex-wrap items-center gap-2">
				{#if unpinnable}
					<label class="cursor-pointer">
						<input
							type="radio"
							name="{group}-slot"
							checked={slot === undefined}
							onchange={() => (slot = undefined)}
							class="peer sr-only"
						/>
						<span
							class={cn(
								'inline-flex h-11 items-center rounded-full border px-4 text-sm transition-colors duration-150 ease-out peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background motion-reduce:transition-none',
								slot === undefined
									? 'border-foreground/30 text-foreground'
									: 'border-border text-muted-foreground'
							)}
						>
							Pick for me
						</span>
					</label>
				{/if}
				{#each SLOTS as option (option)}
					<label class="cursor-pointer">
						<input
							type="radio"
							name="{group}-slot"
							checked={slot === option}
							onchange={() => (slot = option)}
							class="peer sr-only"
						/>
						<span
							class={cn(swatch, slot === option ? 'border-foreground/60' : 'border-transparent')}
						>
							<span class="sr-only">Colour {option}</span>
							<span
								aria-hidden="true"
								class="size-6 rounded-full bg-current"
								style:color="var(--facet-{option})"
							></span>
						</span>
					</label>
				{/each}
			</div>
		</fieldset>

		{#if refused}
			<p class="text-sm text-destructive" role="alert">{refused}</p>
		{/if}

		<div class="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
			<Button
				variant="outline"
				class="h-11 sm:h-9"
				disabled={saving}
				onclick={() => (open = false)}
			>
				Cancel
			</Button>
			<Button class="h-11 sm:h-9" disabled={!ready} onclick={save}>
				{dimension ? 'Save' : 'Add dimension'}
			</Button>
		</div>
	</div>
</ResponsiveModal>
