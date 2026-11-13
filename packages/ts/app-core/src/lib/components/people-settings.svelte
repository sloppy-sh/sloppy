<script lang="ts">
	// Where the people a note names by a W3ID are looked up — docs/ARCHITECTURE.md
	// § "Who a person is".
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';
	import { Label } from '@sloppy/ui/label';
	import { asOrigin, prefs, W3ID_REGISTRY } from '../stores/prefs.svelte.js';

	let typed = $state(prefs.current.w3idRegistry);
	let problem = $state<string | null>(null);
	let kept = $state<string | null>(null);

	function keep(event: SubmitEvent): void {
		event.preventDefault();
		const origin = asOrigin(typed);
		if (!origin) {
			kept = null;
			problem = "That doesn't look like a web address. Try something like registry.example.com.";
			return;
		}
		problem = null;
		prefs.set('w3idRegistry', origin);
		typed = origin;
		kept = `People are looked up through ${new URL(origin).host} now.`;
	}

	function backToDefault(): void {
		problem = null;
		prefs.set('w3idRegistry', W3ID_REGISTRY);
		typed = W3ID_REGISTRY;
		kept = `People are looked up through ${new URL(W3ID_REGISTRY).host} again.`;
	}
</script>

<p class="text-sm text-muted-foreground">
	Which service names the people whose profiles you see. When a note names somebody by a W3ID,
	Sloppy asks it who they are and shows the name and picture they made public.
</p>
<form class="flex flex-col gap-2 sm:flex-row" onsubmit={keep}>
	<Label for="w3id-registry" class="sr-only">Which service names people</Label>
	<Input
		id="w3id-registry"
		type="text"
		inputmode="url"
		autocomplete="url"
		autocapitalize="none"
		spellcheck={false}
		placeholder="registry.example.com"
		bind:value={typed}
		class="h-control sm:flex-1"
	/>
	<Button type="submit" variant="outline" class="h-control">Use this one</Button>
</form>
{#if problem}
	<p class="text-sm text-destructive" role="alert">{problem}</p>
{/if}
{#if kept}
	<p class="text-sm text-muted-foreground" role="status">{kept}</p>
{/if}
{#if prefs.current.w3idRegistry !== W3ID_REGISTRY}
	<Button variant="ghost" class="h-control px-0" onclick={backToDefault}>
		Use the one Sloppy came with
	</Button>
{/if}
