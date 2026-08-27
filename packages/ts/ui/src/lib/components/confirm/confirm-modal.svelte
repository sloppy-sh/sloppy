<script lang="ts">
	// Asking once before something cannot be taken back. DESIGN.md § Layout —
	// one modal, so this is `ResponsiveModal` with the two buttons every such
	// question has, rather than a second surface that opens differently.
	import { Button } from '$lib/components/ui/button/index.js';
	import ResponsiveModal from '../responsive-modal.svelte';

	let {
		open = $bindable(false),
		title,
		/** What happens, in the words the person needs to decide. */
		description,
		confirmLabel,
		cancelLabel = 'Cancel',
		/** False where the act is merely irreversible rather than destructive. */
		destructive = true,
		/** Why the act did not land, in the caller's words — it is the one holding
		 *  the server's. Shown here because this surface is over the page. */
		refused = null,
		onconfirm
	}: {
		open?: boolean;
		title: string;
		description: string;
		confirmLabel: string;
		cancelLabel?: string;
		destructive?: boolean;
		refused?: string | null;
		onconfirm: () => void | Promise<void>;
	} = $props();

	let working = $state(false);

	async function confirm() {
		working = true;
		try {
			await onconfirm();
			open = false;
		} catch {
			// Left open, so the same button tries again; `refused` is what to say.
		} finally {
			working = false;
		}
	}
</script>

<ResponsiveModal bind:open {title} {description}>
	{#if refused}
		<p class="px-2 pt-4 text-sm text-destructive" role="alert">{refused}</p>
	{/if}
	<div class="flex flex-col-reverse gap-2 px-2 pt-4 sm:flex-row sm:justify-end">
		<Button variant="outline" class="h-11 sm:h-9" disabled={working} onclick={() => (open = false)}>
			{cancelLabel}
		</Button>
		<Button
			variant={destructive ? 'destructive' : 'default'}
			class="h-11 sm:h-9"
			disabled={working}
			onclick={confirm}
		>
			{confirmLabel}
		</Button>
	</div>
</ResponsiveModal>
