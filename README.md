# dsh-compass

English | [中文](README.zh.md)

A single-package [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin adding a right-side context-and-files panel to the Web GUI: directory browsing, injected-context documents, a read-only git commit graph, and a session-log download action.

The package is one bundle, one loader row: the host half mounts the local git backend (`/git/*`), the plugin-owned directory routes (`/dir/*`), and the `/export` command as child plugins; the browser half registers the panel into `shell.overlay` and the download action into the panel's header utilities.

## Main-track compatibility

The package carries every capability surface it needs, so it installs on any dsh build whose web composition includes the slot system (in upstream `master` since the slot-system commit; the last npm release predates it):

- directory listing and text reads go through the package's own bounded browser (`/dir/*` reads the filesystem directly — no `directoryPicker.readText`, no browse backend requirement, works even when the profile composes a native chooser);
- the git seam and its local backend ship inside the package (`ctx.subprocess` + `ctx.webServer` come from the base composition);
- the conversation reserve uses the package's own `--dsh-compass-width` variable and a CSS `:has()` rule against the shell's stable `[data-shell-overlay]` hook — no fork CSS required (the fork's in-box rule reads a different variable, so no composition double-pads).

## Install

Install from this repository with a pinned commit:

```sh
dsh plugin --profile web add github:Happy2Git/dsh-compass#<commit-sha>
```

Git installs build from source through the package's `prepare` script (transpile-only, no dev context). pnpm ≥10 blocks the build until allowed; on the first failed `add`, copy the exact key pnpm printed into the profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-compass: true
```

and re-run the `add`. That allowance is permission to execute this package's code at install time — pin a commit so a later push cannot silently change what runs.

The fork's default `web` profile ships the same panel in-box. To use this package instead, disable the in-box rows in the profile's own `cordis.patch.yml`:

```yaml
- id: ui-context-files
  disabled: true
- id: git
  disabled: true
- id: directory-routes
  disabled: true
- id: session-log-download
  disabled: true
```

Local checkouts install without any build permission:

```sh
dsh plugin --profile web add ./dsh-compass
```

## Building

`pnpm build` (also the `prepare` script) runs tsdown only — the shipped entry points transpile from `src/` with no type checking, so a git install builds self-contained. Type safety is owned where the sources originate: these sources are typechecked under the fork's strict aggregate before extraction, and the bundled `tsconfig.json` maps the `@deepseek-ai/dsh-*` types to a sibling `../deepseek-harness` checkout for editor support.

## License

MIT. Copyright (c) 2026 DeepSeek.
