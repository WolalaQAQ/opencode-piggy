# Changelog

[中文](CHANGELOG.md) | English

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
