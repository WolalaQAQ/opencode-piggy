# Changelog

[中文](CHANGELOG.md) | English

## [0.1.0-rc.3] - 2026-10-12

### Features
- The upstream submodule is upgraded and pinned to dsh-piggy `0.36.1` (`329be94`). The desktop shell adaptation is version `0.6.5-rc.2`.
- Adds a Windows x64 installer that bundles the game, Electron, a standalone Node bridge runtime and the plugin. It installs per user without administrator rights, enables the global plugin and creates desktop and Start menu shortcuts.
- The installed app opens in game receiving mode. The pet is opened and closed by the user and installation never starts it. Uninstalling keeps the save and the bridge queue and removes only the global plugin entry that belongs to that install directory.
- Adds a GitHub Actions release workflow: pushing a version tag builds and publishes the Windows x64 installer, and a manual run can produce a draft only.
- Adds `scripts/prepare-release.mjs`, which sets up Electron, the runtime dependencies and the type-check dependencies from a pinned list.

### Design Rationale
- The installer takes care of dependencies and the launch entry. The plugin, the bridge and the pet keep separate lifecycles, and the plugin never starts the pet.
- The submodule's directory layout and load-time integration are kept. Original files are only copied into the build output, and the client is not rebuilt.
- The plugin is loaded by OpenCode as a plain file on disk and the bridge uses the Node runtime shipped in the package. The installer is generated directly by NSIS.

### Notes & Caveats
- If a project already enables the source plugin entry, disable it first so it does not load alongside the installer's global entry.
- Before upgrading or uninstalling, quit the pet and stop any OpenCode background service that is using the runtime in the install directory.

## [0.1.0-rc.2] - 2026-10-12

### Features
- The work bridge becomes a standalone Node background process, and the OpenCode plugin only starts it. Several projects share one bridge through their own leases.
- The game receiver pulls queued events. The bridge removes an event only after the game has durably applied and acknowledged it. The bridge never loads the Store or writes the game save.
- Plugin lease renewal no longer waits for long delivery batches. When a full queue rejects an event, its event-mapping cache entry is revoked.
- The outbox acknowledges an event only after it is durably written, the write lock is published only after complete owner information is written, and the game publishes the WAL for the full settlement result before installing it into the Store.

### Design Rationale
- Starting and stopping the bridge is separate from the pet, and the game keeps its single background writer for saves. The bridge queue cannot replace a game transaction.
- The standalone bridge uses a different default directory and role identifier from the older version, so a running older in-game bridge is never mistaken for it.
- The game WAL moves to v2 and compares full state snapshots. New events use versioned BLAKE2 semantic IDs.
- The launcher only merges requests within one process. The single writing instance across processes is guaranteed by the bridge itself.

### Notes & Caveats
- Upgrading from rc.1: `npm start` at the repository root now runs only the bridge. Run the source game receiver with `npm run start:receiver`.
- The plugin no longer accepts the `executable` and `exitWhenDisconnected` options. Use `nodeExecutable` (`--node-executable` on the command line) to choose the Node runtime for the bridge. `directory` now means the bridge directory, not the pet's userData.
- An unfinished old v1 game WAL is left untouched and automatic recovery stops. Old game saves, receipts and outboxes are not deleted or merged automatically.

## [0.1.0-rc.1] - 2026-10-12

### Features
- The original dsh-piggy is added as a Git submodule pinned to game `0.36.0`. This repository maintains only the OpenCode compatibility code and docs.
- The original Electron main process connects to the work bridge at load time. The window, game and art are used directly from the submodule, with no modified copy of its sources.

### Design Rationale
- Upstream code and the compatibility layer are managed separately. Upgrades happen through the submodule pointer and explicit adjustments to the integration points.
- The original host and its single background writer are kept, so gameplay, UI and the save format stay unchanged.

### Notes & Caveats
- After cloning, run `git submodule update --init --recursive`. The entry point needs an Electron runtime that supports `module.registerHooks`.
- The compatibility layer is enabled through the plugin script.
