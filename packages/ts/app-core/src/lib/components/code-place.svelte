<script lang="ts">
	// A place in the code, as a chip that opens it — DESIGN.md § "An anchor
	// into code".
	import FileCode from '@lucide/svelte/icons/file-code';
	import type { CodeAnchor } from '@sloppy/types';
	import { anchorLabel } from '@sloppy/ui';

	let { anchor, onShow }: { anchor: CodeAnchor; onShow: (anchor: CodeAnchor) => void } = $props();
</script>

<button
	type="button"
	title={anchor.path}
	data-code-place={anchor.path}
	onclick={() => onShow(anchor)}
	class="inline-flex min-h-8 max-w-64 min-w-0 items-center gap-1.5 rounded-full border border-border px-2 text-xs transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
>
	<FileCode class="size-3.5 shrink-0 text-muted-foreground" />
	<span class="min-w-0 truncate font-mono">{anchorLabel(anchor)}</span>
</button>
