<script lang="ts">
	import { resolve } from '$app/paths';
	import { Badge } from '@sloppy/ui/badge';
	import { buttonVariants } from '@sloppy/ui/button';
	import { REPOSITORY } from '$lib/links';

	let { isSample }: { isSample: boolean } = $props();

	let scrollY = $state(0);
	const home = resolve('/');
</script>

<svelte:window bind:scrollY />

<header
	class="sticky top-0 z-30 border-b border-transparent bg-background/85 backdrop-blur-sm transition-colors data-[scrolled=true]:border-border"
	data-scrolled={scrollY > 8}
>
	<div class="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-8">
		<span class="flex items-center gap-2">
			<a href={home} class="text-base font-[650] tracking-tight">Sloppy</a>
			{#if isSample}
				<Badge variant="outline" title="Numbers from the committed records, not the bench's export"
					>sample</Badge
				>
			{/if}
		</span>
		<span class="flex items-center gap-6">
			<nav class="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
				<a href={resolve('/how')} class="hover:text-foreground">How it works</a>
				<a href={resolve('/results')} class="hover:text-foreground">Results</a>
				<a href={resolve('/methodology')} class="hover:text-foreground">Methodology</a>
			</nav>
			<span class="flex items-center gap-2">
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a link off this site -->
				<a href={REPOSITORY} class={buttonVariants({ variant: 'outline', size: 'sm' })}>GitHub</a>
				<span class="hidden sm:inline"
					><a href="{home}#start" class={buttonVariants({ size: 'sm' })}>Get started</a></span
				>
			</span>
		</span>
	</div>
</header>
