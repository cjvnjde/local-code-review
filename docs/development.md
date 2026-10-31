# Development

Development requires [Bun](https://bun.sh/) and Git. Runtime code has no third-party dependencies; no package install is needed.

## Run from source

```sh
bun ./src/index.ts --no-open
```

Run inside a repository with changes. Omit `--no-open` to launch the review page automatically. Source runs accept the same options as the [standalone executable](../README.md).

## Check and build

```sh
bun test ./src
bun build ./src/index.ts --target=bun --outdir /tmp/lcr-check
bun build ./src/index.ts --compile --minify --outfile /tmp/lcr
```

The compiled executable embeds the browser UI and needs only Git for diff reviews. Live web annotation additionally requires an installed Chrome, Chromium, or Edge.

With Chrome installed, run the opt-in real-browser workflow:

```sh
LCR_TEST_BROWSER=1 bun test src/web-review-browser.test.ts
```

It uses a temporary Git repository, local application, and isolated browser profile. See [web annotation](web-ui.md) for browser lifecycle and limits.

After changing the distributable skill, verify the project-local copy matches:

```sh
cmp -s skills/apply-lcr/SKILL.md .agents/skills/apply-lcr/SKILL.md
```

Do not commit generated executables or review files.
