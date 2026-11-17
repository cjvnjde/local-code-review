import type { CdpResult } from "../cdp.ts";

export const browserVersion = (
  product: string,
): CdpResult<"Browser.getVersion"> => ({
  product,
  protocolVersion: "1.3",
  revision: "fixture",
  userAgent: product,
  jsVersion: "fixture",
});
