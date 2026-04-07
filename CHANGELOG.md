# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [0.2.0](https://github.com/ericktarzia/DevAlive/compare/v0.1.1...v0.2.0) (2026-04-07)


### Features

* add packaging script to package.json ([57bbac5](https://github.com/ericktarzia/DevAlive/commit/57bbac52b6e1b206f0c2919b9da15e87ed7c066b))

### [0.1.1](https://github.com/ericktarzia/DevAlive/compare/v0.0.1...v0.1.1) (2026-04-07)


### Bug Fixes

* pipeline ([d89a793](https://github.com/ericktarzia/DevAlive/commit/d89a79357d321a0961204590664ae5c4f86e426d))

## [0.1.0] - 2026-04-07

### Added

- Explorer tree view listing named API endpoints with status icons (green/yellow/red).
- Periodic HTTP(S) checks (ping) with configurable `pingInterval`, `timeout` and `slowThreshold`.
- Workspace-scoped configuration file support: `.vscode/devalive.json` (read/write helpers).
- Commands: `DevAlive: Add Endpoint`, `DevAlive: Remove Endpoint`, `DevAlive: Open Config`, `DevAlive: Refresh`, `DevAlive: Open Endpoint`.
- Small WebviewPanel for lightweight add/remove endpoint configuration.
- Output channel (`DevAlive`) and status bar summary showing number of down endpoints.
- Bilingual `README.md` (EN/PT), `LICENSE` (MIT) and placeholder images (`images/icon.svg`, `images/screenshot.svg`).

### Fixed

- Removed a broken `devalive.openSettings` command/activation that could be triggered from the command palette.

### Notes

- TypeScript project compiles successfully (`npm run compile`).
- Use `.vscode/devalive.json` in the workspace root to persist endpoints per-project.
