const {ipcRenderer} = require('electron');


class Options {
    constructor(settings, images) {
        this.settings = settings;
        this.images = images;
        this.setting = false;
        if (settings.get("draggable") === true) {
            $("#positionLabel").prop("disabled", true);
            $("#dragCheck").prop("checked", true);
        } else {
            $("#set-pos").hide();
        }

        if (settings.get("minimizeToTray") === true) {
            $("#minimizeToTrayCheck").prop("checked", true);
        }

        $("#hiddenCheck").on("input", async function (ev) {
            var input = $(this);
            var val = input.prop('checked');
            await settings.set("hideOverlay", val);
        });
        $("#dragCheck").on("input", async function (ev) {
            var input = $(this);
            var val = input.prop('checked');
            await settings.set("draggable", val);
            if (val) {
                $("#positionLabel").prop("disabled", true);
                $("#set-pos").show();
            } else {
                $("#positionLabel").prop("disabled", false);
                $("#set-pos").hide();
            }
        })
        $("#minimizeToTrayCheck").on("input", async function (ev) {
            var input = $(this);
            var val = input.prop('checked');
            await settings.set("minimizeToTray", val);
        });
        $("#sizeRange").on("input", async function (ev) {
            var input = $(this);
            var val = input.val();
            await settings.set("size", val);
            images.sendMap(images.lastMap, images.lastMapType)
        }).val(settings.get("size"));
        $("#positionLabel").on("input", async function (ev) {
            var input = $(this);
            var val = input.val();
            await settings.set("position", val);
            images.sendMap(images.lastMap, images.lastMapType)
        }).val(settings.get("position"));
        $("#opacityRange").on("input", async function (ev) {
            var input = $(this);
            var val = input.val();
            await settings.set("opacity", val);
            images.sendMap(images.lastMap, images.lastMapType)
        }).val(settings.get("opacity"));

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
    }

}

module.exports = Options;