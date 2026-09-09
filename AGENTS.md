# AGENTS.md — DBD Map Overlay

## Project

Dead by Daylight minimap overlay. Electron desktop app (Windows + Linux). Shows full map for current match via transparent overlay window. OCR-powered automatic map detection. OBS-ready. Stream Deck support.

- **Repo**: `LucaFontanot/dbd-map-overlay`
- **Site**: https://dbdmap.lucaservers.com
- **License**: Apache 2.0

## Stack

| Layer | Tech |
|-------|------|
| Runtime | Electron (Node.js, Chromium) |
| Frontend | HTML/CSS/JS, Bootstrap 5, jQuery, Popper 2, Tom Select, Font Awesome |
| OCR | tesseract.js v7 (LSTM, multi-language) |
| Image processing | sharp, image-size |
| Screenshots | node-screenshots (native addon) |
| Auto-update | electron-updater (GitHub Releases) |
| Build/packaging | electron-builder (NSIS, deb, rpm, AppImage) |
| Package manager | Yarn (Berry/cache) |
| Scheduling | cron |

## Architecture

```
index.js                          → Entry point. Wayland detection → X11 fallback.
                                   Single-instance lock. Instantiates all modules.
src/core/main-window.js           → Main Electron BrowserWindow. IPC hub for
                                   map-change, display info, updates.
src/core/overlay-window.js        → Transparent always-on-top overlay window.
                                   Position/size/opacity/rotation from settings.
src/core/obs-window.js            → Separate window for OBS capture (no transparency).
src/core/hotkeys.js               → Global keyboard shortcuts for map switching.
src/core/settings.js              → electron-store wrapper for user preferences.
src/core/tray.js                  → System tray icon and menu.
src/core/stream-deck.js           → Stream Controller config generator.
src/core/map-detector.js          → OCR engine: screenshots DBD window, runs
                                   tesseract with multi-language recognition.
src/core/map-detector/realm-catalog.js → Pure: which photo-dir folder names are
                                   realms (filters map names used as folders).
src/core/map-match.js             → Pure Realm/Map → file-path matching (preferred creator).
src/core/user-data.js             → User photo/custom map storage.
src/core/utils.js                 → Shared utilities.
src/renderer.js                   → Main window preload/renderer logic.
src/js/*.js                       → Feature modules (settings UI, hotkeys UI,
                                   lobby, streamdeck UI, privacy, images, logger).
src/map/renderer.js               → Overlay window renderer (displays map images).
src/map/renderer_obs.js           → OBS window renderer.
src/i18n/*.json                   → 15 language translation files.
maps/<Creator>/<Realm>/<Map>.png  → Map images. Organized by creator → realm.
picture-hash.js                   → Standalone: computes MD5 of all map files.
scripts/prebuild.sh               → Downloads native binaries for cross-platform builds.
scripts/localization/             → Localization tooling (i18n extraction/merging).
```

## Key Patterns

- **No TypeScript** — plain CommonJS (`require`/`module.exports`), no build/transpile step.
- **No context isolation** — `nodeIntegration: true`, `contextIsolation: false` in BrowserWindows.
- **IPC**: Main ↔ renderer via `ipcMain.handle`/`ipcMain.on` (main) and `ipcRenderer.invoke`/`ipcRenderer.on` (renderer).
- **Settings**: Read/write via `Settings` class (electron-store). Keys used across core and renderer; check `src/core/settings.js` and `src/js/settings.js` for defaults.
- **Map key format**: `Creator/Realm/MapName` (case-insensitive, no extension). Fuzzily matched to `maps/` directory.
- **Preferred creator**: Settings `preferredCreator` is the saved default auto-detect uses (`src/core/map-match.js`). Home `#creatorSelect` only filters the gallery and remaps the current overlay; it does not write `preferredCreator`. Changing either dropdown mid-match remaps to the same map in that layout and keeps the detector running (`fromDetector: true`). Auto-detect keeps `findClosestMapMatch` `fallback: true`, so a map the preferred creator lacks locally silently resolves to another artist's PNG; `images.js` logs `show-map-command::creator-fallback` when that happens (usual cause is a stale/incomplete preferred-creator download, not a matcher bug).
- **Map matching**: `findClosestMapMatch` canonicalizes names (accents, apostrophes, leading `The`, ` - Istari`, parenthetical floors, trailing numbers/EU/NA) then scores closest map name; if needed, matches swapped realm/map folders or a unique file in the same realm. Layout swaps pass `{fallback: false}` so another artist's PNG is never substituted. Detector identities are kept as English `Realm/Map` (not the artist filename).
- **Realm vs map classification**: `OcrMatcher` reports a name as a map, a realm only as context. What counts as a realm = `FALLBACK_REALMS` (`src/core/map-detector/fallback-realms.js`, the maintained authority — add new DLC realms there, e.g. `sleepless district`) ∪ photo-dir realm folders that are **not** map names (`realm-catalog.js` filters them). Some creators (KaiserAleex, SamoelColt) store the Crotus Prenn Asylum maps under a folder literally named `Disturbed Ward` — a MAP; letting that folder into the realm set makes OcrMatcher classify the loading line as a realm and the map becomes undetectable. Never name a realm folder after a map.
- **Map change flow**: Renderer picks map → sends `map-change` IPC with base64 or file path → MainWindow reads file, computes size, positions overlay → forwards to overlay/obs windows.
- **Wayland**: Detected at startup, respawns with `--ozone-platform=x11`.
- **Single instance**: `app.requestSingleInstanceLock()` — second instance sends args (`show-map=...`) to first via IPC then quits.
- **Versioning**: `package.json` version. electron-updater reads GitHub Releases.
- **In-app docs**: FAQ/CHANGELOG/CREDITS/Privacy modals fetch Markdown at runtime from GitHub raw master (`src/js/consts.js` → `raw.githubusercontent.com/LucaFontanot/dbd-map-overlay/master/`). Doc edits only reach users once committed and **pushed** to upstream master.
- **Auto-detect is toggle-only** (v1.6.5+): no hotkey triggers it. The old per-match Ctrl+D one-shot was removed in `d9ccb0e`; no Ctrl+Q exists. Detection = `MapDetector` state machine (`src/core/map-detector/`), started by the "Auto-detect map" switch in the bottom bar.

## Commands

```bash
yarn start              # Run in dev mode
yarn build              # Build Windows + Linux (calls prebuild.sh first)
yarn build:win          # Windows only
yarn build:linux        # Linux only
node picture-hash.js    # Generate MD5 manifest of all map files
```

## Adding Maps

1. Add `.png` files under `maps/<Creator>/<Realm>/`.
2. Update `CREDITS.md` if new creator.
3. Run `node picture-hash.js` if hash manifest is needed.
4. Create directory structure matching existing convention (Creator → Realm → map PNGs).

## i18n

Translation JSON files in `src/i18n/`. Keys are map names (English). UI strings are hardcoded in HTML/JS — no i18n framework, just lang-specific JSON for map name lookup. Localization tooling in `scripts/localization/`.

## CI/CD

- GitHub Actions: `images-deploy.yml` (map image deployment). `release.yml` (disabled — releases done manually with `yarn publish`).
- `yarn publish` builds and publishes to GitHub Releases via electron-builder.

---

## Self-Updating Rule

**AGENTS.md is the source of truth for agentic onboarding.** Every time an agent (human or AI) discovers a pattern, convention, or architectural decision that is not documented here — or corrects an outdated entry — it MUST update this file. Specifically:

1. **Before starting any task**: Read `AGENTS.md` to understand the project.
2. **After completing any task**: If you learned something that would help the next agent, add it to `AGENTS.md` under the relevant section. If no section fits, add a new one.
3. **On discovering stale information**: Correct it immediately. Do not work around outdated docs.
4. **Keep it concise**: One-liners preferred. This file is read by agents, not humans seeking tutorials. No fluff.
5. **Never remove the self-updating rule**: This clause must survive all edits.

*Last updated: 2026-09-09*
