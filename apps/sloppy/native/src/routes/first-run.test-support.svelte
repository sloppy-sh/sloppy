<script lang="ts">
	let { onopened, missing = false }: { onopened: (folder: string) => void; missing?: boolean } =
		$props();
</script>

<div data-page="first-run" data-missing={missing}>
	<button type="button" onclick={() => onopened('/Users/me/garden')}>Choose a folder</button>
</div>
