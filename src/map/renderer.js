const { ipcRenderer } = require('electron');
let url = null;
ipcRenderer.on('map-change', async (event, img, size,opacity) => {
    if (url!==null){
        URL.revokeObjectURL(url)
    }
    let imgData = Buffer.from(img,"base64");
    let blob = new Blob([imgData]);
    url = URL.createObjectURL(blob);
    $("#mainImg").attr("src",url).css({
        "width":size+"px",
        "opacity": opacity
    })

});