const {ipcRenderer} = require("electron");
const {debugLog} = require("./logger");
const {escapeHtml} = require("./html");

class Custom {

    constructor(images) {
        debugLog("custom::constructor::called");
        this.images = images;
    }

    async getFileFormBase64(file) {
        debugLog("custom::getFileFormBase64::called", file.prop('files').length);
        return new Promise(function (resolve) {
            var fileReader = new FileReader();
            fileReader.onload = function () {
                resolve(fileReader.result.split("base64,")[1]);
            };
            fileReader.onerror = function (e) {
                debugLog("custom::getFileFormBase64::error", e.message);
                resolve(false);
            }
            fileReader.readAsDataURL(file.prop('files')[0]);
        })
    }

    async addCustomMap() {
        debugLog("custom::addCustomMap::called");
        $('#overlay').slideDown();
        $("#loadingContent").text("Saving...")
        try {
            if ($("#custom_file").prop('files').length === 0) {
                throw "Missing upload file"
            }
            if ($("#custom_name").val().length === 0) {
                throw "Missing name"
            }
            let imageBase64 = await this.getFileFormBase64($("#custom_file"));
            if (imageBase64 !== false) {
                let imageBuffer = Buffer.from(imageBase64, "base64")
                let name = $("#custom_name").val()
                name = name.replace(/\//g, " ");
                name = name.replace(/\\/g, " ");
                name = name.replace(/\./g, " ");
                await ipcRenderer.invoke('write-custom-data', name + ".png", imageBuffer)
                await this.images.invalidateCache()
            } else {
                throw "Invalid image"
            }
            $("#custom_name").val("")
            $("#custom_file").val("")
            await this.generateCustomList()
        } catch (e) {
            debugLog("custom::addCustomMap::error", e);
            alert("Error: " + e);
        } finally {
            $('#overlay').slideUp();
        }
    }

    async deleteCustomMap(name) {
        debugLog("custom::deleteCustomMap::called", name);
        try {
            if (name.length === 0) {
                throw "Missing name"
            }
            await ipcRenderer.invoke('delete-custom-data', name)
            await this.images.invalidateCache()
            await this.generateCustomList()
        } catch (e) {
            debugLog("custom::deleteCustomMap::error", e);
            alert("Error: " + e);
        }
    }

    async generateCustomList() {
        debugLog("custom::generateCustomList::called");
        try {
            // Every file in the custom dir is listed, whether or not the gallery
            // has rendered (and cached) it for the selected creator.
            let images_custom = await ipcRenderer.invoke('get-custom-photos')
            const rows = [];
            for (let img of images_custom) {
                let url = await this.images.getImageUrl(img, "custom");
                rows.push(`<tr>
                        <td>
                            <img class="mr-3" style="width: 300px" src="${escapeHtml(url)}" loading="lazy" decoding="async">
                        </td>
                        <td>
                            <button type="button" class="ma-5 btn btn-danger" onclick="deleteImage(this)" data-img="${escapeHtml(img)}"  >Delete</button>
                        </td>
                    </tr>`)
            }
            $("#customList").html(rows.join(""));
        } catch (e) {
            debugLog("custom::generateCustomList::error", e.message);
        }
    }
}

module.exports = Custom;