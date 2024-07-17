const {ipcRenderer} = require('electron');
const axios = require("axios")
const crypto = require("crypto");
const marked = require("marked");

const baseUrl = "https://dbdmap.lucaservers.com"
//const baseUrl = "http://localhost:4444"
let settings = null;
let lastMap = "";
let lastMapType = "standard"
let setting = false;
ipcRenderer.on('shortcut-key-pressed', async (event) => {
    fetchUpdate()
});

let timeoutHide = null;

ipcRenderer.on("update-message", async (event, message) => {
    $("#logStatus").text(message).slideDown();
    if (timeoutHide !== null) {
        clearTimeout(timeoutHide);
    }
    timeoutHide = setTimeout(function () {
        $("#logStatus").slideUp();
        timeoutHide = null;
    }, 5000);
});
var cacheBlob = {};
var cacheType = {};
async function sendMap(map, type, api = true) {
    if (setting) {
        $("#unset-pos").click();
    }
    if (type=== "") return;
    lastMap = map;
    lastMapType = type;
    ipcRenderer.send('map-change', map);
    if (api) {
        if (type==="custom"){
            let data = await ipcRenderer.invoke('read-custom-data', map);
            setApiMap(Buffer.from(data).toString("base64"),type)
        }else{
            setApiMap(map,type)
        }
    }
}

function computeMD5(fileBuffer) {
    const hashSum = crypto.createHash('md5');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
}

function checkVersion(cur,lat){
    if(cur.length !== lat.length){
        return true;
    }
    for (let i = 0; i < cur.length; i++) {
        if (parseInt(cur[i]) < parseInt(lat[i])) {
            return true;
        }
    }
    return false;
}

async function startUpdate() {
    try {
        let version = await ipcRenderer.invoke('version')
        $("#title").text("DBD Map Overlay v" + version)
        let filesUpdate = await axios.get(baseUrl + "/update")
        let imgs = await ipcRenderer.invoke('get-dir-photos')
        for (let file of imgs) {
            let fixWinPath = file.replace(/\\/g, "/")
            let found = false;
            for (let cloud of filesUpdate.data) {
                let photoPath = cloud.filePath.split("/static")
                if (photoPath[1] === fixWinPath) {
                    found = true;
                }
            }
            if (found === false) {
                await ipcRenderer.invoke('delete-user-data', fixWinPath)
            }
        }
        for (let file of filesUpdate.data) {
            let log = file.filePath.replace(/\\/g, "/").split("/")
            $("#loadingContent").text("Updating " + log[log.length - 1])
            let photoPath = file.filePath.split("/static/")
            let result = await ipcRenderer.invoke('read-user-data', photoPath[1])
            if (computeMD5(result) !== file.md5) {
                try{
                    let imageBuff = await axios.get(file.filePath + "?t=" + file.md5, {
                        responseType: "arraybuffer",
                        timeout: 5000
                    })
                    await ipcRenderer.invoke('write-user-data', photoPath[1], imageBuff.data)
                }catch (e){
                    console.warn("Error downloading file: " + file.filePath)
                }
            }
        }
    } catch (e) {
        console.log(e)
    }
}


async function deleteImage(img){
    var input = $(img);
    let src = input.attr("data-img");
    await ipcRenderer.invoke('delete-custom-data', src)
    await setImages("")
    await generateCustoList()
}
async function generateCustoList(){
    $("#customList").html("");
    let imgs_custom = await ipcRenderer.invoke('get-custom-photos')
    for (let img of imgs_custom) {
        let url = cacheBlob[img.toString()];
        let type = cacheType[img];
        if (type === "custom") {
            $("#customList").append(`<tr>
                <td><img class="mr-3" style="width: 300px" src="${url}"></td>
                <td>
                    <button type="button" class="ma-5 btn btn-danger" onclick="deleteImage(this)" data-img="${img}"  >Delete</button>
                </td>
            </tr>`)
        }
    }
}
async function setImages(filter) {
    let imgs = await ipcRenderer.invoke('get-dir-photos')
    let imgs_custom = await ipcRenderer.invoke('get-custom-photos')

    $("#results").html("");
    $("#loadingContent").text("Generating Cache")
    imgs = imgs_custom.concat(imgs)
    for (let img of imgs) {
        if (filter !== "") {
            let words = filter.split(" ");
            let valid = false;
            for (let word of words) {
                if (img.toString().toLowerCase().includes(word.toString().toLowerCase())) {
                    valid = true;
                }
            }
            if (!valid) {
                continue;
            }
        }
        let url = "";
        let type = "standard";
        if (cacheBlob.hasOwnProperty(img)) {
            url = cacheBlob[img]
            type = cacheType[img]
        } else {
            let imgData = await ipcRenderer.invoke('read-user-data', img);
            if (imgData.length === 0) {
                imgData = await ipcRenderer.invoke('read-custom-data', img);
                type = "custom";
            }
            let blob = new Blob([imgData]);
            url = URL.createObjectURL(blob);
            cacheBlob[img] = url;
            cacheType[img] = type;
        }
        $("#results").append(`<div class="col-md-4"><img src="${url}" data-img="${img}" class="img-fluid" data-type="${type}"/><span>${img.replace(/\\/g, " ").replace(/\//g, " ").split(".")[0]}</span></div>`)
    }
    $("#results img").click(function (ev) {
        var input = $(this);
        let img = input.attr("data-img");
        let type = input.attr("data-type");
        sendMap(img,type)
    })
    $("#loadingContent").text("")
    $('#overlay').slideUp();
};

async function setPrivacy() {
    try {
        let privacy = await axios.get("https://raw.githubusercontent.com/LucaFontanot/dbd-map-overlay/main/TERMS%20AND%20PRIVACY.md")
        $("#modalPrivacyContent").html(marked.parse(privacy.data))
        let faq = await axios.get("https://raw.githubusercontent.com/LucaFontanot/dbd-map-overlay/main/FAQ.md")
        $("#faqModalContent").html(marked.parse(faq.data))
    } catch (e) {}
};

(async function () {
    settings = await ipcRenderer.invoke('get-settings');
    if (settings.token === "") {
        try{
            let token = await axios.get(baseUrl + "/api/register", {
                responseType:"json"
            })
            settings.token = token.data.token;
            settings.id = token.data.id;
            await ipcRenderer.invoke('save-settings', settings)
        }catch (e){
            console.log(e)
        }
    }
    if (settings.draggable=== true) {
        $("#positionLabel").prop("disabled", true);
        $("#dragCheck").prop("checked", true);
    }else{
        $("#set-pos").hide();
    }
    await startUpdate()
    $("#hiddenCheck").on("input", async function (ev) {
        var input = $(this);
        var val = input.prop('checked');
        settings.hideOverlay = val;
        await ipcRenderer.invoke('save-settings', settings)

    });
    $("#dragCheck").on("input", async function (ev) {
        var input = $(this);
        var val = input.prop('checked');
        settings.draggable = val;
        if (val) {
            $("#positionLabel").prop("disabled", true);
            $("#set-pos").show();
        }else{
            $("#positionLabel").prop("disabled", false);
            $("#set-pos").hide();
        }
        await ipcRenderer.invoke('save-settings', settings)
    })
    $("#searchbar").on("input", function (ev) {
        var input = $(this);
        var val = input.val();
        setImages(val)
    })
    $("#sizeRange").on("input", async function (ev) {
        var input = $(this);
        var val = input.val();
        settings.size = val;
        await ipcRenderer.invoke('save-settings', settings);
        sendMap(lastMap,lastMapType)
    }).val(settings.size)
    $("#positionLabel").on("input", async function (ev) {
        var input = $(this);
        var val = input.val();
        settings.position = val;
        await ipcRenderer.invoke('save-settings', settings)
        sendMap(lastMap,lastMapType)
    }).val(settings.position)
    $("#opacityRange").on("input", async function (ev) {
        var input = $(this);
        var val = input.val();
        settings.opacity = val;
        await ipcRenderer.invoke('save-settings', settings)
        sendMap(lastMap,lastMapType)
    }).val(settings.opacity)
    $("#obsOpen").on("click", function (ev) {
        ipcRenderer.send('obs-open');
        sendMap(lastMap,lastMapType)
    })
    $("#hide").on("click", function (ev) {
        sendMap("",lastMapType)
    })
    $("#set-pos").on("click", function (ev) {
        ipcRenderer.send('set-mouse-drag',true);
        $("#unset-pos").show();
        $("#set-pos").hide();
        setting = true;
    })
    $("#unset-pos").on("click", function (ev) {
        ipcRenderer.send('set-mouse-drag',false);
        $("#unset-pos").hide();
        $("#set-pos").show();
        setting = false;
    })
    await setImages("")
    await generateCustoList()
    await setPrivacy()
    setTimeout(function () {
        $('#warning').slideUp();
    }, 10000);
})()
