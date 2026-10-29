# OpenCode Piggy

[中文](README.md) | English

OpenCode Piggy is a self-contained OpenCode V2 plugin that lets the [dsh-piggy](https://github.com/CLICGGER-TYPES/dsh-piggy) desktop pet grow with your work in OpenCode.

The plugin subscribes to OpenCode's public server events, maps work records to events with stable IDs, writes them asynchronously to a persistent local outbox, then delivers them over HTTP to the game's official work-event API. Server events work the same for OpenCode Desktop and the TUI, which share one plugin.

The plugin registers no model tools and does not change model context. You start the pet yourself; the game manages gameplay, values and saves.

| Component | Requirement |
|---|---|
| OpenCode | V2, 2.0.26 or later |
| dsh-piggy | Recommended: 0.37.2-rc.5 (desktop shell 0.6.8-rc.3), started with `--work-events` |
| Plugin version | 0.2.0 |

## Quick start

### 1. Install the plugin

Install the stable release from npm with the OpenCode V2 CLI:

```sh
opencode plugin add opencode-piggy@latest
```

The command installs a global plugin and writes the configuration for you; there is nothing to download, extract or edit by hand. Reload your project and the plugin takes effect; Desktop and the TUI need no extra setup. The plugin uses only Node built-in modules.

`latest` follows stable releases; to pin a version, install `opencode-piggy@0.2.0`. A pinned version does not move to the next one by itself. To upgrade from `@next` or a pinned RC, remove the old install target before adding `@latest`; the queue is preserved. Without npm, use the GitHub target `github:WolalaQAQ/opencode-piggy#v0.2.0::path:packages/opencode-piggy` instead; see the [usage guide](https://github.com/WolalaQAQ/opencode-piggy/blob/main/docs/guides/opencode.md#用命令行安装) (Chinese).

### 2. Start the game

The plugin only delivers events; you open the game yourself. The work-event API is off by default, so start the official dsh-piggy with `--work-events`. From the official source, run this in `apps/desktop` after installing its dependencies:

```sh
npm run pack-game
npx electron . --work-events
```

With an installed build, add `--work-events` to the app's launch arguments. The [official 0.37.2-rc.5 release](https://github.com/CLICGGER-TYPES/dsh-piggy/releases/tag/v0.37.2-rc.5) includes the required API; `0.6.8-rc.3` in the download filename is the desktop shell version.

After that, use OpenCode as usual and your work is delivered to the pet. To enable it for one project only, install offline from a release archive, or customize directories, see the [usage guide](https://github.com/WolalaQAQ/opencode-piggy/blob/main/docs/guides/opencode.md) (Chinese).

## Offline and retries

Events are written to disk before delivery; records already persisted are kept while the game is closed and delivered automatically when it starts again. The plugin retries every 5 seconds. The game's acceptance window is 7 days; older events stay on disk and are no longer sent automatically. An event leaves the outbox only after the game returns `applied`, `duplicate` or `ignored`, and retries reuse the original event ID, so nothing is counted twice.

Projects in the same OpenCode service share one dispatcher, which stops when the last project unloads the plugin.

## Directories and data

The plugin first looks for `piggy/work-endpoint` in the official unified data directory. The event queue stays in its original location:

| System | Game endpoint directory | Plugin queue directory |
|---|---|---|
| Windows | `%APPDATA%/piggy/work-endpoint` | `%APPDATA%/opencode-piggy-plugin` |
| macOS | `~/Library/Application Support/piggy/work-endpoint` | `~/Library/Application Support/opencode-piggy-plugin` |
| Linux | `$XDG_DATA_HOME/piggy/work-endpoint`, defaulting to `~/.local/share/piggy/work-endpoint` | `$XDG_CONFIG_HOME/opencode-piggy-plugin`, defaulting to `~/.config/opencode-piggy-plugin` |

Linux uses `XDG_DATA_HOME` only when it is an absolute path. If the new discovery file is absent, the plugin still tries `dsh-piggy/work-endpoint` and then `dsh-piggy-desktop/work-endpoint` under the old configuration root. Explicit paths keep taking priority; if the game moves to the new directory, update any `gameDirectory` setting that still points to the old one.

The queue's `events/` stores only event IDs, types and timestamps, with no chat content, code or tool output. For a custom game data directory or queue location, see the [usage guide](https://github.com/WolalaQAQ/opencode-piggy/blob/main/docs/guides/opencode.md#配置游戏目录与队列) (Chinese). When reporting issues, do not share the game's `work-endpoint/endpoint.json`, which contains a local authentication token.

## Guides

The [usage guide](https://github.com/WolalaQAQ/opencode-piggy/blob/main/docs/guides/opencode.md) (Chinese) covers CLI installation and removal, project-level configuration, offline installation, directory options and troubleshooting. The [release guide](https://github.com/WolalaQAQ/opencode-piggy/blob/main/docs/guides/releasing.md) (Chinese) explains packaging and publishing.

## Development

The repository contains only the plugin:

| Path | Contents |
|---|---|
| `packages/opencode-piggy/` | The plugin: event mapping, persistent outbox, official endpoint discovery and HTTP delivery |
| `scripts/` | Installer script, type check and packaging |

Development dependencies are TypeScript and Node types only, and the source tooling needs Node.js 22.15 or later:

```sh
npm install --ignore-scripts
npm run check
```

To enable the plugin straight from source, run `node scripts/install-opencode.mjs --global` in the repository root, or pass `--project="/path/to/project"` to enable it for one project only. See the [CHANGELOG](https://github.com/WolalaQAQ/opencode-piggy/blob/main/CHANGELOG.en.md) for version history.

## License

[MIT](https://github.com/WolalaQAQ/opencode-piggy/blob/main/LICENSE).
