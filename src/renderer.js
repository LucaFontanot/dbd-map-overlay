const { ipcRenderer } = require('electron');
const axios = require("axios")
const crypto = require("crypto");
const baseUrl = "https://dbdmap.lucaservers.com"
let settings = null;
let lastMap = "";

ipcRenderer.on('shortcut-key-pressed', async (event) => {
    fetchUpdate()
});
function sendMap(map, api = true){
    lastMap = map;
    ipcRenderer.send('map-change', map);
    if (api){
        setApiMap(map)
    }
}
function computeMD5(fileBuffer) {
    const hashSum = crypto.createHash('md5');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
}
async function startUpdate(){
    try{
        let appUpdate =  await axios.get(baseUrl+"/version")
        let version = await ipcRenderer.invoke('version')
        if (version !== appUpdate.data.version){
            var myModal = new bootstrap.Modal(document.getElementById('update'), {
                keyboard: false
            })
            $("#updatelink").attr("href",appUpdate.data.url)
            myModal.show()
        }
        let filesUpdate = await axios.get(baseUrl+"/update")
        let imgs = await ipcRenderer.invoke('get-dir-photos')
        if (filesUpdate.data.length<imgs.length){
            await ipcRenderer.invoke('clear-photos')
        }
        for (let img of imgs){}
        for (let file of filesUpdate.data){
            let photoPath = file.filePath.split("/static/")
            let result = await ipcRenderer.invoke('read-user-data', photoPath[1])
            if (computeMD5(result)!==file.md5){
                let imageBuff = await axios.get(file.filePath+"?t="+file.md5,{
                    responseType:"arraybuffer"
                })
                await ipcRenderer.invoke('write-user-data', photoPath[1],imageBuff.data)
            }
        }
    }catch (e){
        console.log(e)
    }
}
let cacheBlob = {};
async function setImages(filter){
    let imgs = await ipcRenderer.invoke('get-dir-photos')
    $("#results").html("");
    for (let img of imgs){
        if (filter!==""){
            let words = filter.split(" ");
            let valid = false;
            for (let word of words){
                if (img.toString().toLowerCase().includes(word.toString().toLowerCase())){
                    valid=true;
                }
            }
            if (!valid){
                continue;
            }
        }
        let url = "";
        if (cacheBlob.hasOwnProperty(img)){
            url = cacheBlob[img]
        }else{
            let imgData = await ipcRenderer.invoke('read-user-data', img);
            let blob = new Blob([imgData]);
            url = URL.createObjectURL(blob);
            cacheBlob[img] = url;
        }
        $("#results").append(`<div class="col-md-4"><img src="${url}" data-img="${img}" class="img-fluid"/><span>${img.replace(/\\/g, " ").replace(/\//g, " ").split(".")[0]}</span></div>`)
    }
    $("#results img").click(function (ev){
        var input = $(this);
        let img = input.attr("data-img");
        console.log(img)
        sendMap(img)
    })
    $('#overlay').slideUp();
};
(async function(){
    settings = await ipcRenderer.invoke('get-settings');
    await startUpdate()
    $("#searchbar").on("input",function (ev){
        var input = $(this);
        var val = input.val();
        setImages(val)
    })
    $("#sizeRange").on("input",async function (ev){
        var input = $(this);
        var val = input.val();
        settings.size = val;
        await ipcRenderer.invoke('save-settings',settings);
        sendMap(lastMap)
    }).val(settings.size)
    $("#positionLabel").on("input",async function (ev){
        var input = $(this);
        var val = input.val();
        settings.position = val;
        await ipcRenderer.invoke('save-settings',settings)
        sendMap(lastMap)
    }).val(settings.position)
    $("#opacityRange").on("input",async function (ev){
        var input = $(this);
        var val = input.val();
        settings.opacity = val;
        await ipcRenderer.invoke('save-settings',settings)
        sendMap(lastMap)
    }).val(settings.opacity)
    setImages("")

})()
