<template>
  <div class="pa-6">
    <v-alert type="info" icon="mdi-monitor-screenshot" class="mb-6">
      Use Borderless or Windowed mode. In Exclusive Fullscreen, Windows stops rendering the game while
      you're tabbed out, so a loading screen that happens while you're alt-tabbed is missed.
    </v-alert>

    <v-row>
      <v-col cols="12" md="6">
        <div class="label">Game language</div>
        <v-select :model-value="settings.get('ocrLanguage') || 'all'" :items="languages" hide-details
                  prepend-inner-icon="mdi-translate" @update:model-value="setLanguage"/>
        <div class="text-caption opacity-60 mt-2">
          A single language is faster. Its model (about 10 MB) downloads the first time detection runs.
        </div>
      </v-col>
      <v-col cols="12" md="6">
        <div class="label">Preferred map creator</div>
        <v-select :model-value="settings.get('preferredCreator') || ''" :items="creators" hide-details
                  prepend-inner-icon="mdi-palette-outline" @update:model-value="setCreator"/>
        <div class="text-caption opacity-60 mt-2">Detected maps use this creator's images when available.</div>
      </v-col>
    </v-row>

    <v-row class="mt-2">
      <v-col cols="12" md="6">
        <div class="label">Detection mode</div>
        <v-select :model-value="detection.mode" :items="modes" hide-details
                  prepend-inner-icon="mdi-radar" @update:model-value="setMode"/>
        <div class="text-caption opacity-60 mt-2">
          <template v-if="detection.mode === 'keybind'">
            Nothing runs in the background. Press
            <kbd>{{ acceleratorToDisplay(hotkeys.systemAccelerator('detect-map')) }}</kbd>
            while the map name is on screen at the start of the match (change it in Hotkeys).
            Pick a key the game doesn't use: the app takes it over.
            Needs the Auto-detect switch in the top bar to be on.
          </template>
          <template v-else>
            Watches the screen for loading screens and reads the map name on its own.
            Try keybind mode if you notice lag spikes during matches.
          </template>
        </div>
      </v-col>
    </v-row>

    <!-- Users read "Auto-detect off" as "use the key instead": the key needs it on -->
    <v-expand-transition>
      <v-alert v-if="detection.mode === 'keybind' && !detection.enabled" type="warning" class="mt-5"
               title="Auto-detect is off">
        The detect key does nothing until you turn on the Auto-detect switch in the top bar.
        <template #append>
          <v-btn variant="tonal" @click="enableDetection">Turn on</v-btn>
        </template>
      </v-alert>
    </v-expand-transition>

    <v-expand-transition>
      <v-alert v-if="status" :type="statusType" class="mt-5" :title="statusTitle">
        {{ status.message }}
        <div v-if="showRedist" class="mt-2">
          <a :href="VC_REDIST_URL" target="_blank" rel="noopener noreferrer">
            Download the Microsoft Visual C++ Redistributable (x64)
          </a>
        </div>
      </v-alert>
    </v-expand-transition>

    <!-- Keybind mode only reads the map name: no lobby or end-of-match checks -->
    <v-list v-if="detection.mode !== 'keybind'" class="bg-transparent pa-0 mt-4" lines="two">
      <v-list-item class="px-0">
        <v-list-item-title>Detect maps in custom matches</v-list-item-title>
        <v-list-item-subtitle>When off, bot matches and private lobbies are skipped.</v-list-item-subtitle>
        <template #append>
          <v-switch :model-value="settings.get('detectInCustoms') !== false"
                    @update:model-value="v => save('detectInCustoms', !!v)"/>
        </template>
      </v-list-item>
      <v-list-item class="px-0">
        <v-list-item-title>Detect the end of the match</v-list-item-title>
        <v-list-item-subtitle>
          Hides the map when the match ends. Off: the map stays until the next match replaces it.
          Can misfire mid-match in dark scenes.
        </v-list-item-subtitle>
        <template #append>
          <v-switch :model-value="settings.get('endgameDetection') === true"
                    @update:model-value="v => save('endgameDetection', !!v)"/>
        </template>
      </v-list-item>
    </v-list>
  </div>
</template>

<script setup>
import {computed} from 'vue';
import {settings} from '../../services/settings';
import {catalog} from '../../services/catalog';
import {player} from '../../services/player';
import {detection} from '../../services/detection';
import {ui, notify} from '../../services/ui';
import {OCR_LANGUAGES, VC_REDIST_URL} from '../../services/constants';
import {hotkeys, acceleratorToDisplay} from '../../services/hotkeys';

const languages = [{value: 'all', title: 'All languages (slow)'}, ...OCR_LANGUAGES];
const modes = [
  {value: 'automatic', title: 'Automatic (watches the screen)'},
  {value: 'keybind', title: 'Keybind (press a key to detect)'},
];
const creators = computed(() => [{title: 'Any creator', value: ''}, ...catalog.state.creators.map(c => ({title: c, value: c}))]);

const status = computed(() => detection.state.modelStatus);
const statusType = computed(() => ({downloading: 'info', ready: 'success', error: 'error'})[status.value?.state] || 'info');
const statusTitle = computed(() => ({downloading: 'Downloading OCR model', ready: 'OCR ready', error: 'Detection problem'})[status.value?.state] || '');
// Retrying can't help: the OCR runtime needs the VC++ 2015-2022 x64 redistributable
const showRedist = computed(() => status.value?.code === 'OCR_NATIVE_LOAD_FAILED' && ui.info.platform === 'win32');

async function save(key, value) {
  try {
    await settings.set(key, value);
  } catch (e) {
    notify('Could not save the setting', 'error');
  }
}

async function setLanguage(lang) {
  try {
    await detection.setLanguage(lang);
  } catch (e) {
    notify(`Auto-detect: ${e.message}`, 'error');
  }
}

async function setMode(mode) {
  try {
    await detection.setMode(mode);
  } catch (e) {
    notify(`Auto-detect: ${e.message}`, 'error');
  }
}

async function enableDetection() {
  try {
    await detection.setEnabled(true);
  } catch (e) {
    notify(`Auto-detect: ${e.message}`, 'error');
  }
}

async function setCreator(creator) {
  await save('preferredCreator', creator || '');
  ui.galleryCreator = creator || '';
  // The detector keeps running: the creator only changes which PNG is
  // resolved. Remap the live overlay if it is showing a map.
  await player.onCreatorLayoutChanged(creator || '');
}
</script>

<style scoped>
.label {
  font-size: 0.85rem;
  opacity: 0.75;
  margin-bottom: 6px;
}
</style>
