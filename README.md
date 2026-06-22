# Web Panels for Sine

Web Panels is a Sine mod that brings a temporary web-app panel rail to Firefox-family browsers.

This repository is intentionally separate from the Zen Browser fork. The Zen implementation is a reference for behavior and UX; this project targets Sine's mod format with `theme.json`, `userChrome.css`, and userChromeJS modules.

## Current Scope

- Loads only in `chrome://browser/content/browser.xhtml`.
- Mounts a right-side rail shell when `sine.web-panels.enabled` is true.
- Cleans up DOM and listeners when Sine unloads or disables the mod.
- Keeps preferences in Sine-compatible `preferences.json`.

## Local Install

Install Sine, then add this repository as an unpublished/custom mod. If installing outside the Sine store, Sine may require enabling unsafe JavaScript for local userChromeJS mods.

## Development Direction

The next implementation step is to port the Web Panels runtime into Sine-compatible chrome JS: saved URL items, floating browser surface, resize, context menus, separators, unread badges, and lifecycle cleanup.
