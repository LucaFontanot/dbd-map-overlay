
async function getFileFormBase64(file) {
    return new Promise(function (resolve) {
        var fileReader = new FileReader();
        fileReader.onload = function () {
            resolve(fileReader.result.split("base64,")[1]);
        };
        fileReader.onerror = function () {
            resolve(false);
        }
        fileReader.readAsDataURL(file.prop('files')[0]);
    })
}

async function resizeImage(buffer) {
    return new Promise(function (resolve) {
        var sharp = require('sharp');
        try {
            sharp(buffer)
                .resize(1920)
                .toBuffer(async (err, buff, info) => {
                    if (err) {
                        return resolve(false);
                    }
                    resolve(buff)
                }).on("error", () => {
                return resolve(false);
            });
        } catch (e) {
            return resolve(false);
        }
    })
}

async function addMapa() {
    const {ipcRenderer} = require("electron");
    $('#overlay').slideDown();
    $("#loadingContent").text("Form check...")
    try {
        if ($("#custom_file").prop('files').length === 0) {
            throw "Missing upload file"
        }
        if ($("#custom_name").val().length === 0) {
            throw "Missing name"
        }
        let imageBase64 = await getFileFormBase64($("#custom_file"));
        if (imageBase64 !== false) {
            let imageBuffer = Buffer.from(imageBase64, "base64")
            let resize = await resizeImage(imageBuffer);
            if (resize!==false){
                let name = $("#custom_name").val()
                name = name.replace(/\//g," ");
                name = name.replace(/\\/g," ");
                name = name.replace(/\./g," ");
                await ipcRenderer.invoke('write-custom-data', name +".png",resize)
                await window.setImages("")
            }
        }
        $("#custom_name").val("")
        $("#custom_file").val("")
    } catch (e) {
        console.log(e)
    }
    $('#overlay').slideUp();
    await window.generateCustoList()
}