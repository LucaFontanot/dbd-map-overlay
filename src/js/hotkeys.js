const { debugLog } = require("./logger");
const { ipcRenderer } = require('electron');
const { acceleratorToDisplay, displayToAccelerator, SYSTEM_HOTKEY_DEFS } = require("../shared/hotkeys-constants");

class Hotkeys {

    constructor(images, settings) {
        debugLog("hotkeys::constructor::called");
        this.images = images;
        this.settings = settings || null;
        this.recordingHotkey = false;
        this.editingSystemAction = null; // actionId when editing a system hotkey, null otherwise
        this.hotkeys = {};
        this.systemHotkeys = {};
    }

    showToast(message, isSuccess = true) {
        const toastEl = document.getElementById('hotkeyToast');
        const toastBody = document.getElementById('hotkeyToastBody');
        if (!toastEl || !toastBody) return;

        toastBody.textContent = message;

        toastEl.classList.remove('bg-success', 'bg-danger');
        toastEl.classList.add(isSuccess ? 'bg-success' : 'bg-danger');

        const toast = bootstrap.Toast.getOrCreateInstance(toastEl);
        toast.show();
    }

    splitCreatorAndMap(mapPath) {
        const segments = mapPath.split('/').filter(Boolean);

        const creator = segments[0] ?? '';
        const last    = segments.at(-1) ?? '';
        const map     = last.replace(/\.[^.]+$/, '');

        return { creator, map };
    }

    // ─── Custom Map Hotkey Table ───────────────────────────────

    updateHotkeys() {
        const $list = $('#hotkeyList').empty();

        for (const [hotkey, { id, mapKey }] of Object.entries(this.hotkeys)) {
            const { creator, map } = this.splitCreatorAndMap(mapKey);

            const $row = $(`
                <tr data-id="${id}">
                    <td><kbd>${hotkey}</kbd></td>
                    <td>${map}</td>
                    <td>${creator}</td>
                </tr>
            `);
            $row.append(this.trashCell(id));
            $list.append($row);
        }
    }

    trashCell(id) {
        return /* html */`
            <td class="text-center">
                <button type="button"
                        class="delete-row btn btn-link p-0"
                        data-id="${id}"
                        title="Delete row">
                    <i class="fas fa-trash-can"></i>
                </button>
            </td>
        `;
    }

    loadTable() {
        $('#hotkeyList').on('click', '.delete-row', (e) => {
            const id   = $(e.currentTarget).data('id');
            const $row = $(e.currentTarget).closest('tr');

            $row.remove();

            for (const [hotkey, obj] of Object.entries(this.hotkeys)) {
                if (obj.id === id) {
                    delete this.hotkeys[hotkey];
                    break;
                }
            }

            ipcRenderer.send('delete-hotkey', id);
        });
    }

    // ─── System Hotkey Table ───────────────────────────────────

    async loadSystemHotkeys() {
        try {
            this.systemHotkeys = await ipcRenderer.invoke('get-system-hotkeys');
        } catch (err) {
            console.error("Failed to load system hotkeys:", err);
            this.systemHotkeys = {};
        }
        this.updateSystemHotkeysTable();
        this.updateHotkeyLabels();
    }

    updateSystemHotkeysTable() {
        const $list = $('#systemHotkeyList');
        if (!$list.length) return;
        $list.empty();

        for (const [actionId, def] of Object.entries(SYSTEM_HOTKEY_DEFS)) {
            const currentAccel = this.systemHotkeys[actionId] || def.defaultAccelerator;
            const display = acceleratorToDisplay(currentAccel);
            const isDefault = currentAccel === def.defaultAccelerator;

            const $row = $(`
                <tr data-action="${actionId}">
                    <td>${def.description}</td>
                    <td><kbd class="system-hotkey-binding" data-action="${actionId}">${display}</kbd></td>
                    <td class="text-center">
                        <button type="button"
                                class="edit-system-btn btn btn-sm btn-outline-primary"
                                data-action="${actionId}"
                                title="Edit hotkey">
                            Edit
                        </button>
                    </td>
                    <td class="text-center">
                        <button type="button"
                                class="reset-system-btn btn btn-sm btn-outline-warning"
                                data-action="${actionId}"
                                title="Reset to default"
                                ${isDefault ? 'disabled' : ''}>
                            Reset
                        </button>
                    </td>
                </tr>
            `);
            $list.append($row);
        }

        // Edit button handlers
        const self = this;
        $('.edit-system-btn').off('click').on('click', function () {
            const actionId = $(this).data('action');
            self.startSystemHotkeyEdit(actionId);
        });

        // Reset button handlers
        $('.reset-system-btn').off('click').on('click', function () {
            const actionId = $(this).data('action');
            ipcRenderer.send('reset-system-hotkey', { actionId });
        });
    }

    /**
     * Update all dynamic hotkey text labels across the DOM.
     */
    updateHotkeyLabels() {
        // Lobby hint
        const lobbyAccel = this.systemHotkeys['check-lobby'] || SYSTEM_HOTKEY_DEFS['check-lobby'].defaultAccelerator;
        const $lobbyHint = $('#lobbyHotkeyHint');
        if ($lobbyHint.length) $lobbyHint.text(acceleratorToDisplay(lobbyAccel));
    }

    // ─── System Hotkey Editing ────────────────────────────────

    startSystemHotkeyEdit(actionId) {
        const def = SYSTEM_HOTKEY_DEFS[actionId];
        if (!def) return;

        this.editingSystemAction = actionId;

        // Show the hotkey modal, hide map selector since we don't need it
        $('#addHotkeyModal .modal-title').text(`Change Hotkey: ${def.description}`);
        // Hide creator/map fields (container hides labels, selects, and TomSelect wrappers)
        $('#mapCreatorFields').hide();

        // Reset and focus the hotkey input
        const $input = $('#hotkeyInput');
        $input.val('').attr('placeholder', 'Listening...');
        this.recordingHotkey = true;

        // Change save button behavior
        const self = this;
        $('#saveHotkeyBtn').off('click').on('click', function () {
            self.saveSystemHotkey();
        });

        // Show the modal
        const modal = new bootstrap.Modal(document.getElementById('addHotkeyModal'));
        modal.show();
    }

    saveSystemHotkey() {
        const actionId = this.editingSystemAction;
        if (!actionId) return;

        const rawVal = $('#hotkeyInput').val();
        const displayAccel = rawVal.replace(/\s*\+\s*/g, '+');
        const accelerator = displayToAccelerator(displayAccel);

        if (!displayAccel) {
            this.showToast('No key combination recorded.', false);
            return;
        }

        ipcRenderer.send('save-system-hotkey', { actionId, accelerator });

        // Modal closes via data-bs-dismiss on the button;
        // restoreModalDefaults() will fire via hidden.bs.modal event.
    }

    restoreModalDefaults() {
        $('#addHotkeyModal .modal-title').text('Bind New Hotkey');
        $('#mapCreatorFields').show();
        $('#hotkeyInput').val('').attr('placeholder', 'Press a key...');
        this.editingSystemAction = null;
        this.recordingHotkey = false;

        // Restore save button for custom map hotkeys
        const self = this;
        $('#saveHotkeyBtn').off('click').on('click', function () {
            self.saveHotkeyToFile();
        });
    }

    // ─── Custom Map Hotkey Save ───────────────────────────────

    saveHotkeyToFile() {
        const settings = {
            hotkey: $('#hotkeyInput').val().replace(/\s*\+\s*/g, '+'),
            mapkey: $('#selectMap').val()
        };
        ipcRenderer.send('save-hotkeys', settings);
    }

    registerHotkeys(hotkeys) {
        ipcRenderer.send('register-hotkeys', hotkeys);
    }

    // ─── Load Everything ──────────────────────────────────────

    async loadHotkeys() {
        const mapDict = this.images.mapDictionary;

        new TomSelect("#selectCreator", {
            placeholder: "Select a creator...",
            allowEmptyOption: false
        });

        this.populateCreatorSelect(mapDict);

        const initialCreator = Object.keys(mapDict)[0];
        this.populateMapSelectForCreator(mapDict, initialCreator);

        $("#selectCreator").on("change", (e) => {
            const selectedCreator = $(e.target).val();
            this.populateMapSelectForCreator(mapDict, selectedCreator);
        });

        this.loadCapture();

        ipcRenderer.on('hotkey-pressed', (event, mapKey) => {
            let mapImagePath = this.images.pathLookup[mapKey];
            const response = this.images.sendMap(mapImagePath, "standard");
            if (response) {
                debugLog("hotkey::setMap::success", "Map set successfully");
            } else {
                debugLog("hotkey::setMap::error", "Failed to set map");
            }
        });

        ipcRenderer.on('hotkey-updated', (event, hotkeys) => {
            this.hotkeys = hotkeys;
            this.updateHotkeys();
        });

        // System hotkeys updated
        ipcRenderer.on('system-hotkeys-updated', (event, bindings) => {
            this.systemHotkeys = bindings;
            this.updateSystemHotkeysTable();
            this.updateHotkeyLabels();
        });

        // Load from main process
        ipcRenderer.send('load-hotkeys');
        await this.loadSystemHotkeys();
        this.loadTable();
    }

    // ─── Map Selectors ────────────────────────────────────────

    populateCreatorSelect(mapDict) {
        const select = document.querySelector("#selectCreator");
        if (select.tomselect) {
            select.tomselect.clearOptions();

            Object.keys(mapDict).forEach(creator => {
                select.tomselect.addOption({ value: creator, text: creator });
            });

            select.tomselect.refreshOptions(false);
            select.tomselect.setValue(Object.keys(mapDict)[0]);
        }
    }

    populateMapSelectForCreator(mapDict, creator) {
        const $select = $("#selectMap");

        if ($select[0].tomselect) {
            $select[0].tomselect.destroy();
        }

        $select.empty().append('<option value="">Select...</option>');

        const realms = mapDict[creator];
        Object.entries(realms).forEach(([realm, mapNames]) => {
            const optgroup = $('<optgroup>').attr('label', realm);

            mapNames.forEach(mapName => {
                const value = `${creator}/${realm}/${mapName}`;
                const displayName = mapName.replace(/\.[^/.]+$/, '');
                const option = $('<option>').val(value).text(displayName);
                optgroup.append(option);
            });

            $select.append(optgroup);
        });

        new TomSelect("#selectMap", {
            placeholder: "Select a map...",
            allowEmptyOption: true
        });
    }

    // ─── Key Capture ──────────────────────────────────────────

    loadCapture() {
        const self = this;

        $('#hotkeyInput').on('click', function () {
            self.recordingHotkey = true;
            $(this).val('').attr('placeholder', 'Listening...');
        });

        $(document).on('keydown', function (e) {
            if (!self.recordingHotkey) return;

            e.preventDefault();

            const keys = [];

            if (e.ctrlKey) keys.push('Ctrl');
            if (e.metaKey) keys.push('Meta');
            if (e.altKey) keys.push('Alt');
            if (e.shiftKey) keys.push('Shift');

            const key = e.key;

            if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
                const displayKey = key.length === 1 ? key.toUpperCase() : key;
                keys.push(displayKey);
            }

            const hotkeyString = keys.join(' + ');

            $('#hotkeyInput')
                .val(hotkeyString)
                .attr('placeholder', hotkeyString);
        });

        $(document).on('click', function (e) {
            if (!$(e.target).is('#hotkeyInput')) {
                self.recordingHotkey = false;
            }
        });

        // Custom map hotkey save button (default behavior)
        $("#saveHotkeyBtn").on("click", () => {
            this.saveHotkeyToFile();
        });

        // When the add hotkey modal is hidden, always restore modal to default state
        $('#addHotkeyModal').on('hidden.bs.modal', function () {
            self.restoreModalDefaults();
        });
    }
}

module.exports = Hotkeys;
