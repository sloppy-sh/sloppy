// Where a stored picture is loaded from. `assetSrc` in runtime.ts says what
// each shell's answer means.

import { proxied } from '@sloppy/client';
import { runtime } from './runtime.js';

export function pictureSrc(src: string): string {
	return runtime.assetSrc()?.(src) ?? proxied(src);
}
