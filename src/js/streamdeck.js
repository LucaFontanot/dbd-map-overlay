const {debugLog} = require("./logger");
const { ipcRenderer } = require('electron');

class StreamDeck {
    constructor(images) {
        debugLog("StreamDeck::constructor::called");
        this.images = images;
        this.buttonCount = 6; // Default button count
        this.commandPrefix = "dbd-map-tool"; // Default command prefix
        this.mapDictionary = {}; // Map dictionary from buildMapDictionary
        this.outputDir = "";
        this.installType = "flatpak";
        this.selectedCreator = "";
        this.loadStreamDeckSupport()
    }

    async loadStreamDeckSupport() {
        const self = this;
        
        $('#createConfigs').on('click', async function () {
            await self.handleCreateConfigs();
        });

        // Listen for radio button changes
        $('input[name="streamControllerInstall"]').on('change', function() {
            self.installType = $(this).val();
        });
    }

    async handleCreateConfigs() {
        try {
            this.mapDictionary = this.images.mapDictionary;
            // Check if we have map data
            if (!this.mapDictionary || Object.keys(this.mapDictionary).length === 0) {
                throw new Error("No map data available. Please load maps first.");
            }

            // Get configuration from user
            await this.getConfiguration();
            
            // Get maps for selected creator
            const realms = this.organizeMapsByRealm();
            
            if (!realms || Object.keys(realms).length === 0) {
                throw new Error("No maps found for selected creator");
            }

            // Create configurations
            await this.createConfigurations(realms);
            
            // Show success message
            this.showSuccessMessage();
            
        } catch (error) {
            debugLog("StreamDeck::handleCreateConfigs::error", error);
            this.showErrorMessage(error.message);
        }
    }

    async getConfiguration() {
        return new Promise(async (resolve, reject) => {
            let modalHtml = ""
            try {
                // Get available creators from map dictionary
                const creators = this.getAvailableCreators();
                
                if (!creators || creators.length === 0) {
                    reject(new Error("No creators available"));
                    return;
                }
                
                // Create modal dialog for configuration
                modalHtml = `
                    <div class="modal fade" id="streamDeckConfigModal" tabindex="-1" style="color: black">
                        <div class="modal-dialog modal-lg">
                            <div class="modal-content">
                                <div class="modal-header">
                                    <h5 class="modal-title">Stream Deck Configuration</h5>
                                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                                </div>
                                <div class="modal-body">
                                    <div class="mb-3">
                                        <label for="buttonCount" class="form-label">Number of buttons on your Stream Deck:</label>
                                        <input type="number" class="form-control" id="buttonCount" value="6" min="1" max="32">
                                    </div>
                                    <div class="mb-3">
                                        <label for="commandPrefix" class="form-label">Command prefix:</label>
                                        <input type="text" class="form-control" id="commandPrefix" value="dbd-map-tool">
                                    </div>
                                    <div class="mb-3">
                                        <label class="form-label">Select Creator:</label>
                                        <div class="form-check-container" style="max-height: 200px; overflow-y: auto; border: 1px solid #ddd; padding: 10px; border-radius: 5px;">
                                            ${creators.map(creator => `
                                                <div class="form-check">
                                                    <input class="form-check-input" type="radio" name="creatorSelect" value="${creator}" id="creator_${creator}">
                                                    <label class="form-check-label" for="creator_${creator}">
                                                        ${creator}
                                                    </label>
                                                </div>
                                            `).join('')}
                                        </div>
                                    </div>
                                    ${this.installType === 'system' ? `
                                    <div class="mb-3">
                                        <label for="outputDir" class="form-label">Output directory:</label>
                                        <div class="input-group">
                                            <input type="text" class="form-control" id="outputDir" readonly>
                                            <button class="btn btn-outline-secondary" type="button" id="browseDir">Browse</button>
                                        </div>
                                    </div>
                                    ` : ''}
                                </div>
                                <div class="modal-footer">
                                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                                    <button type="button" class="btn btn-primary" id="confirmConfig">Create</button>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            } catch (error) {
                reject(error);
                return;
            }

            // Remove existing modal if any
            $('#streamDeckConfigModal').remove();
            
            // Add modal to page
            $('body').append(modalHtml);
            
            const modal = new bootstrap.Modal(document.getElementById('streamDeckConfigModal'));
            modal.show();

            // Handle browse button for system install
            $('#browseDir').on('click', async () => {
                try {
                    const result = await ipcRenderer.invoke('dialog:selectDirectory');
                    if (result && !result.canceled) {
                        $('#outputDir').val(result.filePaths[0]);
                    }
                } catch (error) {
                    debugLog("Error selecting directory:", error);
                }
            });

            // Handle confirm button
            $('#confirmConfig').on('click', () => {
                this.buttonCount = parseInt($('#buttonCount').val()) || 6;
                this.commandPrefix = $('#commandPrefix').val() || 'dbd-map-tool';
                this.selectedCreator = $('input[name="creatorSelect"]:checked').val();
                
                if (!this.selectedCreator) {
                    alert('Please select a creator');
                    return;
                }
                
                if (this.installType === 'system') {
                    this.outputDir = $('#outputDir').val();
                    if (!this.outputDir) {
                        alert('Please select an output directory');
                        return;
                    }
                }
                
                modal.hide();
                resolve();
            });

            // Handle modal close
            $('#streamDeckConfigModal').on('hidden.bs.modal', () => {
                $('#streamDeckConfigModal').remove();
            });
        });
    }

    getAvailableCreators() {
        return Object.keys(this.mapDictionary);
    }

    organizeMapsByRealm() {
        const realms = {};
        
        if (!this.mapDictionary[this.selectedCreator]) {
            return realms;
        }
        
        // Iterate through realms for the selected creator
        for (const [realmName, maps] of Object.entries(this.mapDictionary[this.selectedCreator])) {
            realms[realmName] = maps.map(mapName => ({
                key: `${this.selectedCreator}/${realmName}/${mapName}`,
                name: mapName,
                creator: this.selectedCreator
            }));
        }
        
        return realms;
    }

    async createConfigurations(realms) {
        const realmNames = Object.keys(realms);
        
        // Create main pages (handle realm overflow)
        await this.createMainPages(realmNames);
        
        // Create realm pages
        for (const [realmName, maps] of Object.entries(realms)) {
            await this.createRealmPages(realmName, maps);
        }
    }

    async createMainPages(realmNames) {
        const availableButtons = this.buttonCount - 2; // Reserve 2 buttons for navigation
        const pagesNeeded = Math.ceil(realmNames.length / availableButtons);
        
        for (let page = 0; page < pagesNeeded; page++) {
            const keys = {};
            const startIndex = page * availableButtons;
            const endIndex = Math.min(startIndex + availableButtons, realmNames.length);
            
            // Add realm buttons
            for (let i = startIndex; i < endIndex; i++) {
                const buttonIndex = i - startIndex;
                const position = this.getButtonPosition(buttonIndex);
                const realmName = realmNames[i];
                
                keys[position] = {
                    states: {
                        "0": {
                            labels: this.createLabels(realmName),
                            actions: [{
                                id: "com_core447_DeckPlugin::ChangePage",
                                settings: {
                                    selected_page: this.getPagePath(`${realmName}_page1.json`),
                                    deck_number: null
                                }
                            }],
                            "image-control-action": null,
                            "label-control-actions": [0, 0, 0],
                            "background-control-action": 0,
                            media: { path: null }
                        }
                    }
                };
            }
            
            // Add navigation arrows if multiple pages
            if (pagesNeeded > 1) {
                // Previous page button (if not first page)
                if (page > 0) {
                    const prevPosition = this.getButtonPosition(this.buttonCount - 2);
                    keys[prevPosition] = this.createNavigationButton(
                        "arrow-left.svg",
                        page === 1 ? "DeadByDaylight.json" : `DeadByDaylight_page${page}.json`
                    );
                }
                
                // Next page button (if not last page)
                if (page < pagesNeeded - 1) {
                    const nextPosition = this.getButtonPosition(this.buttonCount - 1);
                    keys[nextPosition] = this.createNavigationButton(
                        "arrow-right.svg",
                        `DeadByDaylight_page${page + 2}.json`
                    );
                }
            }
            
            const pageConfig = { keys };
            const filename = page === 0 ? "DeadByDaylight.json" : `DeadByDaylight_page${page + 1}.json`;
            await this.savePageConfig(filename, pageConfig);
        }
    }

    async createRealmPages(realmName, maps) {
        const availableButtons = this.buttonCount - 3; // Reserve buttons for back navigation and page navigation
        const pagesNeeded = Math.ceil(maps.length / availableButtons);
        
        for (let page = 0; page < pagesNeeded; page++) {
            const keys = {};
            const startIndex = page * availableButtons;
            const endIndex = Math.min(startIndex + availableButtons, maps.length);
            
            // Add back button to main page
            keys[this.getButtonPosition(this.buttonCount - 1)] = this.createNavigationButton(
                "arrow-left.svg",
                "DeadByDaylight.json"
            );
            
            // Add map buttons
            for (let i = startIndex; i < endIndex; i++) {
                const buttonIndex = i - startIndex;
                const position = this.getButtonPosition(buttonIndex);
                const map = maps[i];
                
                keys[position] = {
                    states: {
                        "0": {
                            labels: this.createLabels(map.name),
                            actions: [{
                                id: "com_core447_OSPlugin::RunCommand",
                                settings: {
                                    command: `"${this.commandPrefix}" show-map="${map.key}"`
                                }
                            }],
                            "image-control-action": null,
                            "label-control-actions": [0, 0, 0],
                            "background-control-action": 0,
                            media: { path: null }
                        }
                    }
                };
            }
            
            // Add navigation arrows for multiple pages
            if (pagesNeeded > 1) {
                // Previous page button
                if (page > 0) {
                    const prevPosition = this.getButtonPosition(this.buttonCount - 3);
                    keys[prevPosition] = this.createNavigationButton(
                        "arrow-left.svg",
                        page === 1 ? `${realmName}_page1.json` : `${realmName}_page${page}.json`
                    );
                }
                
                // Next page button
                if (page < pagesNeeded - 1) {
                    const nextPosition = this.getButtonPosition(this.buttonCount - 2);
                    keys[nextPosition] = this.createNavigationButton(
                        "arrow-right.svg",
                        `${realmName}_page${page + 2}.json`
                    );
                }
            }
            
            const pageConfig = { keys };
            await this.savePageConfig(`${realmName}_page${page + 1}.json`, pageConfig);
        }
    }

    createNavigationButton(iconName, targetPage) {
        return {
            states: {
                "0": {
                    media: {
                        path: this.getIconPath(iconName)
                    },
                    actions: [{
                        id: "com_core447_DeckPlugin::ChangePage",
                        settings: {
                            selected_page: this.getPagePath(targetPage),
                            deck_number: null
                        }
                    }],
                    "image-control-action": 0,
                    "label-control-actions": [0, 0, 0],
                    "background-control-action": 0
                }
            }
        };
    }

    createLabels(text) {
        let nameWithoutExt = text.replace(/\.[^/.]+$/, "");
        const words = nameWithoutExt.split(' ');
        const labels = {};
        
        if (words.length === 1) {
            labels.center = { text: words[0] };
        } else if (words.length === 2) {
            labels.top = { text: words[0] };
            labels.center = { text: words[1] };
        } else {
            labels.top = { text: words[0] };
            labels.center = { text: words.slice(1, -1).join(' ') };
            labels.bottom = { text: words[words.length - 1] };
        }
        
        return labels;
    }

    getButtonPosition(index) {
        // Convert linear index to grid position (assuming 3x2 grid for 6 buttons)
        const cols = Math.ceil(Math.sqrt(this.buttonCount));
        const row = Math.floor(index / cols);
        const col = index % cols;
        return `${col}x${row}`;
    }

    getIconPath(iconName) {
        if (this.installType === 'flatpak') {
            return `/home/${process.env.USER}/.var/app/com.core447.StreamController/data/icons/com_axolotlmaid_FontAwesomeIcons/icons/white/${iconName}`;
        } else {
            return `${this.outputDir}/icons/white/${iconName}`;
        }
    }

    getPagePath(filename) {
        if (this.installType === 'flatpak') {
            return `/home/${process.env.USER}/.var/app/com.core447.StreamController/data/pages/${filename}`;
        } else {
            return `${this.outputDir}/pages/${filename}`;
        }
    }

    async savePageConfig(filename, config) {
        try {
            const filePath = this.getPagePath(filename);
            await ipcRenderer.invoke('streamdeck:saveConfig', filePath, config);
            debugLog(`StreamDeck::savePageConfig::saved ${filename}`);
        } catch (error) {
            debugLog(`StreamDeck::savePageConfig::error saving ${filename}:`, error);
            throw error;
        }
    }

    showSuccessMessage() {
        const alertHtml = `
            <div class="alert alert-success alert-dismissible fade show" role="alert">
                <strong>Success!</strong> Stream Deck configurations have been created successfully.
                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
            </div>
        `;
        
        $('#settings-stream-deck').prepend(alertHtml);
        
        // Auto-dismiss after 5 seconds
        setTimeout(() => {
            $('.alert-success').alert('close');
        }, 5000);
    }

    showErrorMessage(message) {
        const alertHtml = `
            <div class="alert alert-danger alert-dismissible fade show" role="alert">
                <strong>Error!</strong> ${message}
                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
            </div>
        `;
        
        $('#settings-stream-deck').prepend(alertHtml);
    }
}

module.exports = StreamDeck;