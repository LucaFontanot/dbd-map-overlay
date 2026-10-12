<template>
  <div class="pa-6">
    <div class="d-flex align-center mb-3">
      <div>
        <div class="section-title">App hotkeys</div>
        <div class="text-caption opacity-60">Work everywhere, also while the game has focus.</div>
      </div>
    </div>
    <v-table class="bg-transparent mb-8" density="comfortable">
      <thead>
      <tr>
        <th>Action</th>
        <th>Keys</th>
        <th class="text-end"></th>
      </tr>
      </thead>
      <tbody>
      <tr v-for="(def, actionId) in SYSTEM_HOTKEY_DEFS" :key="actionId">
        <td>{{ def.description }}</td>
        <td><kbd>{{ acceleratorToDisplay(hotkeys.systemAccelerator(actionId)) }}</kbd></td>
        <td class="text-end text-no-wrap">
          <v-btn size="small" variant="text" prepend-icon="mdi-pencil" @click="editSystem(actionId)">Change</v-btn>
          <v-btn size="small" variant="text" prepend-icon="mdi-restore"
                 :disabled="hotkeys.systemAccelerator(actionId) === def.defaultAccelerator"
                 @click="hotkeys.resetSystem(actionId)">Reset</v-btn>
        </td>
      </tr>
      </tbody>
    </v-table>

    <div class="d-flex align-center mb-3">
      <div>
        <div class="section-title">Map hotkeys</div>
        <div class="text-caption opacity-60">Show a specific map with a key combination.</div>
      </div>
      <v-spacer/>
      <v-btn color="primary" variant="tonal" prepend-icon="mdi-plus" @click="addMap">Add hotkey</v-btn>
    </div>
    <v-table v-if="mapRows.length" class="bg-transparent" density="comfortable">
      <thead>
      <tr>
        <th>Keys</th>
        <th>Map</th>
        <th>Creator</th>
        <th></th>
      </tr>
      </thead>
      <tbody>
      <tr v-for="row in mapRows" :key="row.id">
        <td><kbd>{{ row.hotkey }}</kbd></td>
        <td>{{ row.map }}</td>
        <td class="opacity-70">{{ row.creator }}</td>
        <td class="text-end">
          <v-btn icon="mdi-delete-outline" size="small" variant="text" color="error" @click="hotkeys.remove(row.id)"/>
        </td>
      </tr>
      </tbody>
    </v-table>
    <div v-else class="text-body-2 opacity-60 py-4 text-center">No map hotkeys yet</div>

    <HotkeyDialog v-model="dialog.show" :action-id="dialog.actionId"/>
  </div>
</template>

<script setup>
import {computed, reactive} from 'vue';
import mapMatch from '@core/map-match.js';
import {hotkeys, SYSTEM_HOTKEY_DEFS, acceleratorToDisplay} from '../../services/hotkeys';
import HotkeyDialog from '../../components/HotkeyDialog.vue';

const dialog = reactive({show: false, actionId: null});

const mapRows = computed(() => Object.entries(hotkeys.state.maps).map(([hotkey, {id, mapKey}]) => {
  // Creator/Realm/Map parsing lives in map-match.js (single source)
  const parsed = mapMatch.parseMapPath(mapKey) || {};
  return {id, hotkey, map: parsed.base || mapKey, creator: parsed.creator || ''};
}));

function editSystem(actionId) {
  Object.assign(dialog, {show: true, actionId});
}

function addMap() {
  Object.assign(dialog, {show: true, actionId: null});
}
</script>

<style scoped>
.section-title {
  font-weight: 600;
}
</style>
