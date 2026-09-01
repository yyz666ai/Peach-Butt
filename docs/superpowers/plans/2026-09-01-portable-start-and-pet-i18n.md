# Portable Start and Complete Pet i18n Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide one source-based, no-installer start command for macOS and Windows, and make every pet-facing message follow the saved language immediately.

**Architecture:** Keep `settings.language` as the single locale source and route visible copy through `src/shared/i18n.ts`. Use a production `npm start` pipeline that runs only cross-platform Node/npm commands, then starts Electron from the existing compiled main entry.

**Tech Stack:** Electron, electron-vite, TypeScript, React, Vitest, npm.

---

### Task 1: Lock the pet language behavior with failing tests

**Files:**
- Modify: `src/main/runtime.test.ts`
- Modify: `src/core/dashboard-layout.test.ts`
- Create: `scripts/portable-start-contract.test.ts`

- [x] Add a runtime test that switches settings from Chinese to English and expects the next pet snapshot message to contain no Chinese characters.
- [x] Add tests for English greeting, focus-click feedback, recovery completion and rest reminder messages.
- [x] Add static tests requiring renderer bubble comparison to use `t(lang, 'msg.focusKeep')`, preview copy to use i18n, and `package.json` to expose a cross-platform `start` script.
- [x] Run the focused tests and confirm they fail because the current recovery message, preview copy, bubble comparison and start script are not compliant.

### Task 2: Make the full pet interaction path locale-driven

**Files:**
- Modify: `src/main/runtime.ts`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/src/main.tsx`
- Modify: `src/shared/i18n.ts`

- [x] Replace the hard-coded recovery completion message with `t(settings.language, 'msg.thanksRecovery')`.
- [x] On a language update, clear cached temporary pet copy and rebuild active takeover and overlay copy in the new language.
- [x] Replace preview reminder arrays and renderer takeover fallback literals with shared translation keys.
- [x] Replace the renderer's Chinese string comparison with `snapshot.message === t(lang, 'msg.focusKeep')`.
- [x] Refresh the tray context menu after saving a language change so its labels switch immediately.
- [x] Run the focused tests until green, then run the complete suite.

### Task 3: Add the shared no-installer start command

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `scripts/check-runtime.mjs`

- [x] Require Node.js 22 or newer and add a small runtime checker with actionable macOS/Windows guidance.
- [x] Add `prestart` to run the checker and `start` to execute `npm run build && electron .` without shell-specific syntax.
- [x] Run the portable-start contract test, typecheck and build.
- [x] Run `npm start` on macOS and confirm the live process starts from the repository production output.

### Task 4: Rewrite the bilingual README around portable source launch

**Files:**
- Modify: `README.md`

- [x] Replace the download/installer-first copy with identical macOS and Windows quick-start commands: clone or download, `npm install`, `npm start`.
- [x] Explain the difference between `npm start` for normal use and `npm run dev` for development.
- [x] Add update, data-location, first-run and troubleshooting notes in Chinese and English.
- [x] State explicitly that no installer or public binary is currently distributed.

### Task 5: Verify, document and publish source changes

**Files:**
- Modify: `docs/superpowers/plans/2026-09-01-portable-start-and-pet-i18n.md`

- [x] Run `npm run assets:check`, `npm run videos:check`, `npm test`, `npm run typecheck`, and `npm run build`.
- [x] Confirm the repository is clean except for intended changes and run `git diff --check`.
- [x] Commit the implementation, merge it into `main`, and report the exact no-installer commands. The final GitHub push is performed immediately after this checklist update.
