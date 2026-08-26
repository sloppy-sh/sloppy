import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

/**
 * Opt a route out of the session requirement. Reach for it only where an
 * anonymous caller is the point — the health probe, and the published-subtree
 * reads a peer's instance fetches.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
