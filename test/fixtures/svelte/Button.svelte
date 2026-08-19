<!-- A button. The props type lives in the module script, which is where the
     Svelte adapter looks first. -->
<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	import type { ButtonAnimation, Sizes } from './types.js';

	/** @propsmith Button */
	export type ButtonProps = {
		/** The visual size of the button. */
		size?: Sizes;

		/** The visual style variant. */
		variant?: 'standard' | 'accent' | 'subtle';

		/** Whether the button is disabled. @default false */
		disabled?: boolean;

		/** Content rendered inside the button. */
		children?: Snippet;

		/**
		 * The underlying DOM node.
		 * @bindable
		 */
		ref?: HTMLButtonElement;

		/** Open and close animation. */
		animation?: ButtonAnimation;

		/**
		 * Internal group registry.
		 * @internal
		 */
		__group?: unknown;
	} & HTMLButtonAttributes;
</script>

<script lang="ts">
	let { size = 'medium', variant = 'standard', disabled = false, children, ref = $bindable() }: ButtonProps =
		$props();
</script>

<button bind:this={ref} class="{size} {variant}" {disabled}>
	{@render children?.()}
</button>
