const {ipcRenderer} = require('electron');
const {buildPreviewImage} = require('./overlay-preview');
const {presetToGlide} = require('../core/overlay-position');
const isWayland = require('../core/is-wayland');


class Options {
    constructor(settings, images) {
        this.settings = settings;
        this.images = images;
        this.setting = false;
        this.previewActive = false;
        const classInstance = this;
        // Re-send whatever the overlay should currently show: the sample map
        // while the Overlay tab previews settings, the real map otherwise.
        const refreshOverlay = () => {
            if (classInstance.previewActive) {
                classInstance.sendPreview();
            } else {
                images.sendMap(images.lastMap, images.lastMapType);
            }
        };
        if (settings.get("draggable") === true) {
            $("#positionLabel").prop("disabled", true);
            $("#glideXRange, #glideYRange, #glideReset").prop("disabled", true);
            $("#dragCheck").prop("checked", true);
        } else {
            $("#set-pos").hide();
        }

        // The env vars survive the x11 relaunch (see index.js), so this still
        // detects the real session type
        if (isWayland()) {
            $("#waylandWarning").removeClass("d-none");
        }

        if (settings.get("minimizeToTray") === true) {
            $("#minimizeToTrayCheck").prop("checked", true);
        }

        if (settings.get("hideOverlay") === true) {
            $("#hiddenCheck").prop("checked", true);
        }

        if (settings.get("position") !== null) {
            $("#positionLabel").val(settings.get("position"));
        }

        if (settings.get("size") !== null) {
            $("#sizeRange").val(settings.get("size"));
        }

        if (settings.get("opacity") !== null) {
            $("#opacityRange").val(settings.get("opacity"));
        }

        ipcRenderer.invoke('get-displays').then(displays => {
            const select = $("#monitorSelect");
            select.empty();
            displays.forEach(d => {
                select.append(`<option value="${d.index}">${d.label}</option>`);
            });
            const saved = settings.settings['monitor'];
            select.val(saved !== null && saved !== undefined ? saved : 0);
        });

        if (settings.get("disableFaqPopup") !== null) {
            $("#disableFaqPopupCheck").prop("checked", true);
        }

        if (settings.get("mapDetection") === true) {
            $("#mapDetectionCheck").prop("checked", true);
            // The automatic detection loop itself is started at app launch
            // (see index.js), not here -- this just syncs the checkbox UI.
        }

        const savedLang = settings.get("ocrLanguage") || 'all';
        $("#ocrLanguageSelect").val(savedLang);

        const savedCreator = settings.get("preferredCreator") || '';
        $("#preferredCreatorSelect").val(savedCreator);

        $("#detectInCustomsCheck").prop("checked", settings.get("detectInCustoms") !== false);

        $("#hiddenCheck").on("input", async function (ev) {
            var input = $(this);
            var val = input.prop('checked');
            await settings.set("hideOverlay", val);
            if (classInstance.previewActive) classInstance.sendPreview();
        });
        $("#dragCheck").on("input", async function (ev) {
            var input = $(this);
            var val = input.prop('checked');
            await settings.set("draggable", val);
            if (val) {
                $("#positionLabel").prop("disabled", true);
                $("#glideXRange, #glideYRange, #glideReset").prop("disabled", true);
                $("#set-pos").show();
            } else {
                $("#positionLabel").prop("disabled", false);
                $("#glideXRange, #glideYRange, #glideReset").prop("disabled", false);
                $("#set-pos").hide();
            }
            if (classInstance.previewActive) classInstance.sendPreview();
        })
        $("#minimizeToTrayCheck").on("input", async function (ev) {
            var input = $(this);
            var val = input.prop('checked');
            await settings.set("minimizeToTray", val);
        });
        $("#disableFaqPopupCheck").on("input", async function (ev) {
            var input = $(this);
            var val = input.prop('checked');
            await settings.set("disableFaqPopup", val);
        });
        $("#mapDetectionCheck").on("input", async function (ev) {
            var val = $(this).prop('checked');
            if (val) {
                const ocrLang = settings.get("ocrLanguage") || 'all';
                if (ocrLang === 'all') {
                    // Require the user to pick a game language before enabling detection.
                    // Using all-langs is slow and error-prone — single-language OCR is faster
                    // and more accurate.
                    $(this).prop('checked', false);
                    const modal = new bootstrap.Modal(document.getElementById('languageRequiredModal'));
                    modal.show();
                    return;
                }
                await settings.set("mapDetection", true);
                await ipcRenderer.invoke('map-detector-start-automatic');
            } else {
                await settings.set("mapDetection", false);
                await ipcRenderer.invoke('map-detector-stop-automatic');
            }
        });
        async function restartDetectionIfRunning() {
            const running = await ipcRenderer.invoke('map-detector-status');
            if (running) {
                await ipcRenderer.invoke('map-detector-stop-automatic');
                await ipcRenderer.invoke('map-detector-start-automatic');
            }
        }

        $("#ocrLanguageSelect").on("input", async function (ev) {
            const lang = $(this).val();
            await settings.set("ocrLanguage", lang);
            // If user switches from 'all' to a specific language while mapDetection
            // is enabled but detection never started (blocked by language check),
            // start it now.
            if (lang !== 'all' && settings.get("mapDetection")) {
                const running = await ipcRenderer.invoke('map-detector-status');
                if (!running) {
                    await ipcRenderer.invoke('map-detector-start-automatic');
                    return;
                }
            }
            await restartDetectionIfRunning();
        });
        $("#preferredCreatorSelect").on("input", async function (ev) {
            await settings.set("preferredCreator", $(this).val());
            await restartDetectionIfRunning();
        });
        $("#detectInCustomsCheck").on("input", async function (ev) {
            await settings.set("detectInCustoms", $(this).prop('checked'));
        });
        // Language-required dialog: save language, sync the settings-tab select,
        // enable detection, and close the modal.
        $("#languageRequiredConfirm").on("click", async function () {
            const lang = $("#languageRequiredSelect").val();
            await settings.set("ocrLanguage", lang);
            $("#ocrLanguageSelect").val(lang);
            await settings.set("mapDetection", true);
            $("#mapDetectionCheck").prop('checked', true);
            await ipcRenderer.invoke('map-detector-start-automatic');
            bootstrap.Modal.getInstance(document.getElementById('languageRequiredModal')).hide();
        });
        $("#sizeRange").on("input", async function (ev) {
            var input = $(this);
            var val = input.val();
            await settings.set("size", val);
            refreshOverlay()
        }).val(settings.get("size"));
        // The corner preset doubles as a glide shortcut: picking a corner snaps
        // both sliders to it, then they can fine-tune from there
        const snapGlideToPreset = async () => {
            const corner = presetToGlide(settings.get("position"));
            $("#glideXRange").val(corner.x);
            $("#glideYRange").val(corner.y);
            await settings.set("glideX", corner.x);
            await settings.set("glideY", corner.y);
        };
        $("#positionLabel").on("input", async function (ev) {
            var input = $(this);
            var val = input.val();
            await settings.set("position", val);
            await snapGlideToPreset();
            refreshOverlay()
        }).val(settings.get("position"));
        $("#opacityRange").on("input", async function (ev) {
            var input = $(this);
            var val = input.val();
            await settings.set("opacity", val);
            refreshOverlay()
        }).val(settings.get("opacity"));
        // Snap any stored value to the nearest quarter turn in case a stray
        // rotation ever got saved (e.g. via an older build)
        const savedRotation = (Math.round((parseInt(settings.get("rotation"), 10) || 0) / 90) * 90) % 360;
        $("#rotationSelect").on("input", async function (ev) {
            await settings.set("rotation", parseInt($(this).val(), 10) || 0);
            refreshOverlay()
        }).val(String(savedRotation));
        $("#monitorSelect").on("input", async function (ev) {
            var input = $(this);
            var val = parseInt(input.val(), 10);
            await settings.set("monitor", val);
            refreshOverlay();
        });
        // Raw settings access: the get() wrapper turns a saved 0 into null,
        // which here must mean "unset -- follow the corner preset" only
        const initialCorner = presetToGlide(settings.get("position"));
        const savedGlideX = settings.settings['glideX'];
        const savedGlideY = settings.settings['glideY'];
        $("#glideXRange").on("input", async function (ev) {
            await settings.set("glideX", parseInt($(this).val(), 10) || 0);
            refreshOverlay();
        }).val(savedGlideX !== null && savedGlideX !== undefined ? savedGlideX : initialCorner.x);
        $("#glideYRange").on("input", async function (ev) {
            await settings.set("glideY", parseInt($(this).val(), 10) || 0);
            refreshOverlay();
        }).val(savedGlideY !== null && savedGlideY !== undefined ? savedGlideY : initialCorner.y);
        $("#glideReset").on("click", async function (ev) {
            await snapGlideToPreset();
            refreshOverlay();
        });

        $("#set-pos").on("click", function (ev) {
            ipcRenderer.send('set-mouse-drag', true);
            $("#unset-pos").show();
            $("#set-pos").hide();
            this.setting = true;
        })
        $("#unset-pos").on("click", function (ev) {
            ipcRenderer.send('set-mouse-drag', false);
            $("#unset-pos").hide();
            $("#set-pos").show();
            this.setting = false;
        })
        if (settings.get("disableFaqPopup") !== true || settings.get("disableFaqPopup") === null) {
            $("#warning").removeClass("d-none").addClass("show").slideDown();
        }

        // Sample-map preview lifecycle: visible only while the Overlay tab is the
        // active tab of an open settings modal. Native listeners on purpose --
        // Bootstrap 5 dispatches these as native events, jQuery's .on() would
        // treat ".bs.tab" as an event namespace and never fire.
        const overlayTab = document.getElementById('overlay-tab');
        const settingsModal = document.getElementById('settings');
        overlayTab.addEventListener('shown.bs.tab', () => classInstance.startPreview());
        overlayTab.addEventListener('hidden.bs.tab', () => classInstance.stopPreview());
        settingsModal.addEventListener('shown.bs.modal', () => {
            // Bootstrap keeps the last active tab across modal open/close
            if (overlayTab.classList.contains('active')) classInstance.startPreview();
        });
        settingsModal.addEventListener('hide.bs.modal', () => classInstance.stopPreview());
        // Covers minimize-to-tray and plain minimize: the settings modal stays
        // "open" in the hidden window, but the sample map must leave the overlay.
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                classInstance.stopPreview();
            } else if (settingsModal.classList.contains('show') && overlayTab.classList.contains('active')) {
                classInstance.startPreview();
            }
        });
    }

    startPreview() {
        this.previewActive = true;
        this.sendPreview();
    }

    async sendPreview() {
        const img = await buildPreviewImage();
        // The tab may have been left while the sample map was still rendering
        if (!this.previewActive) return;
        ipcRenderer.send('map-change', img, {preview: true});
    }

    stopPreview() {
        if (!this.previewActive) return;
        this.previewActive = false;
        // Put the overlay back to whatever it showed before the preview
        ipcRenderer.send('map-change', this.images.lastMap || "", {preview: true});
    }

    populatePreferredCreators(creators) {
        const select = $("#preferredCreatorSelect");
        const current = select.val();
        select.empty().append(`<option value="">Any Creator</option>`);
        creators.forEach(c => select.append(`<option value="${c}">${c}</option>`));
        select.val(current || this.settings.get("preferredCreator") || '');
    }
}

module.exports = Options;