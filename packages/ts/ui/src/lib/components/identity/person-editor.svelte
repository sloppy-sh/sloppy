<script lang="ts">
	// Changing what people see of you. The pictures land as they are chosen and
	// the words when they are saved, so the caller is told about each separately.
	import ImageIcon from '@lucide/svelte/icons/image';
	import { BIO_MAX, DISPLAY_NAME_MAX, isLinkedPicture } from '@sloppy/types';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { cn } from '$lib/utils.js';
	import Avatar from './avatar.svelte';
	import type { Person, PictureRole } from './person.js';
	import Picture from './picture.svelte';

	let {
		person,
		replacing = null,
		saving = false,
		refused = null,
		onPicture,
		onLink,
		onSave,
		onCancel,
		class: className
	}: {
		person: Person;
		/** The picture being replaced right now, if one is. */
		replacing?: PictureRole | null;
		saving?: boolean;
		/** What was refused, shown beside the control that asked for it: the
		 *  picker named by `picture`, or the save when that is null. */
		refused?: { picture: PictureRole | null; message: string } | null;
		onPicture: (role: PictureRole, file: File) => void;
		/** Offered only where the store takes a picture by its `https:` link. */
		onLink?: (role: PictureRole, link: string) => void;
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

	/** The link field open under each picture, and what has been typed in it. */
	let links = $state<Record<PictureRole, string | null>>({ avatar: null, banner: null });
	/** A link that is not one, said under the field it was typed in. */
	let unlinkable = $state<PictureRole | null>(null);

	function link(role: PictureRole): void {
		const typed = links[role]?.trim() ?? '';
		if (!isLinkedPicture(typed)) {
			unlinkable = role;
			return;
		}
		unlinkable = null;
		onLink?.(role, typed);
	}

	// A link the store took is the picture now, so its field has done its work.
	$effect(() => {
		for (const role of ['avatar', 'banner'] as const) {
			const typed = links[role]?.trim();
			if (typed && person[role] === typed) links[role] = null;
		}
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
		class="h-control sm:h-9"
		disabled={replacing !== null || saving}
		onclick={() => pickers[role]?.click()}
	>
		{replacing === role ? 'Adding…' : label}
	</Button>
	{#if refused?.picture === role && links[role] === null}
		<p class="basis-full text-sm text-destructive" role="alert">{refused.message}</p>
	{/if}
	{#if onLink && links[role] === null}
		<Button
			type="button"
			variant="ghost"
			class="h-control sm:h-9"
			disabled={replacing !== null || saving}
			onclick={() => (links[role] = '')}
		>
			Use a link
		</Button>
	{/if}
	{#if links[role] !== null}
		{@const id = `person-${role}-link`}
		<div class="basis-full space-y-1.5">
			<Label for={id}>{role === 'avatar' ? 'Link to a picture' : 'Link to a banner'}</Label>
			<div class="flex gap-2">
				<Input
					{id}
					type="url"
					inputmode="url"
					autocomplete="off"
					placeholder="https://"
					class="min-w-0 flex-1"
					bind:value={links[role]}
					aria-invalid={unlinkable === role}
					onkeydown={(event) => {
						if (event.key !== 'Enter') return;
						event.preventDefault();
						link(role);
					}}
				/>
				<Button
					type="button"
					class="h-control shrink-0 sm:h-9"
					disabled={replacing !== null || saving}
					onclick={() => link(role)}
				>
					Use it
				</Button>
				<Button
					type="button"
					variant="ghost"
					class="h-control shrink-0 sm:h-9"
					onclick={() => {
						links[role] = null;
						if (unlinkable === role) unlinkable = null;
					}}
				>
					Cancel
				</Button>
			</div>
			{#if unlinkable === role}
				<p class="text-sm text-destructive" role="alert">
					Paste an address that starts with https://
				</p>
			{:else if refused?.picture === role}
				<p class="text-sm text-destructive" role="alert">{refused.message}</p>
			{/if}
			<p class="text-xs text-muted-foreground">
				Whoever opens this folder loads this picture from that address.
			</p>
		</div>
	{/if}
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
				<Picture src={person.banner} class="size-full" />
			{:else}
				<ImageIcon class="size-6 text-muted-foreground/60" aria-hidden="true" />
			{/if}
		</div>
		<div class="flex flex-wrap items-center gap-2">
			{@render picker('banner', 'Change banner')}
		</div>
	</div>

	<div class="space-y-2">
		<p class="text-sm leading-none font-medium">Picture</p>
		<div class="flex flex-wrap items-center gap-4">
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

	{#if refused && !refused.picture}
		<p class="text-sm text-destructive" role="alert">{refused.message}</p>
	{/if}

	<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
		<Button
			type="button"
			variant="outline"
			class="h-control sm:h-9"
			disabled={saving}
			onclick={onCancel}
		>
			Cancel
		</Button>
		<Button type="submit" class="h-control sm:h-9" disabled={saving} aria-busy={saving}>
			{saving ? 'Saving…' : 'Save'}
		</Button>
	</div>
</form>
