const {ipcRenderer} = require("electron");
const {debugLog} = require("./logger");
const {GITHUB_ASSETS, ASSETS_REPO} = require("./consts");
const {logicalMapKeyFromPath, findClosestMapMatch} = require("../core/map-match");
const axios = require("axios");
const crypto = require("crypto");

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
            debugLog("images::remoteUpdateImages::cloud_files", cloud_files.data.length);
            let images = await ipcRenderer.invoke('get-dir-photos')
            debugLog("images::remoteUpdateImages::local_images", images.length);
            // Deletes local images that are not in the cloud
            for (let file of images) {
                let fixWinPath = file.replace(/\\/g, "/")
                let found = false;
                for (let cloud of cloud_files.data) {
                    let photoPath = cloud.filePath.substr(4)
                    if (photoPath === fixWinPath) {
                        found = true;
                    }
                }
                if (found === false) {
                    debugLog("images::remoteUpdateImages::deleting", fixWinPath);
                    await ipcRenderer.invoke('delete-user-data', fixWinPath)
                }
            }
            // Downloads images that are in the cloud but not locally or have a different MD5
            for (let file of cloud_files.data) {
                let title = file.filePath.replace(/\\/g, "/").split("/")
                $("#loadingContent").text("Updating " + title[title.length - 1])
                debugLog("images::remoteUpdateImages::checking", file.filePath);
                let photoPath = file.filePath.substr(5)
                let result = await ipcRenderer.invoke('read-user-data', photoPath)
                if (this.computeMD5(result) !== file.md5) {
                    debugLog("images::remoteUpdateImages::downloading", file.filePath);
                    try {
                        let imageBuff = await axios.get(this.baseUrl + "/" + file.filePath + "?md5=" + file.md5, {
                            responseType: "arraybuffer",
                            timeout: 5000
                        })
                        await ipcRenderer.invoke('write-user-data', photoPath, imageBuff.data)
                    } catch (e) {
                        debugLog("images::remoteUpdateImages::error", e.message);
                    }
                }
            }
        } catch (e) {
            debugLog("images::remoteUpdateImages::error", e.message);
        }
    }

    async init(){
        debugLog("images::init::called");
        const thisRef = this;
        $("#obsOpen").on("click", function (ev) {
            ipcRenderer.send('obs-open');
            thisRef.sendMap(this.lastMap, this.lastMapType)
        })
        $("#hide").on("click", function (ev) {
            thisRef.sendMap("", this.lastMapType)
        })
        $("#searchbar").on("input", function (ev) {
            thisRef.displayImages($(this).val())
        })
        $("#creatorSelect").on("change", async function (ev) {
            const creator = $(this).val();
            await thisRef.displayImages($("#searchbar").val());
            await thisRef.onCreatorLayoutChanged(creator);
        })
        ipcRenderer.on('show-map-command', (event, arg) => {
            this.lastLogicalMapKey = arg;
            let mapIamgePath = this.findClosestMapMatch(arg)
            // A resolved path differing from the preferred creator means the
            // preferred creator has no local copy of this map, so another
            // artist's PNG is being substituted. Surfacing it helps distinguish
            // an out-of-date/incomplete preferred-creator download (the usual
            // cause) from a real matching bug.
            const preferredCreator = (this.settings.get('preferredCreator') || '').trim();
            if (mapIamgePath && preferredCreator) {
                const resolvedCreator = String(mapIamgePath).replace(/\\/g, '/').split('/')[1];
                if (resolvedCreator && resolvedCreator.toLowerCase() !== preferredCreator.toLowerCase()) {
                    debugLog("show-map-command::creator-fallback",
                        `"${arg}" has no ${preferredCreator} copy locally; showing ${resolvedCreator} (${mapIamgePath})`);
                }
            }
            // fromDetector -- without it, main takes this for a manual pick and
            // releases the detector's claim on the overlay right after detection
            const response = this.sendMap(mapIamgePath, "standard", true, true);
            if (response) {
                debugLog("mapCommand::setMap::success", "Map set successfully");
            } else {
                debugLog("mapCommand::setMap::error", "Failed to set map");
            }
        });
        ipcRenderer.on('map-detector-clear', () => {
            this.lastLogicalMapKey = "";
            this.sendMap("", this.lastMapType || "standard", true, true);
        });
    }

    searchMaps(name = '', creator = '') {
        debugLog("images::searchMaps::called", name, creator);
        const results = [];

        const nameLower = name.toLowerCase();
        const creatorLower = creator.toLowerCase();

        const mapDictionary = this.mapDictionary;
        const pathLookup = this.pathLookup;

        Object.entries(mapDictionary).forEach(([cr, realms]) => {
            if (creator && !cr.toLowerCase().includes(creatorLower)) return;

            Object.entries(realms).forEach(([rl, maps]) => {
                maps.forEach(mapName => {
                    const combined = `${mapName} ${rl}`.toLowerCase();

                    if (name && !combined.includes(nameLower)) return;

                    const key = `${cr}/${rl}/${mapName}`;
                    results.push({
                        creator: cr,
                        realm: rl,
                        name: mapName,
                        path: pathLookup[key] || null,
                    });
                });
            });
        });

        return results;
    }

    async loadImages(){
        debugLog("images::loadImages::called");
        $("#loadingContent").text("Generating Cache");
        $('#overlay').slideDown();
        try {
            let imgs = await ipcRenderer.invoke('get-dir-photos')
            let imgs_custom = await ipcRenderer.invoke('get-custom-photos')
            debugLog("images::remoteUpdateImages::checking", imgs_custom.length, imgs.length);
            imgs = imgs_custom.concat(imgs)
            this.mapDictionary = await this.buildMapDictionary(imgs)
            if ($("#creatorSelect option").length === 1) {
                $("#creatorSelect").empty();

                $("#creatorSelect").append(`<option value="">Select Creator</option>`);

                const creators = Object.keys(this.mapDictionary);
                creators.forEach(creator => {
                    $("#creatorSelect").append(`<option value="${creator}">${creator}</option>`);
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
            const parts = path.replace(/\\/g,"/").split("/");

            let creator, realm, mapName;
            if (parts.length < 4) {
                // If the path does not have enough parts, we assume it's a custom map
                creator = "Custom";
                realm = "Custom";
                mapName = parts[1];
            } else {
                creator = parts[1];
                realm = parts[2];
                mapName = parts[3];
            }

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

        const type = this.cacheType[newPath] || "standard";
        debugLog("images::onCreatorLayoutChanged::swap", identity, chosen, newPath);
        await this.sendMap(newPath, type, true, true);
    }


    async invalidateCache() {
        debugLog("images::invalidateCache::called");
        this.mapDictionary = [];
        this.pathLookup = [];
        await this.displayImages($("#searchbar").val())
    }

    async displayImages(filter = "") {
        debugLog("images::displayImages::called", filter)
        if (this.mapDictionary.length === 0) {
            await this.loadImages();
        }
        try{
            $("#results").html("");
            let creator = $("#creatorSelect").val();
            const results = this.searchMaps(filter, creator);
            for (let result of results) {
                const img = result.path;
                if (!img) continue;

                let url = "";
                let type = "standard";

                if (this.cacheBlob.hasOwnProperty(img)) {
                    url = this.cacheBlob[img];
                    type = this.cacheType[img];
                } else {
                    let imgData = await ipcRenderer.invoke('read-user-data', img);
                    if (!imgData || imgData.length === 0) {
                        imgData = await ipcRenderer.invoke('read-custom-data', img);
                        type = "custom";
                    }

                    const blob = new Blob([imgData]);
                    url = URL.createObjectURL(blob);
                    this.cacheBlob[img] = url;
                    this.cacheType[img] = type;
                }
                const mapName = result.name ? result.name.replace(/\.[^/.]+$/, "") : "Unknown Map";
                $("#results").append(`
                    <div class="col-md-4 mb-4 text-center">
                        <img src="${url}" data-img="${img}" class="img-fluid rounded shadow-sm mb-2" data-type="${type}"/>
                        <div class="small">
                            <strong>${mapName}</strong><br/>
                            <span>${result.realm}</span><br/>
                            <em>${result.creator}</em>
                        </div>
                    </div>
                `);
            }

            const thisRef = this;
            $("#results img").click(function (ev) {
                const img = $(this).attr("data-img");
                const type = $(this).attr("data-type");
                thisRef.sendMap(img, type);
            });
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
        if (type === "") return;
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
    }
}

module.exports = Images;