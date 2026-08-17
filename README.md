# dsh-compass

English | [中文](README.zh.md)

> **⚠️ Warning: the published npm release of dsh cannot show this panel — a source build can.** The last npm release of DeepSeek Harness predates the web slot system the panel renders through. Upstream `master` (≥ `47f9438`, verified) ships the slot system, module loader, and `shell.overlay` seat, and hosts this package directly — build the official repo from source and install there. The [fork](https://github.com/Happy2Git/deepseek-harness) keeps the same panel in-box. See [Requirements](#%EF%B8%8F-requirements).

A single-package [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin adding a right-side context-and-files panel to the Web GUI: directory browsing with git status badges, live injected-context documents with a compaction history stream (origin badges, measured occupancy strip, unread signals), a framed read-only git commit graph with working-tree status, panel-file drag into the conversation (image intake for vision models), and a session-log download action.

The package is one bundle, one loader row: the host half mounts the local git backend (`/git/*`), the plugin-owned directory routes (`/dir/*`), and the `/export` command as child plugins; the browser half registers the panel into `shell.overlay` and the download action into the panel's header utilities.

## ⚠️ Requirements

The panel renders through the web slot system (`window.__ModuleLoader__`, the frozen module table, and the `shell.overlay` seat in `ui-layout`). Hosts divide into three tiers, verified 2026-08:

- **Upstream `master`, source build — works.** `https://github.com/deepseek-ai/deepseek-harness` at `47f9438` contains the slot system, the `dsh.client` manifest handling, and the `shell.overlay` render site; this package's externals all resolve and the panel mounts. Build the repo from source (below) — the npm release is older than these commits.
- **The [fork](https://github.com/Happy2Git/deepseek-harness) — works, panel in-box.** Its default `web` profile ships the same panel; installing this package there is for running the standalone artifact.
- **Published npm release — does not work.** The last npm release predates the slot system; an install that passes every check while the GUI shows no panel is the expected symptom. Wait for the next upstream release that ships it.

Confirm the mounting surface on your host:

```sh
dsh --profile web --dump-config
```

On the fork the output must contain the `ui-context-files`, `git`, `directory-routes`, and `session-log-download` rows. On an upstream source build the panel needs no upstream rows of its own — check instead that the served page's boot manifest carries the `modules` row (`packages/client/modules`, the `__ModuleLoader__` provider).

## Screenshots

**Files tab** — lazy directory tree with directories-first order, basename filter, git working-tree status badges, and per-row open/copy actions. File rows show their own status letter (A/M/D/U/!); directory rows aggregate the strongest status anywhere beneath them, outlined to read as "contains changes" (M/A/D/U) or collapsed to one ! for a fully ignored tree:

![Files tab](screenshots/01-files-tab.png?v=3)

**Git tab** — framed working-tree block and commit tree: branch position, uncommitted files, lanes, ref badges, lazy commit expansion, and a refresh control. Workspace rows and commit files open their diff in the centered pop-out, colored by line role:

![Git tab](screenshots/02-git-tab.png?v=3)
![Working-tree diff preview](screenshots/06-workspace-diff.png?v=3)

**Context tab** — injected-context documents split into the live window and the compaction history stream, with search over both; the view re-projects live and pulls the complete history out-of-band on activation (up to 1,000 messages, the conversation window untouched), so both sections hold the complete log. Since v0.14 an **occupancy strip** heads the view (measured bytes per section, colored by origin class — instructions / skill / plugin / cross-session recall / runtime), every row carries its **origin badge and measured size**, the history section names **the latest compaction** (how many documents and bytes it moved out of the live window), and while the context tab is inactive new injections and boundary moves badge the tab with an **unread count** (cleared on open; a dot marks it when the panel is collapsed):

![Context tab](screenshots/03-context-tab.png?v=4)

**Directories first** — symlinked directories sort with the directories group:

![Files tab, directories first](screenshots/04-files-tab-dirs-first.png?v=3)

**Panel-file drag** — file rows drag their absolute path into the conversation. On fork builds the composer's native intake consumes the drag (image files attach their content directly on vision models). On every other host — including upstream source builds, whose composer does not know the drag MIME yet — the package's own window-level intake takes the drop and appends the path sentence to the draft, which the agent can still act on with its tools. The intake yields to a composer that claims the drag, so both hosts keep exactly one intake:

![Panel file drag](screenshots/05-drag-image.png?v=3)

## Main-track compatibility

The package carries every capability surface it needs, so it installs on any dsh build whose web composition includes the slot system (in upstream `master` since the slot-system commit; the last npm release predates it):

- directory listing and text reads go through the package's own bounded browser (`/dir/*` reads the filesystem directly — no `directoryPicker.readText`, no browse backend requirement, works even when the profile composes a native chooser);
- the git seam and its local backend ship inside the package (`ctx.subprocess` + `ctx.webServer` come from the base composition);
- the conversation reserve uses the package's own `--dsh-compass-width` variable and a CSS `:has()` rule against the shell's stable `[data-shell-overlay]` hook — no fork CSS required (the fork's in-box rule reads a different variable, so no composition double-pads).

## Security and performance

**Security.** Every host route this package registers is loopback-only and refuses to load on a non-loopback webserver host. Request bodies are capped at 64 KiB and must be `application/json`; every path must be fully qualified, so a wire value never resolves against the host working directory. Reads fail closed: oversized images refuse whole (`file-too-large`, plus the composed attachment per-file limit as 413), image formats come from magic bytes rather than filename extensions, git hashes are format-validated so no option can ride the hash slot, workspace-diff paths must stay inside the repository, and a git call outside a repository answers `not-a-repository`. The panel is read-only: git commands never write, dropped images are never copied into the workspace, and file content crosses the wire only through the bounded read routes.

**Performance.** The context tab's document stream is signature-gated, so the panel re-projects and re-renders only when the injected documents actually change, not per stream batch. Complete history arrives through `/dir/injected-docs`, which filters the durable log server-side and sends text blocks only; on a session with 181k events this replaced roughly 120 MB of history-page JSON per activation with a single KB-scale response. Every listing and read is bounded (`maxEntries`, `maxTextBytes`, `maxImageBytes`, git `maxOutputBytes` and `maxCommits`), every fetch rides an `AbortSignal` that cancels with the caller, and the per-session fetch markers prune with the session list, so nothing accumulates per departed session. Directory badges list ignored entries through `ls-files --directory`, which collapses a node_modules to one line (measured 14 MB → ~18 KB on a fork-repo root); a truncated ignored listing degrades gracefully, the M/A/D/U badges stay complete.

## Install

**Host first.** The panel renders through the web slot system. On the official repo, build from source (verified with `master` at `47f9438`) and use its CLI — no need to boot the web UI yet, the single start at the end of this section serves as the check:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git checkout 47f9438
pnpm install && pnpm run build
```

**Clone and install.** Clone this repository, build it, then add the clone by path from your dsh checkout:

```sh
cd path://dsh-compass        # the dsh-compass checkout on this machine
pnpm install                 # the build toolchain (tsdown) — once per clone
pnpm run build               # emits lib/ (index.js + client.js)
```

Then, back in the dsh checkout:

```sh
dsh plugin --profile web add path://dsh-compass
```

That is the whole install. Two properties make it the path this project is developed against:

- **No allowBuilds step.** pnpm installs a local directory as a `link:` dependency and never runs its `prepare` script, so there is no build gate to open — the clone's own `pnpm run build` is what produces `lib/`.
- **The profile records a filesystem link.** The install lives and dies with the clone: keep the checkout in place, and a later `pnpm run build` inside it updates the running panel without re-adding (restart `dsh web` after a rebuild).

**Reproducible deployments: pinned-commit git install.** When the host must install without a clone, add the GitHub spec and open the build gate pnpm blocks:

```sh
dsh plugin --profile web add github:Happy2Git/dsh-compass#<commit-sha>
```

The git install builds through the package's `prepare` script, which pnpm ≥10 blocks until allowed. On the first failed `add`, pnpm prints the exact allowlist key — copy every key it prints (the same commit can appear as both a `codeload.github.com/.../tar.gz/...` key and a `git+https://github.com/...git#...` key) into the profile's `pnpm-workspace.yaml`, then re-run the same `add`. Do not build inside `node_modules` by hand: a failed `add` never registers the layer, and a hand build does not register it either. Pin a commit so a later push cannot silently change what runs.

Verify either install:

   - `~/.dsh/profiles/web/package.json` lists `dsh-compass` in both `dependencies` and `dsh.profile.bundles` (a missing bundles entry means the `add` did not succeed; re-run `dsh plugin --profile web install` to register it);
   - `~/.dsh/profiles/web/node_modules/dsh-compass/lib/` contains `index.js` and `client.js` (built by `pnpm run build` in the clone, or by `prepare` for git installs).

On an **upstream source build** nothing else is needed: the package's own bundle patch disables the stock `session-log-download` row (its `/export` command would collide with this package's, and this package ships the command plus its own download button and dialog; the ZIP endpoint itself belongs to ApiProxy and stays).

The **fork's** default `web` profile ships the same panel in-box. To use this package instead, disable the in-box panel rows in the profile's own `cordis.patch.yml` (`session-log-download` is already handled by the package's own patch):

   ```yaml
   - id: ui-context-files
     disabled: true
   - id: git
     disabled: true
   - id: directory-routes
     disabled: true
   ```

Start (or restart, if it is already running) `dsh web`, refresh the page, and check: `curl -X POST http://127.0.0.1:<port>/dir/list -H 'content-type: application/json' -d '{"path":"<any dir>"}'` answers JSON (host half mounted), the browser console has no `__ModuleLoader__` error, and the panel is on the right.

## Uninstall

```sh
dsh plugin --profile web remove dsh-compass
```

This runs `pnpm remove` and drops the package from the layer list; it works even when the profile fails to boot. On the fork, delete the three `disabled: true` rows added above to restore the in-box panel; on an upstream build the package-patched `session-log-download` row restores itself.

## When the panel still does not appear

- **Official npm release of dsh.** Expected, not an install failure. The published release has no slot system, so the panel cannot render; uninstall as above, and either build upstream `master` from source (see Install) or wait for the next upstream release.
- **`ERR_MODULE_NOT_FOUND` at boot.** The `prepare` build was blocked or skipped; apply the `allowBuilds` step and re-run the `add`.
- **Boot fails with `command "export" is already registered`.** The composition still mounts the stock `session-log-download` row and the plugin's patch did not land after it. Ensure `dsh-compass` sits in `dsh.profile.bundles` (plugin `add` appends it after the stock bundles) and that the profile's `node_modules/dsh-compass/cordis.patch.yml` contains the `session-log-download` disable.
- **Host routes answer but no panel in the GUI.** The host build lacks the slot system; re-check the requirements.

## Building

`pnpm build` (also the `prepare` script) runs tsdown only — the shipped entry points transpile from `src/` with no type checking, so a git install builds self-contained. Type safety is owned where the sources originate: these sources are typechecked under the fork's strict aggregate before extraction, and the bundled `tsconfig.json` maps the `@deepseek-ai/dsh-*` types to a sibling `../deepseek-harness` checkout for editor support.

## Roadmap

The package is published and installable; here is where it goes next. Star or watch the repo to follow along.

- **English UI locale.** The panel copy is Chinese today; add an English dictionary behind the locale service.
- **Exact-path git output.** The git backend parses `--name-status`/`--numstat` with default quoting; switch to `-z` NUL-terminated output so paths with quotes or tabs display exactly.
- **Rename-aware file list.** Show a rename as one row instead of a delete + add pair.
- **Drag-to-attach on upstream.** Upstream's composer does not know the panel drag MIME, so the package's own intake degrades to the path sentence; an upstream ui-conversation PR adopting the MIME would restore image attach on source builds.
- **dsh-terminal.** The terminal TUI is packaged the same way and stays local until its feature set grows.

## License

MIT. Copyright (c) 2026 DeepSeek.
