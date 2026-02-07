const {debugLog} = require("./logger");
const axios = require("axios");

class API {

    baseUrl = "";
    token = "";

    constructor(baseURL) {
        this.baseUrl = baseURL;
    }

    setToken(token) {
        debugLog("api::setToken::called", token);
        this.token = token;
    }

    /**
     * Registers the user with the API, returns a token and the user ID.
     * @returns {Promise<Object>}
     */
    async register() {
        debugLog("api::register::called");
        try {
            let token = await axios.get(this.baseUrl + "/api/register", {
                responseType: "json"
            })
            return {
                token: token.data.token,
                id: token.data.id
            }
        } catch (e) {
            debugLog("api::register::error", e.message);
            return null
        }
    }

    async createLobby() {
        debugLog("api::createLobby::called");
        try {
            let body = {
                user: this.token
            }
            debugLog("api::createLobby::body", body);
            let lobby = await axios.post(this.baseUrl + "/api/createLobby", body, {
                headers: {
                    "l-content-sec": await window.lsChallange.getVerificationHeader(["(body)"], [body]),
                    "content-type": "application/json"
                }
            })
            debugLog("api::createLobby::response", lobby.data);
            return lobby.data;
        } catch (e) {
            debugLog("api::createLobby::error", e.message);
            return null;
        }
    }

    async joinLobby(code) {
        debugLog("api::joinLobby::called", code);
        try {
            let body = {
                user: this.token,
                code: code
            }
            debugLog("api::joinLobby::body", body);
            let lobby = await axios.post(this.baseUrl + "/api/joinRoom", body, {
                headers: {
                    "l-content-sec": await window.lsChallange.getVerificationHeader(["(body)"], [body]),
                    "content-type": "application/json"
                }
            })
            debugLog("api::joinLobby::response", lobby.data);
            return lobby.data;
        } catch (e) {
            debugLog("api::joinLobby::error", e.message);
            return null;
        }
    }

    async setLobbyStatus(id, status = true) {
        debugLog("api::setLobbyStatus::called", id, status);
        try {
            let body = {
                user: this.token,
                id: id,
                status: status
            }
            debugLog("api::setLobbyStatus::body", body);
            let lobby = await axios.post(this.baseUrl + "/api/setCloseStatus", body, {
                headers: {
                    "content-type": "application/json"
                }
            })
            debugLog("api::setLobbyStatus::response", lobby.data);
            return lobby.data;
        } catch (e) {
            debugLog("api::setLobbyStatus::error", e.message);
            return null;
        }
    }

    async leaveLobby(id) {
        debugLog("api::leaveLobby::called", id);
        try {
            let body = {
                user: this.token,
                id: id
            }
            debugLog("api::leaveLobby::body", body);
            let lobby = await axios.post(this.baseUrl + "/api/leaveRoom", body, {
                headers: {
                    "content-type": "application/json"
                }
            })
            debugLog("api::leaveLobby::response", lobby.data);
            return lobby.data;
        } catch (e) {
            debugLog("api::leaveLobby::error", e.message);
            return null;
        }
    }

    async setMap(id, map, type, rotation) {
        debugLog("api::setMap::called", id, map, type, rotation);
        try {
            let body = {
                user: this.token,
                id: id,
                map: map,
                type: type,
                rotation: rotation || 0
            }
            debugLog("api::setMap::body", body);
            let response = await axios.post(this.baseUrl + "/api/setMap", body, {
                headers: {
                    "content-type": "application/json"
                }
            })
            debugLog("api::setMap::response", response.data);
            return response.data;
        } catch (e) {
            debugLog("api::setMap::error", e.message);
            return null;
        }
    }

    async getLobbyData(id) {
        debugLog("api::getLobbyData::called", id);
        try {
            let body = {
                user: this.token,
                id: id
            }
            debugLog("api::getLobbyData::body", body);
            let lobby = await axios.post(this.baseUrl + "/api/getLobbyData", body, {
                headers: {
                    "content-type": "application/json"
                }
            })
            debugLog("api::getLobbyData::response", lobby.data);
            return lobby.data;
        } catch (e) {
            debugLog("api::getLobbyData::error", e.message);
            return null;
        }
    }

    async getLobbyCustomImage(id) {
        debugLog("api::getLobbyCustomImage::called", id);
        try {
            let body = {
                user: this.token,
                id: id
            }
            debugLog("api::getLobbyCustomImage::body", body);
            let response = await axios.post(this.baseUrl + "/api/getLobbyCustomImage", body, {
                headers: {
                    "content-type": "application/json"
                }
            })
            debugLog("api::getLobbyCustomImage::response", response.data);
            return response.data;
        } catch (e) {
            debugLog("api::getLobbyCustomImage::error", e.message);
            return null;
        }
    }
}

module.exports = API;