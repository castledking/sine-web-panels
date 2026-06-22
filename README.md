# Web Panels for Sine

Web Panels is a Sine mod that adds a temporary web-app panel rail to Firefox-family browsers, optimized for Zen Browser first.

The saved Zen Browser implementation is only a reference. This repository is a standalone Sine mod using `theme.json`, `userChrome.css`, and userChromeJS modules.

## Features

- Persistent web panel URLs stored in `sine.web-panels.items`.
- Favicon rail with a bottom `+` button.
- URL-only add/edit popup with validation for `http` and `https`.
- Floating panel surface that opens above the page without resizing it.
- Outside-click and Escape dismissal.
- Resizable panel with a `320px` minimum width.
- Panel context menu: open in new tab, edit, move, unload, delete.
- Empty rail context menu: add spacer, new web panel.
- Spacer items with move/delete context menu.
- Drag reorder across panels and spacers.
- Unread count badge from title prefixes such as `(3) Inbox` or `[3] Inbox`.
- Clean Sine unload handling for DOM, listeners, and live panel browsers.

## Local Install

Install Sine, then add this repository as an unpublished/custom mod. For local JavaScript mods outside the Sine store, Sine may require enabling unsafe JavaScript.

## Preferences

- `sine.web-panels.enabled`: enables or disables the rail.
- `sine.web-panels.width`: remembered floating panel width.
- `sine.web-panels.items`: JSON list of panel and separator items.

## Current Validation Status

Static validation passes for JSON and JavaScript syntax. Manual browser validation still needs to be run through Sine on Zen Browser before this should be considered store-ready.

## Screenshots Checklist

- Rail with multiple favicon items.
- Add URL popup.
- Floating panel open above page content.
- Resizing panel.
- Context menu and separator.
