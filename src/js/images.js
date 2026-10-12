const {ipcRenderer} = require("electron");
const {debugLog} = require("./logger");
const {GITHUB_ASSETS, ASSETS_REPO} = require("./consts");
const {logicalMapKeyFromPath, findClosestMapMatch, parseMapPath, foldName, levenshtein} = require("../core/map-match");
const axios = require("axios");
const crypto = require("crypto");
const {escapeHtml} = require("./html");

// Parallel image downloads during the catalog sync.
const DOWNLOAD_CONCURRENCY = 4;

/** `\Creator\Realm\Map.png` / `/Creator/Realm/Map.png` → `Creator/Realm/Map.png` */
function normalizePhotoKey(p) {
    return String(p || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

/** Runs `worker` over `items` with at most `limit` calls in flight. */
async function runLimited(items, limit, worker) {
    let next = 0;
    const runners = [];
    for (let i = 0; i < Math.min(limit, items.length); i++) {
        runners.push((async () => {
            while (next < items.length) {
                const item = items[next++];
                await worker(item);
            }
        })());
    }
    await Promise.all(runners);
}

function foldTokens(str) {
    return foldName(str).split(' ').filter(Boolean);
}

/**
 * Nearest-string scoring for the home gallery search. Every query token must
 * find an approximate match in the candidate's map+realm name tokens; the
 * returned penalty grows with edit distance. Built on map-match's shared
 * foldName + levenshtein (the app's single source of fuzzy name matching).
 * @returns {number|null} penalty (0 = exact) or null when too far / too short.
 */
function fuzzyTokenScore(queryTokens, candidateTokens) {
    let total = 0;
    for (const qt of queryTokens) {
        if (qt.length < 2) return null; // a 1-char token is too weak for fuzzy
        let best = Infinity;
        for (const ct of candidateTokens) {
            let d;
            if (ct === qt) {
                d = 0;
            } else if (ct.length >= 3 && (ct.startsWith(qt) || (qt.length >= 3 && qt.startsWith(ct)))) {
                d = 1; // prefix match (partial word)
            } else {
                const allowed = Math.max(2, Math.floor(Math.max(qt.length, ct.length) * 0.3));
                d = levenshtein(qt, ct);
                if (d > allowed) continue;
            }
            if (d < best) best = d;
        }
        if (!Number.isFinite(best)) return null;
        total += best;
    }
    return total;
}

class Images {

    constructor(api, settings) {
        debugLog("images::constructor::called");
        this.api = api;
        this.settings = settings;
        this.baseUrl = GITHUB_ASSETS + "/" + ASSETS_REPO
        this.lastMap = "";
        this.lastMapCache = "";
        this.lastMapType = "default";
        // Realm/Map identity of the overlay currently shown (from OCR or path).
        // Used to swap creator layouts without losing the detected map.
        this.lastLogicalMapKey = "";
        this.mapDictionary = [];
        this.pathLookup = [];
        this.cacheBlob = {};
        this.cacheType = {};
        // Paths returned by get-custom-photos: the source decides custom vs
        // standard, not whatever the gallery happened to cache.
        this.customPaths = new Set();
        // Bumped on every displayImages call; a run that sees a newer value
        // stops writing to #results (the user typed again meanwhile).
        this.displayGeneration = 0;
        this.lobby = null
        this.options = null;
        this.init();
    }

    setLobby(lobby) {
        this.lobby = lobby;
    }
    setOptions(options) {
        this.options = options;
    }

    computeMD5(fileBuffer) {
        const hashSum = crypto.createHash('md5');
        hashSum.update(fileBuffer);
        return hashSum.digest('hex');
    }

    async remoteUpdateImages() {
        debugLog("images::remoteUpdateImages");
        try{
            let version = await ipcRenderer.invoke('version')
            debugLog("images::remoteUpdateImages::version", version);
            $("#title").text("DBD Map Overlay v" + version)
            let cloud_files = await axios.get(this.baseUrl + "/images.json?t=" + new Date().getTime())
            const cloudList = Array.isArray(cloud_files.data) ? cloud_files.data : [];
            debugLog("images::remoteUpdateImages::cloud_files", cloudList.length);
            let images = await ipcRenderer.invoke('get-dir-photos')
            debugLog("images::remoteUpdateImages::local_images", images.length);
            // Deletes local images that are not in the cloud
            const cloudPaths = new Set(cloudList.map(cloud => normalizePhotoKey(cloud.filePath.substr(4))));
            for (let file of images) {
                let fixWinPath = file.replace(/\\/g, "/")
                if (!cloudPaths.has(normalizePhotoKey(fixWinPath))) {
                    debugLog("images::remoteUpdateImages::deleting", fixWinPath);
                    await ipcRenderer.invoke('delete-user-data', fixWinPath)
                }
            }
            // Main hashes the downloaded photos itself: shipping every file over
            // IPC just to hash it here was the slowest part of startup.
            let localHashes = null;
            try {
                const hashes = await ipcRenderer.invoke('get-photo-hashes');
                localHashes = {};
                for (const [key, md5] of Object.entries(hashes || {})) {
                    localHashes[normalizePhotoKey(key)] = md5;
                }
            } catch (e) {
                debugLog("images::remoteUpdateImages::hashes-error", e.message);
            }
            const toDownload = [];
            for (let file of cloudList) {
                let photoPath = file.filePath.substr(5)
                let localMd5;
                if (localHashes) {
                    localMd5 = localHashes[normalizePhotoKey(photoPath)];
                } else {
                    // Older main without get-photo-hashes: hash locally
                    localMd5 = this.computeMD5(await ipcRenderer.invoke('read-user-data', photoPath));
                }
                if (localMd5 !== file.md5) toDownload.push(file);
            }
            debugLog("images::remoteUpdateImages::to-download", toDownload.length);
            // Downloads images that are in the cloud but not locally or have a different MD5
            await runLimited(toDownload, DOWNLOAD_CONCURRENCY, async (file) => {
                let title = file.filePath.replace(/\\/g, "/").split("/")
                $("#loadingContent").text("Updating " + title[title.length - 1])
                let photoPath = file.filePath.substr(5)
                debugLog("images::remoteUpdateImages::downloading", file.filePath);
                try {
                    let imageBuff = await axios.get(this.baseUrl + "/" + file.filePath + "?md5=" + file.md5, {
                        responseType: "arraybuffer",
                        timeout: 5000
                    })
                    const data = Buffer.from(imageBuff.data);
                    const md5 = this.computeMD5(data);
                    if (md5 !== file.md5) {
                        // Truncated/corrupted download or tampered CDN copy:
                        // keep the local file, retry on the next sync.
                        debugLog("images::remoteUpdateImages::md5-mismatch", file.filePath, md5, file.md5);
                        return;
                    }
                    await ipcRenderer.invoke('write-user-data', photoPath, data)
                } catch (e) {
                    debugLog("images::remoteUpdateImages::error", file.filePath, e.message);
                }
            });
        } catch (e) {
            debugLog("images::remoteUpdateImages::error", e.message);
        }
    }

    async init(){
        debugLog("images::init::called");
        const thisRef = this;
        $("#obsOpen").on("click", function (ev) {
            ipcRenderer.send('obs-open');
            thisRef.sendMap(thisRef.lastMap, thisRef.lastMapType)
        })
        $("#hide").on("click", function (ev) {
            thisRef.sendMap("", thisRef.lastMapType)
        })
        $("#searchbar").on("input", function (ev) {
            thisRef.displayImages($(this).val())
        })
        $("#creatorSelect").on("change", async function (ev) {
            const creator = $(this).val();
            await thisRef.displayImages($("#searchbar").val());
            await thisRef.onCreatorLayoutChanged(creator);
        })
        // Delegated once: the gallery is re-rendered on every search keystroke
        $("#results").on("click", "img", function (ev) {
            const img = $(this).attr("data-img");
            const type = $(this).attr("data-type");
            thisRef.sendMap(img, type);
        });
        ipcRenderer.on('show-map-command', async (event, arg) => {
            let mapIamgePath = this.findClosestMapMatch(arg)
            if (!mapIamgePath) {
                debugLog("show-map-command::no-match", arg);
                return;
            }
            this.lastLogicalMapKey = arg;
            // A resolved path differing from the preferred creator means the
            // preferred creator has no local copy of this map, so another
            // artist's PNG is being substituted. Surfacing it helps distinguish
            // an out-of-date/incomplete preferred-creator download (the usual
            // cause) from a real matching bug.
            const preferredCreator = (this.settings.get('preferredCreator') || '').trim();
            if (preferredCreator) {
                const resolvedCreator = parseMapPath(mapIamgePath)?.creator || '';
                if (resolvedCreator && resolvedCreator.toLowerCase() !== preferredCreator.toLowerCase()) {
                    debugLog("show-map-command::creator-fallback",
                        `"${arg}" has no ${preferredCreator} copy locally; showing ${resolvedCreator} (${mapIamgePath})`);
                }
            }
            // fromDetector -- without it, main takes this for a manual pick and
            // releases the detector's claim on the overlay right after detection
            const response = await this.sendMap(mapIamgePath, this.typeOf(mapIamgePath), true, true);
            if (response) {
                debugLog("mapCommand::setMap::success", "Map set successfully");
            } else {
                debugLog("mapCommand::setMap::error", "Failed to set map");
            }
        });
        // Stream Deck buttons / second-instance `show-map=` args: same payload
        // as show-map-command, but it is the user picking a map, so it must
        // take the overlay over from the detector (fromDetector=false).
        ipcRenderer.on('external-map-command', async (event, arg) => {
            const mapImagePath = this.pathLookup[arg] || this.findClosestMapMatch(arg);
            if (!mapImagePath) {
                debugLog("external-map-command::no-match", arg);
                return;
            }
            const response = await this.sendMap(mapImagePath, this.typeOf(mapImagePath), true, false);
            debugLog(response ? "external-map-command::success" : "external-map-command::error", arg, mapImagePath);
        });
        ipcRenderer.on('map-detector-clear', () => {
            this.lastLogicalMapKey = "";
            this.sendMap("", this.lastMapType || "standard", true, true);
        });
    }

    /** "custom" for files in the custom dir, "standard" for downloaded maps. */
    typeOf(path) {
        return this.customPaths.has(path) ? "custom" : "standard";
    }

    /**
     * Maps a path received from elsewhere (lobby server) onto a local
     * downloaded map file. Separators are normalised so Windows and Linux
     * peers agree. Custom files are never matched.
     * @returns {string|null} local path from pathLookup, or null if unknown
     */
    resolveLocalMapPath(path) {
        if (typeof path !== "string" || path === "") return null;
        const wanted = normalizePhotoKey(path);
        for (const local of Object.values(this.pathLookup)) {
            if (this.customPaths.has(local)) continue;
            if (normalizePhotoKey(local) === wanted) return local;
        }
        return null;
    }

    /** Object URL for a gallery/custom image, read once and cached. */
    async getImageUrl(img, type) {
        if (this.cacheBlob.hasOwnProperty(img)) return this.cacheBlob[img];
        const channel = type === "custom" ? 'read-custom-data' : 'read-user-data';
        const imgData = await ipcRenderer.invoke(channel, img);
        // Another caller may have filled the slot while we were reading
        if (this.cacheBlob.hasOwnProperty(img)) return this.cacheBlob[img];
        const url = URL.createObjectURL(new Blob([imgData]));
        this.cacheBlob[img] = url;
        this.cacheType[img] = type;
        return url;
    }

    /** Drops (and revokes) cached object URLs, all of them or those matching `predicate`. */
    dropCachedImages(predicate = () => true) {
        for (const img of Object.keys(this.cacheBlob)) {
            if (!predicate(img)) continue;
            URL.revokeObjectURL(this.cacheBlob[img]);
            delete this.cacheBlob[img];
            delete this.cacheType[img];
        }
    }

    searchMaps(name = '', creator = '') {
        debugLog("images::searchMaps::called", name, creator);
        const creatorLower = creator.toLowerCase();

        // Substring hits (legacy behaviour) come first, then fuzzy "did you mean"
        // results sorted by how close each map's name is to the query.
        const queryTokens = foldTokens(name);
        const fuzzy = queryTokens.length > 0;

        const mapDictionary = this.mapDictionary;
        const pathLookup = this.pathLookup;
        const matches = [];

        Object.entries(mapDictionary).forEach(([cr, realms]) => {
            if (creator && !cr.toLowerCase().includes(creatorLower)) return;

            Object.entries(realms).forEach(([rl, maps]) => {
                maps.forEach(mapName => {
                    const key = `${cr}/${rl}/${mapName}`;
                    const direct = !fuzzy || foldName(`${mapName} ${rl}`).includes(foldName(name));

                    let score = null;
                    if (!direct) {
                        const candidateTokens = [
                            ...foldTokens(parseMapPath(mapName)?.base || mapName),
                            ...foldTokens(rl),
                        ];
                        score = fuzzyTokenScore(queryTokens, candidateTokens);
                    }
                    if (!direct && score === null) return;

                    matches.push({
                        item: {
                            creator: cr,
                            realm: rl,
                            name: mapName,
                            path: pathLookup[key] || null,
                        },
                        // Substring hits rank above fuzzy ones (0); stable sort keeps
                        // their original insertion order among equal scores.
                        score: direct ? 0 : score,
                    });
                });
            });
        });

        if (!fuzzy) return matches.map(m => m.item);
        return matches.sort((a, b) => a.score - b.score).map(m => m.item);
    }

    async loadImages(){
        debugLog("images::loadImages::called");
        $("#loadingContent").text("Generating Cache");
        $('#overlay').slideDown();
        try {
            let imgs = await ipcRenderer.invoke('get-dir-photos')
            let imgs_custom = await ipcRenderer.invoke('get-custom-photos')
            debugLog("images::remoteUpdateImages::checking", imgs_custom.length, imgs.length);
            this.customPaths = new Set(imgs_custom);
            imgs = imgs_custom.concat(imgs)
            this.mapDictionary = await this.buildMapDictionary(imgs)
            // Files that disappeared (deleted custom maps, removed catalog
            // entries) must not keep their blob alive.
            const present = new Set(imgs);
            this.dropCachedImages(img => !present.has(img));
            if ($("#creatorSelect option").length === 1) {
                $("#creatorSelect").empty();

                $("#creatorSelect").append(`<option value="">Select Creator</option>`);

                const creators = Object.keys(this.mapDictionary);
                creators.forEach(creator => {
                    $("#creatorSelect").append(`<option value="${escapeHtml(creator)}">${escapeHtml(creator)}</option>`);
                });
                if (this.options) this.options.populatePreferredCreators(creators);
                const preferred = this.settings.get('preferredCreator');
                if (preferred) $("#creatorSelect").val(preferred);
            }
        }catch (e){
            debugLog("images::loadImages::error", e.message);
        }finally {
            $('#overlay').slideUp();
            $("#loadingContent").text("");
        }
    }

    async buildMapDictionary(paths) {
        const result = {};
        const pathLookup = this.pathLookup
        paths.forEach(path => {
            // Creator/Realm/Map parsing lives in map-match.js (single source).
            // Paths with < 3 segments are custom maps → bucketed under Custom.
            const parsed = parseMapPath(path);
            if (!parsed) return;
            const {creator, realm, map: mapName} = parsed;

            if (!result[creator]) result[creator] = {};
            if (!result[creator][realm]) result[creator][realm] = [];
            result[creator][realm].push(mapName);

            const key = `${creator}/${realm}/${mapName}`;
            pathLookup[key] = path
        });

        return result;
    }

    findClosestMapMatch(mapKey, creatorOverride, opts) {
        const preferred = creatorOverride !== undefined
            ? creatorOverride
            : (this.settings.get('preferredCreator') || '');
        return findClosestMapMatch(mapKey, this.pathLookup, preferred, opts);
    }

    /**
     * Swap the overlay to the same realm/map in `creator`'s layout without
     * stopping the detector. Does not write preferredCreator — the home
     * dropdown is a per-match overlay pick; Settings owns the saved default.
     */
    async onCreatorLayoutChanged(creator) {
        const chosen = creator || '';

        if (!chosen) return;

        const identity = this.lastLogicalMapKey
            || logicalMapKeyFromPath(this.lastMap)
            || logicalMapKeyFromPath(this.lastMapCache);
        if (!identity) {
            debugLog("images::onCreatorLayoutChanged::no-identity", this.lastMap);
            return;
        }

        const newPath = this.findClosestMapMatch(identity, chosen, {fallback: false});
        if (!newPath) {
            debugLog("images::onCreatorLayoutChanged::no-layout", chosen, identity);
            return;
        }

        // Overlay hidden (Ctrl+H): retarget the cache so unhide uses the new layout.
        if (!this.lastMap) {
            this.lastMapCache = newPath;
            return;
        }
        if (newPath === this.lastMap) return;

        const type = this.typeOf(newPath);
        debugLog("images::onCreatorLayoutChanged::swap", identity, chosen, newPath);
        await this.sendMap(newPath, type, true, true);
    }


    async invalidateCache() {
        debugLog("images::invalidateCache::called");
        this.mapDictionary = [];
        this.pathLookup = [];
        // Custom files can be overwritten under the same name: never reuse their blobs
        this.dropCachedImages(img => this.customPaths.has(img));
        await this.displayImages($("#searchbar").val())
    }

    async displayImages(filter = "") {
        debugLog("images::displayImages::called", filter)
        const generation = ++this.displayGeneration;
        if (this.mapDictionary.length === 0) {
            await this.loadImages();
        }
        if (generation !== this.displayGeneration) return;
        try{
            let creator = $("#creatorSelect").val();
            const results = this.searchMaps(filter, creator);
            const html = [];
            for (let result of results) {
                const img = result.path;
                if (!img) continue;

                const type = this.typeOf(img);
                const url = await this.getImageUrl(img, type);
                // A newer search started while we were reading files
                if (generation !== this.displayGeneration) return;
                const mapName = result.name ? result.name.replace(/\.[^/.]+$/, "") : "Unknown Map";
                html.push(`
                    <div class="col-md-4 mb-4 text-center">
                        <img src="${escapeHtml(url)}" data-img="${escapeHtml(img)}" class="img-fluid rounded shadow-sm mb-2" data-type="${escapeHtml(type)}" loading="lazy" decoding="async"/>
                        <div class="small">
                            <strong>${escapeHtml(mapName)}</strong><br/>
                            <span>${escapeHtml(result.realm)}</span><br/>
                            <em>${escapeHtml(result.creator)}</em>
                        </div>
                    </div>
                `);
            }
            $("#results").html(html.join(""));
        }catch (e){
            debugLog("images::displayImages::error", e.message);
        }
    }

    async sendMap(map, type, api = true, fromDetector = false) {
        if (this.options && this.options.setting) {
            $("#unset-pos").click();
        }
        if (map !== "") {
            this.lastMapCache = map;
            // Detector already stored the English Realm/Map key. Keep it so
            // later creator swaps match against the canonical name, not an
            // artist-specific filename (`Coal Tower 1 - Istari`).
            if (!fromDetector) {
                const fromPath = logicalMapKeyFromPath(map);
                if (fromPath) this.lastLogicalMapKey = fromPath;
            }
        }
        if (type === "") return false;
        this.lastMap = map;
        this.lastMapType = type;
        ipcRenderer.send('map-change', map, { fromDetector });
        // A map arriving mid-preview (detector, lobby) must not replace the
        // sample map on screen -- it is recorded above and re-covered here.
        if (this.options && this.options.previewActive) this.options.sendPreview();
        if (api) {
            if (type === "custom") {
                let data = await ipcRenderer.invoke('read-custom-data', map);
                await this.lobby.setMap(Buffer.from(data).toString("base64"), type)
            } else {
                await this.lobby.setMap(map, type)
            }
        }
        return true;
    }
}

module.exports = Images;