const { ipcRenderer } = require('electron');
let url = null;
ipcRenderer.on('map-change', async (event, img, size) => {
    if (url !== null) {
        URL.revokeObjectURL(url)
        url = null
    }
    // img is the raw image bytes (Uint8Array); an empty payload means hidden
    // and yields an empty, unrenderable blob just like the old empty base64 string.
    let blob = new Blob([img]);
    url = URL.createObjectURL(blob);
    $("#mainImg").attr("src",url).css({
        "width":size+"px",
    })


});

ipcRenderer.on('map-hide', async (event) => {
    $("#mainImg").css({
        "width":"0px",
    })
});
