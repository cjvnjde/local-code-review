---
name: bun-packaging
description: Build and verify Bun applications distributed as standalone executables, including embedded browser assets, build plugins, and dependency compatibility. Use when changing build configuration, asset loading, runtime dependencies, or release packaging in a Bun project.
---

# Bun standalone packaging

Preserve the project's distribution contract. Inspect its package scripts,
lockfile, build script, asset entrypoints, and release workflow before changing
the pipeline. This skill applies to Bun executables; it does not require turning
other projects into one. Use the project's pinned toolchain and documented commands.

## One reproducible pipeline

- Use the existing build script for production bundling and compilation. Keep
  development and release transforms consistent, including CSS processing and
  framework/compiler plugins. A direct CLI build can bypass script-only plugins.
- Register build plugins in the actual production build configuration; installing
  a plugin package is not evidence that it runs. Check transformed output when
  changing plugin integration. See [Bun plugins](https://bun.sh/docs/bundler/plugins).
- Treat typechecking, JavaScript bundling, and executable compilation as distinct
  checks. A successful bundle does not prove that types are correct or that the
  standalone artifact starts. Follow the project's chosen compilation mode;
  don't introduce an experimental mode as an incidental optimization.
- Surface build warnings and errors. Diagnose unprocessed CSS directives,
  unresolved assets, and skipped transforms instead of hiding their diagnostics.
- Preserve the project's explicit settings for production mode, configuration
  loading, and environment loading. Do not embed credentials or machine-specific
  paths in build-time constants.

## Assets and dependencies

- Trace browser code and styles from the application's asset entrypoints. Ensure
  optional chunks, images, fonts, workers, and license text used by the feature are
  included by the selected packaging mechanism. Files present in a checkout are
  not automatically available in a downloaded executable.
- For a Bun-served HTML application, preserve its HTML imports and generated asset
  routes. Verify the served HTML's script and stylesheet URLs from the compiled
  program. See [Bun HTML routes](https://bun.sh/docs/bundler/fullstack).
- Keep build-time tools out of runtime loading paths. Browser bundles must not
  import server-only modules, and the binary must not need the source tree or a
  package installation when the product promises a standalone release.
- Before adding a runtime dependency, inspect how it loads files and code. Native
  addons, executable downloads, dynamic path-based imports, and platform-specific
  resources need explicit verification. Prefer maintained dependencies compatible
  with the existing artifact contract.
- Preserve the distinction between bundled functionality and documented optional
  external programs. A standalone executable can still intentionally require Git
  or a browser; don't silently add a new mandatory runtime prerequisite.
- Keep third-party notices available in the distributed form required by the
  project. Check existing notice generation when dependencies change.

## Verify the distributed artifact

Build into a temporary output directory using the repository's production command.
Run the resulting executable outside the source checkout with isolated test
configuration and disposable data, without adjacent source files or dependencies.

Verify startup, help/version where provided, and a meaningful application path.
For a browser app, fetch HTML and embedded assets and open the affected flow when
rendering or interaction changed. Exercise a newly added lazy feature rather than
testing only the first screen. Don't use a dev server as evidence for the binary.

When cross-compilation changes, check the configured target matrix and distinguish
"built for this target" from "executed on this target." Use CI or a matching host
for runtime claims. Follow Bun's [compiler documentation](https://bun.sh/docs/compiler)
for supported compilation modes and targets.

Keep binaries, generated bundles, temporary fixtures, and installed dependencies
out of commits. Report the artifact and behavior verified, plus any target that
was only compiled. Publishing follows the user's task and project instructions;
a successful build alone is not a request to publish a release.
