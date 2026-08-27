<script lang="ts">
	// Changing what people see of you. The pictures land as they are chosen and
	// the words when they are saved, so the caller is told about each separately.
	import ImageIcon from '@lucide/svelte/icons/image';
	import { BIO_MAX, DISPLAY_NAME_MAX } from '@sloppy/types';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { cn } from '$lib/utils.js';
	import Avatar from './avatar.svelte';
	import type { Person, PictureRole } from './person.js';

	let {
		person,
		replacing = null,
		saving = false,
		onPicture,
		onSave,
		onCancel,
		class: className
	}: {
		person: Person;
		/** The picture being replaced right now, if one is. */
		replacing?: PictureRole | null;
		saving?: boolean;
		onPicture: (role: PictureRole, file: File) => void;
		/** Empty means they cleared the field. */
		onSave: (edits: { displayName: string; bio: string }) => void;
		onCancel: () => void;
		class?: string;
	} = $props();

	// Read once: a picture landing mid-edit re-reads `person`, and what has been
	// typed since must survive that.
	// svelte-ignore state_referenced_locally
	let displayName = $state(person.displayName ?? '');
	// svelte-ignore state_referenced_locally
	let bio = $state(person.bio ?? '');

	let pickers = $state<Record<PictureRole, HTMLInputElement | null>>({
		avatar: null,
		banner: null
	});

	function chose(role: PictureRole, event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (file) onPicture(role, file);
	}
</script>

{#snippet picker(role: PictureRole, label: string)}
	<input
		type="file"
		accept="image/*"
		class="hidden"
		bind:this={pickers[role]}
		onchange={(event) => chose(role, event)}
	/>
	<Button
		type="button"
		variant="outline"
		class="h-11 sm:h-9"
		disabled={replacing !== null || saving}
		onclick={() => pickers[role]?.click()}
	>
		{replacing === role ? 'Adding…' : label}
	</Button>
{/snippet}

<form
	class={cn('space-y-6', className)}
	onsubmit={(event) => {
		event.preventDefault();
		onSave({ displayName, bio });
	}}
>
	<div class="space-y-2">
		<p class="text-sm leading-none font-medium">Banner</p>
		<div
			class="flex h-28 w-full items-center justify-center overflow-hidden rounded-lg bg-muted sm:h-40"
		>
			{#if person.banner}
				<img src={person.banner} alt="" class="size-full object-cover" draggable="false" />
			{:else}
				<ImageIcon class="size-6 text-muted-foreground/60" aria-hidden="true" />
			{/if}
		</div>
		{@render picker('banner', 'Change banner')}
	</div>

	<div class="space-y-2">
		<p class="text-sm leading-none font-medium">Picture</p>
		<div class="flex items-center gap-4">
			<Avatar {person} size={64} class="border border-border" />
			{@render picker('avatar', 'Change picture')}
		</div>
	</div>

	<div class="space-y-2">
		<Label for="person-name">Name</Label>
		<Input
			id="person-name"
			bind:value={displayName}
			maxlength={DISPLAY_NAME_MAX}
			autocomplete="name"
			placeholder={person.handle}
		/>
	</div>

	<div class="space-y-2">
		<Label for="person-bio">Bio</Label>
		<Textarea id="person-bio" bind:value={bio} maxlength={BIO_MAX} rows={3} />
		<p class="text-right text-xs text-muted-foreground">{bio.length}/{BIO_MAX}</p>
	</div>

	<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
		<Button
			type="button"
			variant="outline"
			class="h-11 sm:h-9"
			disabled={saving}
			onclick={onCancel}
		>
			Cancel
		</Button>
		<Button type="submit" class="h-11 sm:h-9" disabled={saving} aria-busy={saving}>
			{saving ? 'Saving…' : 'Save'}
		</Button>
	</div>
</form>
