# Changelog

[中文](CHANGELOG.md) | English

## [0.2.0] - 2026-10-30

### Features
- With the third-party agent work-event API now stable, the plugin ships as a stable release on npm `latest`, installed as `opencode-piggy@latest`.
- Follow official dsh-piggy 0.37.2-rc.5 (desktop shell 0.6.8-rc.3), discovering the unified `piggy/work-endpoint` directory first.
- Linux game discovery follows an absolute `XDG_DATA_HOME`, defaulting to `~/.local/share/piggy/work-endpoint`. Windows and macOS use `%APPDATA%/piggy/work-endpoint` and `~/Library/Application Support/piggy/work-endpoint`, respectively.

### Design Rationale
- The official desktop shell manages game data paths; the plugin follows its defaults without migrating game data or the plugin queue.
- The work-event protocol remains v1, so event payloads, stable IDs, commit acknowledgements and the seven-day offline window stay unchanged.

### Notes & Caveats
- To upgrade from `@next` or a pinned RC, remove the old install target before adding `opencode-piggy@latest`; the plugin queue is preserved.
- If the new directory has no discovery file, discovery still falls back to `dsh-piggy/work-endpoint` and then `dsh-piggy-desktop/work-endpoint` under the old configuration root.
- `gameDirectory` and `PIGGY_USERDATA` keep taking priority; update explicit paths that still point to an old directory when the game moves. Start the game with `--work-events` as before.

## [0.2.0-rc.2] - 2026-10-16

### Features
- The plugin is published to npm as the prerelease package `opencode-piggy` on the `next` tag. Install it with `opencode plugin add opencode-piggy@next`, and update or remove it with `plugin update` and `plugin remove`. To pin a version, install `opencode-piggy@0.2.0-rc.2`.
- Without npm, you can still install from the Git subdirectory target `github:WolalaQAQ/opencode-piggy#v0.2.0-rc.2::path:packages/opencode-piggy`; the `.tgz` and `.zip` archives on GitHub Releases are for offline installation.
- Event mapping, delivery, offline retries and directory discovery are the same as in 0.2.0-rc.1, and the game requirements are unchanged.

### Design Rationale
- Downloading, writing configuration and updating are left to OpenCode's plugin management, so users no longer extract archives or edit JSON by hand.
- Prereleases live on the `next` tag and leave npm's default `latest` tag alone; a stable release will use a new version number published to `latest`.

### Notes & Caveats
- The game must still include the work-event API from main commit `8f72f17` and be started with `--work-events`.
- A pinned install target does not move to the next version by itself; reinstall with the new version number.

## [0.2.0-rc.1] - 2026-10-16

### Features
- A self-contained OpenCode V2 plugin. It subscribes to public server events, maps work records to events with stable IDs, writes them asynchronously to a persistent outbox and delivers them over HTTP to dsh-piggy's official work-event API. Desktop and the TUI share the plugin; OpenCode 2.0.26 or later is required.
- Events keep being persisted while the game is closed and are delivered when it reopens. Delivery retries every 5 seconds and an event is removed only after the game returns `applied`, `duplicate` or `ignored`. Events older than the game's 7-day acceptance window stop being sent automatically and stay on disk.
- Projects in one OpenCode service share a single dispatcher that stops when the last plugin unloads. A new project waits for an in-flight shutdown to finish before taking over.
- Automatic discovery of the game's `work-endpoint`: the installed build's `dsh-piggy` first, then the source build's `dsh-piggy-desktop` when the former has no discovery file. `PIGGY_USERDATA`, the `gameDirectory` plugin option and the `--game-endpoint` installer flag override it, with explicit settings taking priority. The queue defaults to `opencode-piggy-plugin/` under the configuration root and can be set with `directory` or `--directory`.
- Released on GitHub Releases as both `.tgz` and `.zip` archives with a common top-level `package/` directory, containing only the plugin code, license and README. `npm run pack:plugin` builds both archives.
- GitHub Actions runs checks, packages and creates a Release when a `v*` tag is pushed; a manual run can produce just a draft.

### Design Rationale
- The official game provides a framework-neutral durable ingestion API, so the plugin can map and deliver reliably from the OpenCode side without an intermediate process. The outbox sits on the OpenCode side so work records survive the game being closed, and retries reuse the original event ID so the game can deduplicate.
- The plugin uses only Node built-in modules and stays self-contained, so users need no extra runtime. The user starts the game; the plugin registers no model tools and changes no model context.

### Notes & Caveats
- The game must include the work-event API from main commit `8f72f17` and be started with `--work-events`.
- `directory` is the plugin queue directory and `gameDirectory` is the game's `work-endpoint/` directory; they are independent.
