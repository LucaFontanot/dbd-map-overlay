const {debugLog} = require("./logger");
const axios = require("axios");

/**
 * Copy of a request/response object that is safe to log: the user token is
 * never written out and base64 map payloads are reduced to their length.
 */
function redact(obj) {
    if (!obj || typeof obj !== "object") return obj;
    const out = {};
    for (const [key, value] of Object.entries(obj)) {
        if (key === "user" || key === "token") {
            out[key] = "<redacted>";
        } else if (typeof value === "string" && value.length > 200) {
            out[key] = `<${value.length} chars>`;
        } else {
            out[key] = value;
        }
    }
    return out;
}

class API {

    baseUrl = "";
    token = "";

    constructor(baseURL) {
        this.baseUrl = baseURL;
    }

    setToken(token) {
        debugLog("api::setToken::called", token ? "<token set>" : "<empty>");
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
            debugLog("api::createLobby::body", redact(body));
            let lobby = await axios.post(this.baseUrl + "/api/createLobby", body, {
                headers: {
                    "l-content-sec": await window.lsChallange.getVerificationHeader(["(body)"], [body]),
                    "content-type": "application/json"
                }
            })
            debugLog("api::createLobby::response", redact(lobby.data));
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
            debugLog("api::joinLobby::body", redact(body));
            let lobby = await axios.post(this.baseUrl + "/api/joinRoom", body, {
                headers: {
                    "l-content-sec": await window.lsChallange.getVerificationHeader(["(body)"], [body]),
                    "content-type": "application/json"
                }
            })
            debugLog("api::joinLobby::response", redact(lobby.data));
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
            debugLog("api::setLobbyStatus::body", redact(body));
            let lobby = await axios.post(this.baseUrl + "/api/setCloseStatus", body, {
                headers: {
                    "content-type": "application/json"
                }
            })
            debugLog("api::setLobbyStatus::response", redact(lobby.data));
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
            debugLog("api::leaveLobby::body", redact(body));
            let lobby = await axios.post(this.baseUrl + "/api/leaveRoom", body, {
                headers: {
                    "content-type": "application/json"
                }
            })
            debugLog("api::leaveLobby::response", redact(lobby.data));
            return lobby.data;
        } catch (e) {
            debugLog("api::leaveLobby::error", e.message);
            return null;
        }
    }

    async setMap(id, map, type, rotation) {
        debugLog("api::setMap::called", id, type === "custom" ? `<base64 ${String(map).length} chars>` : map, type, rotation);
        try {
            let body = {
                user: this.token,
                id: id,
                map: map,
                type: type,
                rotation: rotation || 0
            }
            debugLog("api::setMap::body", redact(body));
            let response = await axios.post(this.baseUrl + "/api/setMap", body, {
                headers: {
                    "content-type": "application/json"
                }
            })
            debugLog("api::setMap::response", redact(response.data));
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
            debugLog("api::getLobbyData::body", redact(body));
            let lobby = await axios.post(this.baseUrl + "/api/getLobbyData", body, {
                headers: {
                    "content-type": "application/json"
                }
            })
            debugLog("api::getLobbyData::response", redact(lobby.data));
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
            debugLog("api::getLobbyCustomImage::body", redact(body));
            let response = await axios.post(this.baseUrl + "/api/getLobbyCustomImage", body, {
                headers: {
                    "content-type": "application/json"
                }
            })
            debugLog("api::getLobbyCustomImage::response", redact(response.data));
            return response.data;
        } catch (e) {
            debugLog("api::getLobbyCustomImage::error", e.message);
            return null;
        }
    }
}

module.exports = API;