const {debugLog} = require("./logger");

// Lobby state is polled only while joined
const POLL_INTERVAL_MS = 15000;

/** Server-provided rotation → integer 0-359, or null when not a finite number. */
function normalizeRotation(value) {
    const num = typeof value === "string" ? Number(value) : value;
    if (typeof num !== "number" || !Number.isFinite(num)) return null;
    return ((Math.round(num) % 360) + 360) % 360;
}

class Lobby {
    constructor(api, settings, images) {
        debugLog("lobby::constructor::called");
        this.api = api;
        this.settings = settings;
        this.images = images;
        this.lobbyData = {
            joined: false,
            id: 0,
            code: 0,
            creator: false,
            map: "",
            map_base64: "",
            map_base64_hash: "",
            last_map_user: "",
            rotation: 0
        };
        this.pollTimer = null;
    }

    startPolling() {
        this.stopPolling();
        this.pollTimer = setInterval(() => this.checkLobbyUpdate(), POLL_INTERVAL_MS);
    }

    stopPolling() {
        if (this.pollTimer !== null) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    async createLobby() {
        debugLog("createLobby::createLobby::called");
        $('#overlay').slideDown();
        $("#loadingContent").text("Creating lobby...");
        try {
            const lobby = await this.api.createLobby();
            if (lobby && lobby.ok) {
                this.lobbyData.id = lobby.id;
                this.lobbyData.code = lobby.code;
                this.lobbyData.joined = true;
                this.lobbyData.creator = true;
                $("#joinOrCreate").slideUp();
                $("#joinedLobby").slideDown();
                $("#codeJoined").val(this.lobbyData.code);
                this.startPolling();
                await this.checkLobbyUpdate();
            } else {
                debugLog("lobby::createLobby::error", "Failed to create lobby");
            }
        } catch (e) {
            debugLog("lobby::createLobby::error", e.message);
        } finally {
            $('#overlay').slideUp();
        }

    }

    toggleCode() {
        let attr = $("#codeJoined").attr("type")
        if (attr === "password") {
            $("#codeJoined").attr("type", "text")
        } else {
            $("#codeJoined").attr("type", "password")
        }
    }

    async joinLobby() {
        debugLog("lobby::joinLobby::called");
        $('#overlay').slideDown();
        $("#loadingContent").text("Joining lobby...");
        try {
            const code = parseInt($("#codeJoin").val());
            if (isNaN(code)) {
                alert("Please enter a valid code");
                return;
            }
            const lobby = await this.api.joinLobby(code);
            if (lobby && lobby.ok) {
                this.lobbyData.id = lobby.id;
                this.lobbyData.code = lobby.code;
                this.lobbyData.joined = true;
                this.lobbyData.creator = false;
                $("#joinOrCreate").slideUp();
                $("#joinedLobby").slideDown();
                $("#closeLobby").css({display: "none"});
                $("#codeJoined").val(this.lobbyData.code);
                this.startPolling();
                await this.checkLobbyUpdate();
            } else {
                debugLog("lobby::joinLobby::error", "Failed to join lobby");
            }
        } catch (e) {
            debugLog("lobby::joinLobby::error", e.message);
        } finally {
            $('#overlay').slideUp();
        }
    }

    async closeLobby(status) {
        debugLog("lobby::closeLobby::called", status);
        if (!this.lobbyData.joined || !this.lobbyData.creator) return;

        $('#overlay').slideDown();
        $("#loadingContent").text("Closing lobby...");
        try {
            const response = await this.api.setLobbyStatus(this.lobbyData.id, status);
            if (response && response.ok) {
                if (status) {
                    $("#closeLobby").css({
                        display: "block"
                    })
                    $("#openLobby").css({
                        display: "none"
                    })
                } else {
                    $("#closeLobby").css({
                        display: "none"
                    })
                    $("#openLobby").css({
                        display: "block"
                    })
                }
            } else {
                debugLog("lobby::closeLobby::error", "Failed to close lobby");
            }
        } catch (e) {
            debugLog("lobby::closeLobby::error", e.message);
        } finally {
            $('#overlay').slideUp();
        }
    }

    async leaveLobby() {
        debugLog("lobby::leaveLobby::called");
        if (!this.lobbyData.joined) return;

        $('#overlay').slideDown();
        $("#loadingContent").text("Leaving lobby...");
        try {
            const response = await this.api.leaveLobby(this.lobbyData.id);
            if (response && response.ok) {
                this.lobbyData.id = 0;
                this.lobbyData.code = 0;
                this.lobbyData.joined = false;
                this.lobbyData.creator = false;
                this.lobbyData.map = "";
                $("#joinOrCreate").slideDown();
                $("#joinedLobby").slideUp();
                $("#closeLobby").css({display: "block"});
                $("#codeJoined").val("");
                this.stopPolling();
            } else {
                debugLog("lobby::leaveLobby::error", "Failed to leave lobby");
            }
        } catch (e) {
            debugLog("lobby::leaveLobby::error", e.message);
        } finally {
            $('#overlay').slideUp();
        }
    }

    async setMap(map, type) {
        // Custom maps travel as base64: log the size, not the payload
        debugLog("lobby::setMap::called", type === "custom" ? `<base64 ${String(map).length} chars>` : map, type);
        if (!this.lobbyData.joined) return;
        try {
            const rotation = this.settings.get("rotation") || 0;
            const response = await this.api.setMap(this.lobbyData.id, map, type, rotation);
            if (response) {
                debugLog("lobby::setMap::success", "Map set successfully");
                // Update local rotation state to maintain consistency
                this.lobbyData.rotation = rotation;
            } else {
                debugLog("lobby::setMap::error", "Failed to set map");
            }
        } catch (e) {
            debugLog("lobby::setMap::error", e.message);
        }
    }

    async checkLobbyUpdate() {
        debugLog("lobby::checkLobbyUpdate::called");
        if (!this.lobbyData.joined) return;

        try {
            const lobby = await this.api.getLobbyData(this.lobbyData.id);
            if (lobby && lobby.ok) {
                // Update rotation from server if available
                if (lobby.rotation !== undefined && lobby.rotation !== null) {
                    const rotation = normalizeRotation(lobby.rotation);
                    if (rotation === null) {
                        debugLog("lobby::checkLobbyUpdate::invalid-rotation", String(lobby.rotation).slice(0, 50));
                    } else if (rotation !== this.lobbyData.rotation) {
                        this.lobbyData.rotation = rotation;
                        await this.settings.set("rotation", rotation);
                    }
                }

                if (lobby.type === "standard") {
                    if (this.lobbyData.map !== lobby.map) {
                        // Only maps we have downloaded are shown ("" hides the
                        // overlay); never pass an arbitrary server path on.
                        const localPath = lobby.map === "" ? "" : this.images.resolveLocalMapPath(lobby.map);
                        if (localPath === null) {
                            debugLog("lobby::checkLobbyUpdate::unknown-map", String(lobby.map).slice(0, 200));
                            // Remember it so the next poll doesn't log it again
                            this.lobbyData.map = lobby.map;
                            return;
                        }
                        this.lobbyData.map = lobby.map;
                        this.lobbyData.map_base64_hash = "";
                        this.lobbyData.map_base64 = "";
                        //TODO: New api function to send map
                        this.images.sendMap(localPath, "standard", false)
                    }
                } else if (lobby.type === "custom") {
                    if (this.lobbyData.last_map_user !== lobby.last_changer) {
                        if (this.lobbyData.map_base64_hash !== lobby.map64hash) {
                            const lobbyImage = await this.api.getLobbyCustomImage(this.lobbyData.id);
                            if (lobbyImage && lobbyImage.ok && typeof lobbyImage.map === "string" && lobbyImage.map !== "") {
                                this.lobbyData.map_base64 = lobbyImage.map;
                                this.lobbyData.map_base64_hash = lobby.map64hash;
                                this.lobbyData.map = "";
                                this.images.sendMap(this.lobbyData.map_base64, "base64", false);
                            }
                        }
                    }
                }
            } else {
                debugLog("lobby::checkLobbyUpdate::error", "Failed to fetch lobby data");
            }
        } catch (e) {
            debugLog("lobby::checkLobbyUpdate::error", e.message);
        }
    }
}

module.exports = Lobby;