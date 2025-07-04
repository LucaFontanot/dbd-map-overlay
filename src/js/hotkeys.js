const {debugLog} = require("./logger");
const { ipcRenderer } = require('electron');

class Hotkeys {

    constructor(images) {
        debugLog("hotkeys::constructor::called");
        this.images = images;
        this.recordingHotkey = false;
        this.hotkeys = {};
    }

    showToast(message, isSuccess = true) {
        const toastEl = document.getElementById('hotkeyToast');
        const toastBody = document.getElementById('hotkeyToastBody');

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

    updateHotkeys() {
        const $list = $('#hotkeyList').empty();

        for (const [hotkey, { id, mapKey }] of Object.entries(this.hotkeys)) {
            const { creator, map } = this.splitCreatorAndMap(mapKey);

            const $row = $(`
                <tr data-id="${id}">
                    <td>${hotkey}</td>
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
                    <i class="fa fa-trash"></i>
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

        this.loadCapture()

        ipcRenderer.on('hotkey-pressed', (event, mapKey) => {
            let mapIamgePath = this.images.pathLookup[mapKey]
            const response = this.images.sendMap(mapIamgePath, "standard");
            if (response) {
                debugLog("hotkey::setMap::success", "Map set successfully");
            } else {
                debugLog("hotkey::setMap::error", "Failed to set map");
            }
        });

        ipcRenderer.on('hotkey-updated', (event, hotkeys) => {
            this.hotkeys = hotkeys;
            this.updateHotkeys()
        });
        ipcRenderer.send('load-hotkeys');
        this.loadTable()
    }

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

        $("#saveHotkeyBtn").on("click", () => {
            this.saveHotkeyToFile();
        });
    }
}

module.exports = Hotkeys;