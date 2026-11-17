import { version } from "../package.json";

/**
 * Which build this is. Not a release number: a stamp of `<date>.<n>` bumped whenever anything lcr
 * serves changes, so `lcr --version` and the startup banner both say which source a running binary
 * was built from. A reviewer who cannot tell whether the page in front of them is the one they just
 * built reads the banner and knows; keeping it current is therefore part of changing the source.
 */
export const VERSION = "2026-11-17.2";

/** Release tags use the package version; Bun embeds it in the standalone executable. */
export const RELEASE_VERSION = `v${version}`;
