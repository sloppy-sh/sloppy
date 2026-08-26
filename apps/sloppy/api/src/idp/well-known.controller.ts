import { Controller, Get, Header, Param, UseFilters } from "@nestjs/common";
import {
  identityManifest,
  instanceManifest,
  requireIdentity,
} from "@sloppy/idp";
import type { SyrIdentityManifest, SyrInstanceManifest } from "@sloppy/types";
import { Public } from "../auth/public.decorator";
import { IdpExceptionFilter } from "./idp-request";
import { IdpService } from "./idp.service";

/**
 * The two paths a consumer is allowed to assume. Everything else this instance
 * serves is a URL read out of one of them, which is what lets the API move a
 * route without breaking anybody — see syr's "Platform Delegation v0.1" § 2.4.
 *
 * `main.ts` excludes exactly these two from the `/api` prefix, because a peer
 * resolves them at the site root. Adding a third route to this controller would
 * put it under `/api` instead.
 */
@Controller(".well-known")
@UseFilters(IdpExceptionFilter)
export class WellKnownController {
  constructor(private readonly idp: IdpService) {}

  @Public()
  @Get("syr")
  @Header("Cache-Control", "public, max-age=300")
  instance(): SyrInstanceManifest {
    return instanceManifest(this.idp.context.publicUrl);
  }

  @Public()
  @Get("syr/:did")
  @Header("Cache-Control", "public, max-age=300")
  async identity(@Param("did") did: string): Promise<SyrIdentityManifest> {
    const context = this.idp.context;
    const identity = await requireIdentity(context, decodeURIComponent(did));
    return identityManifest(context.publicUrl, identity.did);
  }
}
