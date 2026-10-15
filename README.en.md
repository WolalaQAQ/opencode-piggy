# OpenCode Piggy

[中文](README.md) | English

OpenCode Piggy lets the [dsh-piggy](https://github.com/CLICGGER-TYPES/dsh-piggy) desktop pet grow with your OpenCode work. An OpenCode V2 plugin captures work events and hands them to a standalone background bridge that has no window. The game then applies them under its original rules. The window, gameplay, numbers, save format, client and art all come from the original dsh-piggy. The plugin runs inside the OpenCode service, so OpenCode Desktop and the TUI share the same integration.

Official dsh-piggy source includes a work-event API from main commit `8f72f17`. It works with this repository's HTTP adapter without modifying the game's main process. Published official `v0.37.0` installers do not include that API. This repository's existing Windows x64 installer still bundles the pinned game version and receiving adaptation for use with OpenCode after installation.

| Component | Version |
|---|---|
| OpenCode Piggy (compatibility layer) | 0.1.0-rc.3 |
| dsh-piggy game (pinned submodule) | 0.36.1 |
| Desktop shell adaptation | 0.6.5-rc.2 |
| OpenCode | V2 (Desktop and TUI), 2.0.26 or later |

Download the installer from the [Releases](../../releases) page.

## Install on Windows

Download `opencode-piggy-setup-game-0.36.1-0.1.0-rc.3-x64.exe`, run it and pick an install directory. The default is `%LOCALAPPDATA%\Programs\OpenCode Piggy`. The installer is not code-signed, so Windows may show an unknown publisher warning.

The installer includes the game, Electron and a standalone Node runtime. You do not need Git, Node or npm, and no administrator rights are required. It enables the global OpenCode plugin for the current user and creates **OpenCode Piggy** shortcuts on the desktop and in the Start menu.

After installing:

1. Reload your OpenCode project. The plugin loads and starts the background bridge when needed.
2. Double-click the **OpenCode Piggy** shortcut to open the pet, and close it whenever you like.

The plugin loads in the OpenCode service, so Desktop and the TUI need no separate setup: work in either client and the pet grows. The TUI integration has been verified on Windows with OpenCode 2.0.27.

Installation does not open the pet. The bridge follows the lifecycle of the plugin and the OpenCode background service, not the pet window. While the pet is closed, work events wait in the queue and are applied the next time it opens.

To upgrade, quit the pet and stop any OpenCode background service that has loaded the plugin, then run the new installer and choose the existing install directory. Uninstall from the Windows app list or the Start menu. Upgrading and uninstalling both keep your game save and the bridge queue. See the [usage guide](docs/guides/opencode.md) (Chinese) for more.

## Privacy

The bridge stores only event IDs, types, timestamps and queue metadata. It does not record chat messages, code or tool output. `bridge.json` in the bridge directory contains a local authentication token, so do not share that directory when reporting issues.

## Platforms and running from source

The pet installer targets Windows x64. On macOS and Linux you can run the OpenCode plugin and bridge from source.

Running from source requires Node.js 22.15 or later and OpenCode V2.

### Plugin and bridge only

The plugin and bridge need neither Electron nor the game submodule. From the repository root, enable them for one project:

```sh
node scripts/install-opencode.mjs --project="/path/to/your-project"
```

Reopen the project in OpenCode Desktop or the TUI. The plugin connects to the standalone Node bridge or starts it, and never starts or quits the pet. The plugin points at this local source directory, so do not move it after enabling. For global enabling, options and disabling, see the [usage guide](docs/guides/opencode.md) (Chinese).

You can also run the bridge by hand:

```sh
npm start
```

The bridge exits after the last plugin instance disconnects. Events that have not been applied stay in the queue.

### Run the pinned game receiver

Prepare Git, the game submodule and the Electron dependencies:

```sh
git submodule update --init --recursive
node scripts/prepare-release.mjs
npm run check
npm run start:receiver
```

`prepare-release.mjs` targets Windows x64; on other platforms, prepare the Electron dependencies of `apps/desktop` yourself. The receiver connects to a running bridge. It does not start the bridge and does not stop it on exit.

### Connect to the official game source

Check out the [official dsh-piggy repository](https://github.com/CLICGGER-TYPES/dsh-piggy) separately at a main commit containing `8f72f17`. This path does not use this repository's pinned 0.36.1 submodule or its desktop shell.

After installing Electron dependencies in the official checkout's `apps/desktop`, run:

```sh
npm run pack-game
npx electron . --work-events
```

Set `PIGGY_USERDATA` to select a separate game directory. Discovery is published to `work-endpoint/endpoint.json` inside that directory. Then, from this repository, enable the OpenCode plugin and start the delivery adapter:

```sh
node scripts/install-opencode.mjs --project="/path/to/isolated-project" --directory="/path/to/isolated-bridge"
npm run start:runtime-adapter -- --game-endpoint="/path/to/userData/work-endpoint" --bridge-home="/path/to/isolated-bridge"
```

`--directory` and `--bridge-home` must select the same bridge directory; `--game-endpoint` selects the official game's discovery directory. The adapter acknowledges the bridge only after the game confirms its commit. Each bridge allows one receiver; do not connect the pinned game receiver and the HTTP adapter to the same bridge. Use a separate project, bridge directory and game directory for an initial setup. This entrypoint does not migrate installed plugins, queues or saves automatically. See the [usage guide](docs/guides/opencode.md#连接官方源码小猪) (Chinese) for starting and stopping it.

### Build the Windows installer

On Windows x64, set up the dependencies above and NSIS 3. If `makensis.exe` is not on PATH, set `MAKENSIS` to its full path:

```powershell
$env:MAKENSIS = 'C:\Program Files (x86)\NSIS\makensis.exe'
npm run dist:win
```

The installer is written to `dist/`, and `win-x64-unpacked/` holds the same content unpacked. The build reuses the compiled `client.js` from the submodule and packs the Node executable used for the build, with its license, into the bridge runtime.

### Type check

`node scripts/prepare-release.mjs` also installs the type-check dependencies. Then run:

```sh
npm run typecheck
```

## Repository layout

| Path | Contents |
|---|---|
| `upstream/dsh-piggy/` | The original Git submodule, pinned to commit `329be94` (game 0.36.1) |
| `packages/opencode-piggy/` | OpenCode V2 plugin, event mapping, delivery and auto-start |
| `packages/opencode-bridge/` | Standalone Node bridge, private queue, leases and shared protocol; it never loads the game Store |
| `apps/desktop/` | Game receiving adaptation, background host, game WAL and Windows installer configuration |
| `core.js`, `store.js`, `store/state-file.js` | Compatibility exports that forward to the submodule |
| `scripts/` | Enabling, startup, integration checks, type check and installer build |
| `.github/workflows/release.yml` | Tag-triggered release and manual draft workflow for the Windows installer |

The original `assets/`, `src/`, extensions and docs live only in the submodule. Version history is in the [CHANGELOG](CHANGELOG.en.md). Maintainers can find the release steps in the [release guide](docs/guides/releasing.md) (Chinese).

## Upstream version

`git submodule update --init --recursive` checks out the commit recorded in this repository and does not follow the latest upstream. To upgrade the game, choose the target commit in the submodule, run `npm run check`, verify the desktop behavior, then commit the new submodule pointer and any needed adaptation here. Submodule sources stay unmodified.

## License

The compatibility layer is released under the [MIT](LICENSE) license. Licenses for the original code, art and third-party dependencies are listed in [THIRD-PARTY](THIRD-PARTY.md).
