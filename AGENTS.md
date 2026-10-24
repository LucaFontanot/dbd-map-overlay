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
| Frontend | Vue 3 + Vuetify 3 (SFCs, plain JS), Material Design Icons (`@mdi/font`), marked + DOMPurify. Built by Vite 6 into `out/renderer` |
| OCR | PaddleOCR ONNX (`paddleocr` runtime + `onnxruntime-node`), main process |
| Image processing | sharp, image-size |
| Screenshots | node-screenshots (native addon) |
| Auto-update | electron-updater (GitHub Releases) |
| Build/packaging | Vite (renderer only) + electron-builder (NSIS, deb, rpm, AppImage) |
| Package manager | Yarn (Berry/cache) |

## Architecture

```
index.js                          → Entry point. Wayland detection → X11 fallback.
                                   Single-instance lock. Instantiates all modules.
src/core/main-window.js           → Main Electron BrowserWindow. IPC hub for
                                   map-change, app-info, display info, updates.
src/core/preload.js               → contextBridge `window.dbd` {invoke,send,on} with
                                   allow-listed channels (main window).
src/core/overlay-preload.js       → `window.overlay` {onMapChange,onMapHide}.
src/core/renderer-pages.js        → securePreferences() + loadPage() (out/renderer).
src/core/api.js                   → Lobby backend client + PoW challenge; owns the token.
src/core/photo-sync.js            → Map catalog sync (images.json → <userData>/photo).
src/core/docs.js                  → FAQ/changelog/credits/privacy Markdown fetch.
src/core/logs.js                  → Main console ring buffer + `logs:save` (Debug log export).
src/core/overlay-window.js        → Transparent always-on-top overlay window.
                                   Position/size/opacity/rotation from settings.
src/core/obs-window.js            → Separate window for OBS capture (no transparency).
src/core/hotkeys.js               → Global keyboard shortcuts for map switching.
src/core/settings.js              → User preferences (settings-app.json, per-key IPC).
src/core/tray.js                  → System tray icon and menu.
src/core/stream-deck.js           → Stream Controller config generator.
src/core/map-detector.js          → OCR engine: screenshots DBD window, runs
                                   PaddleOCR on the map-name area.
src/core/ocr/ocr-service.js       → Inference wrapper (engine in a worker): crop + RGB +
                                   PaddleOCR (onnxruntime-node), one service per
                                   script group, ONNX sessions cached.
src/core/ocr/model-catalog.js     → Language code (tesseract-era values) →
                                   recognition model + asset URLs/sizes.
src/core/ocr/model-store.js       → Download/unpack models into
                                   <userData>/ocr-models; ustar reader + dict
                                   extraction; pure except for axios/fs.
src/core/map-detector/keybind-detector.js → Pure: "keybind" detection mode, one
                                   OCR burst per detect-map hotkey press.
src/core/map-detector/realm-catalog.js → Pure: which photo-dir folder names are
                                   realms (filters map names used as folders).
src/core/map-match.js             → Pure Realm/Map → file-path matching (preferred
                                   creator). Single source of map-name folding,
                                   levenshtein and Creator/Realm/Map path parsing
                                   (exports foldName, levenshtein, parseMapPath).
src/core/user-data.js             → Map file IPC (read photo/custom, write/delete
                                   custom) + `dbd-img://` protocol (full files).
src/core/utils.js                 → Shared utilities.
src/renderer/index.html           → Main window page (Vue app src/renderer/main/).
src/renderer/main/services/*.js   → Reactive stores/logic: settings, catalog (map
                                   index + search), player (sendMap/overlay state,
                                   preview), lobby, hotkeys, detection, ui, markdown.
src/renderer/main/views/*.vue     → Maps, Lobby, Custom maps, Settings (tabs in
                                   views/settings/), DocView (remote Markdown).
src/renderer/overlay.html|obs.html → Overlay/OBS pages, both run overlay/overlay.js.
vite.config.mjs                   → Multi-page build, root src/renderer → out/renderer.
src/i18n/*.json                   → 15 language translation files.
maps/<Creator>/<Realm>/<Map>.png  → Map images. Organized by creator → realm.
picture-hash.js                   → Standalone: computes MD5 of all map files.
scripts/ocr-test.js               → Dev CLI: runs the production OCR engine on an
                                   image/folder and prints lines + timings.
scripts/prebuild.sh               → Downloads native binaries for cross-platform builds.
scripts/localization/             → Localization tooling (i18n extraction/merging).
```

## Key Patterns

- **No TypeScript** — main/preload are plain CommonJS, never bundled. The renderer is ES modules + Vue SFCs built by Vite (`npm run build:renderer`, run by `npm start` and every build script). Vite 6, not 7/8: they need Node ≥20.19 (rolldown binding) and the system Node is 20.15.
- **Renderer is untrusted**: every BrowserWindow uses `securePreferences()` (`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`) and a CSP meta tag. Renderer code has no `require`/`process`/Buffer — only `window.dbd`. A new IPC channel must be added to the allow-list in `src/core/preload.js` AND validate its arguments in main. Network calls (lobby API, catalog sync, docs) run in main; the renderer CSP has `connect-src 'self'`.
- **Shared CJS in the renderer**: `src/core/map-match.js`, `src/core/overlay-position.js` and `src/shared/*` are imported by renderer code as default imports (`import mapMatch from '@core/map-match.js'`); `vite.config.mjs` `commonjsOptions.include` lists them. Keep them pure (no electron/fs). Vite has no dev server here (it can't serve CJS source): use `npm run dev:renderer` (build --watch) + `electron .`.
- **IPC**: Main ↔ renderer via `ipcMain.handle`/`ipcMain.on` (main) and `window.dbd.invoke`/`send`/`on` (renderer; `on` returns an unsubscribe function and never exposes the IpcRendererEvent).
- **Settings**: main owns `settings-app.json` (`src/core/settings.js`, EventEmitter, plain JSON — not electron-store). Renderer writes ONE key via `dbd.invoke('set-setting', key, value)` (returns full object); main only accepts keys in `RENDERER_WRITABLE` with a valid value (token/id/overlayX/Y/hotkey accelerators are main-only) and never sends `token` to a renderer (`forRenderer()`) and refreshes its cache on `settings-updated`, which main broadcasts after every change. Never send the whole object (old `save-settings` let a stale renderer copy clobber keys main writes: overlayX/Y, hotkeys, mapDetection). Disk writes are debounced 250 ms (tmp+rename), flushed on `will-quit`; a corrupt file is backed up to `.bak` and defaults load. Renderer `settings.get()` uses `??`: a saved `false` stays `false` — compare with `=== true`/`!== false`, never `!== null`. `settings.init()` is the single init promise.
- **Security helpers** (`src/core/utils.js`): `safeJoin(base, rel)` for every IPC/protocol path under userData (map-change, custom data, `dbd-img://`) — rejects escapes; `lockDownWebContents` on every BrowserWindow (window-open → `openExternal` only for http(s), always deny; `will-navigate` blocked). Renderer: Vue escapes interpolations; the only `v-html` is remote Markdown through DOMPurify (`services/markdown.js`). `write-custom-data` accepts only `<name>.png` (no separators), ≤20 MB, parseable by image-size. Stream Deck pages are built in main (`streamdeck:create`): realm/map names are shell-checked, files only go to the flatpak data dir or a folder picked through `dialog:selectDirectory`. Lobby `map`/`rotation` from the server are validated (`catalog.resolveLocalMapPath`). Never log the API token or base64 payloads (`api.js` `redact()`); renderer logger is a 2000-entry ring buffer. Settings → General → Debug log calls `logs:save`: main writes renderer + main console lines (`src/core/logs.js`, captured from startup in `index.js`) to `<Downloads>/dbd-map-overlay-log-*.txt` and reveals it. Never use an `<a download>` blob: with no `will-download` handler Electron opens its own save dialog, hidden behind a fullscreen game (users reported "no file"), and detector logs live in main anyway.
- **Map key format**: `Creator/Realm/MapName` (case-insensitive, no extension). Fuzzily matched to `maps/` directory.
- **Preferred creator**: Settings `preferredCreator` is the saved default auto-detect uses (`src/core/map-match.js`). The gallery creator filter (`ui.galleryCreator`) only filters the gallery and remaps the current overlay; it does not write `preferredCreator`. Changing either dropdown mid-match remaps to the same map in that layout and keeps the detector running (`fromDetector: true`). Auto-detect keeps `findClosestMapMatch` `fallback: true`, so a map the preferred creator lacks locally silently resolves to another artist's PNG; `player.js` logs `show-map-command::creator-fallback` when that happens (usual cause is a stale/incomplete preferred-creator download, not a matcher bug).
- **Map matching**: `findClosestMapMatch` canonicalizes names (accents, apostrophes, leading `The`, ` - Istari`, parenthetical floors, trailing numbers/EU/NA) then scores closest map name; if needed, matches swapped realm/map folders or a unique file in the same realm. Layout swaps pass `{fallback: false}` so another artist's PNG is never substituted. Detector identities are kept as English `Realm/Map` (not the artist filename).
- **map-match.js is the single source** for map-name helpers shared by both processes: `foldName` (re-exported by `realm-catalog.js`), `levenshtein` (used by `ocr-matcher.js`) and `parseMapPath` (Creator/Realm/Map splitting used by the renderer catalog + hotkey labels). Do not re-implement name folding, edit distance, or path parsing elsewhere — import from `map-match.js`. Main-process detector modules reach it via `require('../map-match')`; it is pure (no electron/fs) and safe to load in main and renderer.
- **Realm vs map classification**: `OcrMatcher` reports a name as a map, a realm only as context. What counts as a realm = `FALLBACK_REALMS` (`src/core/map-detector/fallback-realms.js`, the maintained authority — add new DLC realms there, e.g. `sleepless district`) ∪ photo-dir realm folders that are **not** map names (`realm-catalog.js` filters them). Some creators (KaiserAleex, SamoelColt) store the Crotus Prenn Asylum maps under a folder literally named `Disturbed Ward` — a MAP; letting that folder into the realm set makes OcrMatcher classify the loading line as a realm and the map becomes undetectable. Never name a realm folder after a map.
- **Home search bar** (`src/renderer/main/services/catalog.js` `search`): substring hits first (legacy), then token-level fuzzy via `foldName`/`levenshtein` from `map-match.js` — a misspelled map/realm name still surfaces results, ranked by edit distance. Query/candidate tokens are folded (accents/apostrophes) and compared with a per-token distance threshold.
- **Map change flow**: Renderer picks map (`player.sendMap`) → sends `map-change` IPC with base64 or file path → MainWindow reads file (`safeJoin`, stale requests dropped by a counter), computes size, positions overlay → forwards raw bytes (`Uint8Array`, not base64) to overlay/obs windows. `ObsWindow` replays the last map message on `did-finish-load` (a map sent while it opens would otherwise be lost).
- **Map pick channels**: `show-map-command` = detector pick (`fromDetector: true`, detector keeps running); `external-map-command` = Stream Deck / second-instance `show-map=` (user pick). Both guard a null `findClosestMapMatch` and wait for `catalog.whenLoaded()` (a command arriving during the startup sync is no longer dropped).
- **Photo sync** (`src/core/photo-sync.js`, main): renderer calls `maps-sync` once at startup and shows `maps-sync-progress`. Compares `images.json` with `UserData.computePhotoHashes` (cache `<userData>/photo/.md5cache.json` keyed size+mtime, hidden from listings), verifies md5, writes via `.part`+rename, 4 parallel downloads, then `mapDetector.reloadRealms()` so first-run realms are known without restart. An empty/unparseable catalog never deletes local maps. Custom vs standard images is by source (`catalog.typeOf`).
- **Gallery images**: thumbnails are built at startup in the renderer (`catalog.buildThumbnails`, "Generating cache" on the loading screen): bytes via `read-photo-data`/`read-custom-data` → `createImageBitmap` (Chromium decoder) → 480 px WebP → object URL, 4 at a time (~6 s for 225 maps), regenerated for custom maps on `catalog.reload()`; `catalog.thumbUrl` falls back to the full `dbd-img://photo|custom/<encoded path>` URL (`catalog.imageUrl`, registered privileged before ready in `user-data.js`; custom URLs carry `?v=<customVersion>`). Source maps are up to 3840 px: never put full-size images in the gallery.
- **No sharp inside Electron on Linux**: `sharp-linux-x64.node` imports `g_object_ref`/`g_object_unref`/`g_signal_connect_data`/`g_log_set_handler` unversioned, and the Electron binary already links system GLib, so they bind to Chromium's GLib while libvips uses its bundled copy. Result: `GLib-GObject: g_object_ref: assertion 'G_IS_OBJECT (object)' failed` spam and, under load, a SIGTRAP crash (the old main-process thumbnailer killed the app after 2-5 gallery creator switches; systemd-coredump makes it look like a freeze). Same in sharp 0.35.5; loading the addon with `RTLD_DEEPBIND` fixes the binding but aborts with `double free or corruption` (Chromium's malloc shim). Every Electron process (utilityProcess, `ELECTRON_RUN_AS_NODE`) has the same problem. sharp is fine under plain Node (tests, `ocr-test`). Still to migrate: `src/core/ocr/frame.js` + `screen-state.js` + `map-detector.js` debug dump (OCR crop in main).
- **Overlay sizing** (`main-window.js` `applyMapChange`): window = exact `rotatedSize` box, set with ONE `setBounds` (never `setSize`+`setPosition`: on fractional scaling, e.g. Cinnamon 1.2, Electron rounds outward and each call grows the window 1 DIP). It still ends up 1-2 DIP larger than asked, so the overlay page gets `layout {box, align}` and `#frame` hugs the snapped edge (`overlayAlign`: glide 0 → start, 100 → end, else/dragged → center). The old `width + 5` / `height * 1.1` padding + centering left a gap so the corner was unreachable. Placement box = `overlayArea()` (`overlay-position.js`): `workArea`, except Linux with >1 display uses `bounds` — X11/XWayland work area comes from the desktop-wide `_NET_WORKAREA`, so mixed-height monitors cut the bottom off (issue #32).
- **Wayland**: Detected at startup, respawns with `--ozone-platform=x11`.
- **Linux console noise**: Chromium installs a GLib log handler that forwards GLib messages to `LOG(ERROR)` (`browser_main_loop.cc`), so every `sharp`/libvips call prints pages of `GLib-GObject: g_object_ref: assertion 'G_IS_OBJECT (object)' failed` (libvips is GObject-based) — looks like capture spam because `map-detector.js` and `ocr-service.js` both crop with sharp right after each screenshot. Not harmless: see **No sharp inside Electron on Linux**. `index.js` also sets `app.commandLine.appendSwitch('log-level', '3')` (FATAL-only) on Linux to silence it; the switch must precede `app.whenReady()`. Windows keeps Chromium's error log on purpose (no GLib handler there). Verified: 1248 such lines in a 25 s run → 0 after the switch. Standalone Electron scripts (`scripts/detector-test.js`) don't set it, so they still print it.
- **Single instance**: `app.requestSingleInstanceLock()` — second instance sends args (`show-map=...`) to first via IPC then quits.
- **Versioning**: `package.json` version. electron-updater reads GitHub Releases.
- **In-app docs**: FAQ/CHANGELOG/CREDITS/Privacy pages fetch Markdown at runtime from GitHub raw master via main (`docs-get`, `src/core/docs.js` → `raw.githubusercontent.com/LucaFontanot/dbd-map-overlay/master/`, 10 min cache). Doc edits only reach users once committed and **pushed** to upstream master.
- **Auto-detect modes**: the "Auto-detect" switch in the top app bar (`App.vue`) is the master on/off, in both modes (keybind mode needs it on too; users assumed "off = use the key"). Setting `detectionMode` (Settings → Detection): `automatic` (default) = `DetectionStateMachine` loop; `keybind` = no background tick at all (users reported in-match lag spikes), the `detect-map` system hotkey (`hotkeyDetectMap`, default `F8`: DBD binds no F-key, while Ctrl/Shift+key would fire while crouching/sprinting) calls `MapDetector.triggerKeybindDetection()` in main → `KeybindDetector` OCRs the title ROI every 400 ms for ≤8 s, first match wins, a re-press extends the burst; no lobby/endgame/`detectInCustoms` logic. Feedback via `map-detector-keybind-status` (`scanning|matched|not-found`) → snackbar. Key pressed with the switch off → `not-found` "Auto-detect is off" (it used to be only logged); DetectionTab shows a warning + "Turn on" while keybind mode is selected and the switch is off. `detect-map` is registered only in keybind mode (`Hotkeys.activeSystemHotkeys`, reloaded on `detectionMode` change): a global shortcut swallows the key from the game and would shadow a custom map hotkey. Mode change while on → `stopAutomatic`+`startAutomatic`. Spec: `docs/superpowers/specs/2026-10-17-keybind-detection-design.md`.
- **Hunt cost / loading-bar false positives**: the map title is printed in the intro AFTER the loading screen, never on it (fixtures: `loading-screen-*.png` has no title, `map-name-crop-*` are gameplay). So `_runHunting` skips OCR while `hasFilledProgressBar` still sees the bar (re-checks it every `huntBarPollMs`), OCRs only for `huntOcrWindowMs` (20 s) after the bar was last seen, `huntTimeoutMs` (120 s) caps the whole hunt. A hunt starts only after `barConfirmTicks` (2) consecutive bar sightings (IDLE and MATCH_ACTIVE). After a hunt with no map, the next one reads at `huntBackoffPollMs` (1 s) until a map is confirmed. Reason: survivor repair/heal bars in dark (Halloween event) scenes and the Quests tab pass the bar check; the old hunt OCR'd every 350 ms for 45 s → ~45% CPU, several times per match. A frame-difference "static screen" check was measured and rejected: dark slow gameplay differs from a still loading screen by only ~0.1-0.2 mean grey levels.
- **End-of-match detection is opt-in** (setting `endgameDetection`, default `false`, Settings → Detection): off = no end-screen OCR and a loading bar seen in MATCH_ACTIVE only starts a hunt, the map stays until a new one replaces it. On = old behaviour: a "CONTINUE" read (all 15 languages' `BUTTON_Continue`) or a loading bar mid-match (the "missed endgame screen" path) clears the overlay. Known false positive of the second path: a dark scene plus an action bar (repair/heal/unhook) at the bottom passes `hasFilledProgressBar` (reproduced synthetically on both gameplay fixtures at 25% brightness). `onMatchEnded(reason)` → `map-detector-clear` carries the reason (path + OCR text/confidence) into the renderer Debug log, so user reports show which path fired. With it off, MATCH_ACTIVE never returns to IDLE, so the custom-lobby flag is not refreshed between matches.
- **OCR engine** (PaddleOCR, since the tesseract migration): runs in the **main process** via `src/core/ocr/` — `paddleocr` (pure-TS runtime) + `onnxruntime-node`. No hidden window, no bundler, no WASM host: never move OCR into a renderer, the Node path is the whole point.
  - One shared detection model (`PP-OCRv5_mobile_det`) + one recognition model per script group, chosen from the `ocrLanguage` setting. Setting values are still tesseract codes (`eng`, `deu`, `rus`, `chi_tra`, …) on purpose — `model-catalog.js` maps them, so existing user settings keep working. 'all' is blocked by the UI for auto-start (`index.js`) and falls back to trying every group.
  - Models are downloaded into `<userData>/ocr-models/<model-id>/` (`inference.onnx` + `dict.txt`), replacing `tessdata`. **Source order matters**: HuggingFace (`PaddlePaddle/<model-id>_onnx`, per-file `inference.onnx` + `inference.yml`) comes first, the official PaddlePaddle bucket last — that bucket is a China-hosted CDN whose TLS handshake Node silently drops on some networks (verified: raw TCP connects, the handshake times out, curl works, every other host works), which kills first-run detection entirely. A self-hosted mirror (`MIRROR_BASE_URL` in `model-catalog.js`, or the `OCR_MODEL_MIRROR` env var) is tried before both and keeps the app's own layout; `scripts/fetch-ocr-models.js --out=DIR --lang=all` produces an uploadable one. `test/ocr/model-catalog.test.js` guards the order.
  - The dictionary lives inside `inference.yml`; `model-store.js` extracts it and **must append the trailing space class** PaddleX omits (v5 rec lists 18383 chars for 18385 output classes) or the runtime rejects it as too short.
  - Inference runs in a `worker_threads` Worker (`ocr-engine.js` + `ocr-worker.js`, still Node, never a renderer); crop + RGB happen main-side in `frame.js` (sharp thread pool) and pixels are transferred. In-process OCR blocked the main event loop 143-238 ms per call. `OCR_IN_PROCESS=1` forces in-process. Frames are raw RGBA `{data,width,height,channels}` from node-screenshots `toRaw()` (or PNG buffers in tests). `cropRect` floors left/top and clamps size — rounding both overflowed at widths ≡2 mod 4 (1366 px) and stuck the endgame detector.
  - Sessions are released (`destroy()`, paddleocr has no `dispose()`) only on `stopAutomatic` (switch off / language change), not between matches; dispose never awaits pending downloads. The detector loop carries a generation id so a stopped loop's late OCR can't fire callbacks. Idle lobby OCR is skipped when `detectInCustoms` is true.
  - `ModelStore.has(asset)` checks size (≥0.9×catalog bytes) and dictionary; onnx written via `.tmp`+rename after `dict.txt`; a model the runtime rejects is deleted (`OCR_MODEL_CORRUPT`) so it re-downloads. 30 s idle timeout, HF 2 attempts. Status errors carry `code`: `OCR_NATIVE_LOAD_FAILED` (Windows: missing VC++ 2015-2022 redist — UI links it), `OCR_MODEL_DOWNLOAD_FAILED`, `OCR_MODEL_CORRUPT`, `OCR_WORKER_FAILED`, `OCR_ERROR`; a later success sends `ready`. `ort.env.logLevel='error'` silences ORT warnings. `MAP_NAME_ROI` lives in `map-detector/rois.js`.
  - Images are fed to the engine raw. `preprocess-map-crop.js` (blur + threshold, tuned for tesseract) was deleted: PaddleOCR reads the untouched crop more accurately and faster. Don't reintroduce it.
  - Confidence is 0-1 (tesseract was 0-100): `EndgameDetector.CONFIDENT_MIN = 0.85`.
  - Roster detection (`lobby-classifier.js`) filters items by shape, not just letter count, because this engine reads HUD/perk labels ("DISTRACTION", "ASSIST") and replay toasts in the same corner: ≥6 letters, ≤4 words, mixed case, confidence ≥0.9, at least 2 such rows.
  - Test with `npm run ocr-test -- <image> [--lang=eng] [--roi=x,y,w,h]` (no Electron needed) for the engine alone, or `npm run detector-test` for the whole detector (state machine → OCR → matcher → `show-map-command` → endgame clear) on scripted frames. That script feeds plain loading-screen frames (to enter HUNTING), then an intro frame = loading screen with the title band pasted and the bottom quarter blanked (no bar — the hunt never OCRs while the bar is up), then the endgame scoreboard; it sets `endgameDetection: true`, otherwise nothing clears.
  - Standalone Electron scripts (`scripts/detector-test.js`) must call `app.setName(<package.json name>)` before using paths, or Electron picks its own app name and the script downloads a second copy of the models into `~/.config/Electron`.
  - `onnxruntime-node`'s native library drops a 51-byte `:memory:.ses` (timestamp + uuid) in the **process CWD** the first time a session is created — expected upstream artefact, harmless (it silently skips the write in a read-only directory), and the reason a stray `:memory:.ses` shows up in the repo root after running the CLI/detector tests.
  - **Packaging**: `onnxruntime-node` ships every platform plus CUDA/TensorRT providers (~548 MB). `package.json` `build.files` excludes the providers, `darwin/**` and the Windows-only DirectML/dxcompiler/dxil DLLs (verified: `onnxruntime.dll` does not statically import them, so CPU inference loads without them), and `asarUnpack` keeps the `.node`/`.so`/`.dll` outside the asar. Exclusions are literal paths on purpose — `${os}`/`${arch}` macros resolve against the **host** platform, which silently emptied the Windows package, and electron-builder already drops `*.so` for Windows targets and `*.dll` for Linux ones. `build.files` also excludes `test/**` (~120 MB fixtures), `*.traineddata`, `:memory:.ses`, `**/*.md` (docs are fetched from GitHub, never read locally). In a combined `-wl` run the module set is searched once, so both packages end up carrying both platforms' (harmless, inert) binaries. Verified with `ELECTRON_RUN_AS_NODE=1 dist/linux-unpacked/<binary> <script>` that the packaged asar + unpacked native libs load.
- **Linux desktop entry**: `build.linux.category` must be a registered freedesktop main category (`Game`, singular). `Games` fails `desktop-file-validate` and AppImage integrators put the app in a catch-all menu section.
- **Renderer packaging**: renderer-only libs (vue, vuetify, @mdi/font, marked, dompurify) are devDependencies — Vite bundles them, so they stay out of the asar. `build.files` excludes `src/renderer/**` and `vite.config.mjs`; `out/renderer` ships. The overlay preview tab shows a canvas sample map (`services/overlay-preview.js`) while `ui.view === 'settings' && ui.settingsTab === 'overlay'` and the page is visible.

## Commands

```bash
yarn start              # Build the renderer (Vite) and run in dev mode
npm run dev:renderer    # Rebuild the renderer on change (run electron . alongside)
# electron-builder 26 needs Node >= 20.19 (require(esm) of @noble/hashes): `nvm use` (.nvmrc = 24). Under 20.15 it dies with ERR_REQUIRE_ESM blake2.js. Or:
npx -y node@22 node_modules/electron-builder/cli.js --linux dir   # unpacked build in dist/linux-unpacked
yarn build              # Build Windows + Linux (calls prebuild.sh first)
yarn build:win          # Windows only
yarn build:linux        # Linux only
node picture-hash.js    # Generate MD5 manifest of all map files
npm test                # node --test test/ (OCR tests skip without models)
npm run ocr-test -- <image> [--lang=eng] [--roi=0.75,0.9]   # OCR on an image, no Electron
npm run detector-test   # end-to-end detector run under Electron, scripted frames
npm run fetch-ocr-models -- [--lang=all] [--out=DIR]   # pre-seed/mirror the OCR models
```

OCR tests need the model files: they use `<userData>/ocr-models` (or `OCR_MODELS_DIR`) and skip with an actionable message when the models are not there yet. Point `OCR_MODELS_DIR` at any populated directory (the dev CLI fills the default one) to run them:

```bash
OCR_MODELS_DIR=/path/to/ocr-models npm test
```

## Adding Maps

1. Add `.png` files under `maps/<Creator>/<Realm>/`.
2. Update `CREDITS.md` if new creator.
3. Run `node picture-hash.js` if hash manifest is needed.
4. Create directory structure matching existing convention (Creator → Realm → map PNGs).

## i18n

Translation JSON files in `src/i18n/`. Keys are map names (English). UI strings are hardcoded in the Vue components — no i18n framework, just lang-specific JSON for map name lookup. Localization tooling in `scripts/localization/`.

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

*Last updated: 2026-10-23*
