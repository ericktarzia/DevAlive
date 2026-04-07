# Changelog

All notable changes to this project will be documented in this file.

The format is based on "Keep a Changelog" and this project adheres to semantic versioning.

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
