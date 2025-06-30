const {ipcRenderer} = require('electron');

const API = require("./js/api.js");
const Settings = require("./js/settings.js");
const Lobby = require("./js/lobby.js");
const Custom = require("./js/custom.js");
const Privacy = require("./js/privacy.js");
const {BASEURL} = require("./js/consts");
const Images = require("./js/images.js");
const Options = require("./js/options.js");

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

/**
 * Backend API instance for interacting with the DBD Map Overlay API.
 * @type {API}
 */
const api = new API(BASEURL);

/**
 * Settings instance for managing user preferences and settings.
 * @type {Settings}
 */
const settings = new Settings(api);

/**
 * Images instance for handling the main view
 * @type {Images}
 */
const images = new Images(api, settings);

/**
 * Lobby instance for managing the lobby state and interactions.
 * @type {Lobby}
 */
const lobby = new Lobby(api, settings, images);
images.setLobby(lobby);

/**
 * Options instance for managing overlay options and configurations.
 * @type {Options}
 */
const options = new Options(settings, images);
images.setOptions(options);

/**
 * Privacy instance for managing privacy settings and data handling.
 * @type {Privacy}
 */
const privacy = new Privacy();

/**
 * Custom instance for handling custom map uploads and management.
 * @type {Custom}
 */
const custom = new Custom(images);


(async function () {
    await images.remoteUpdateImages()
    await images.displayImages("")
    await custom.generateCustomList()
    setTimeout(function () {
        $('#warning').slideUp();
    }, 10000);
})();

/**
 * Creates a new lobby using the Lobby instance.
 */
window.createLobby = function (){
    lobby.createLobby()
}

/**
 * Hides or shows the lobby code in the input field.
 */
window.toggleHide = function (){
    lobby.toggleCode()
}

/**
 * Joins an existing lobby using the Lobby instance.
 */
window.joinLobby = function (){
    lobby.joinLobby()
}

/**
 * Sets the current lobby status using the Lobby instance.
 * @param {boolean} status - The status to set for the lobby (true for open, false for closed).
 */
window.closeLobby = function (status) {
    lobby.closeLobby(status)
}

/**
 * Leaves the current lobby using the Lobby instance.
 */
window.leaveLobby = function (){
    lobby.leaveLobby()
}

/**
 * If shortcut key is pressed, checks for lobby updates.
 */
ipcRenderer.on('shortcut-key-pressed', async (event) => {
    lobby.checkLobbyUpdate()
});

window.addCustomMap = function () {
    custom.addCustomMap()
}

window.deleteImage = function (img) {
    var input = $(img);
    let src = input.attr("data-img");
    custom.deleteCustomMap(src);
}