<script lang="ts">
	let { onopened }: { onopened: (folder: string) => void } = $props();
</script>

<div data-page="first-run">
	<button type="button" onclick={() => onopened('/Users/me/garden')}>Choose a folder</button>
</div>
