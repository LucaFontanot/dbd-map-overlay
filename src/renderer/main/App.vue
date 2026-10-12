<template>
  <v-app>
    <v-navigation-drawer permanent rail expand-on-hover :rail-width="64" width="240" class="nav">
      <div class="nav-brand">
        <img :src="iconUrl" alt="" class="nav-logo">
        <span class="brand-title nav-brand-text">DBD Map Overlay</span>
      </div>
      <v-divider/>
      <v-list nav density="comfortable" :selected="[ui.view]" @update:selected="select">
        <v-list-item v-for="item in mainItems" :key="item.value" :value="item.value"
                     :prepend-icon="item.icon" :title="item.title" color="primary"/>
      </v-list>
      <template #append>
        <v-list nav density="compact" :selected="[ui.view]" @update:selected="select">
          <v-list-item v-for="item in infoItems" :key="item.value" :value="item.value"
                       :prepend-icon="item.icon" :title="item.title" color="primary"/>
          <v-list-item :href="CONTRIBUTE_URL" target="_blank" prepend-icon="mdi-github"
                       title="Contribute" append-icon="mdi-open-in-new"/>
        </v-list>
      </template>
    </v-navigation-drawer>

    <v-app-bar flat height="60" class="topbar">
      <div class="d-flex align-center ga-3 ps-4">
        <span class="text-h6 font-weight-medium">{{ viewTitle }}</span>
        <v-chip v-if="ui.info.version" size="x-small" variant="outlined" class="opacity-70">v{{ ui.info.version }}</v-chip>
      </div>
      <v-spacer/>
      <NowShowing class="me-3"/>
      <div class="d-flex align-center me-2 detect">
        <v-switch :model-value="detection.enabled" @update:model-value="toggleDetection"
                  hide-details density="compact" color="primary" class="me-2">
          <template #label>
            <span class="text-body-2">Auto-detect</span>
          </template>
        </v-switch>
        <v-chip size="x-small" color="warning" variant="flat" class="font-weight-bold">BETA</v-chip>
      </div>
      <v-divider vertical class="mx-2 my-3"/>
      <v-tooltip text="Open a window to capture in OBS">
        <template #activator="{ props }">
          <v-btn v-bind="props" variant="text" prepend-icon="mdi-broadcast" @click="openObs">OBS</v-btn>
        </template>
      </v-tooltip>
      <v-tooltip :text="showing ? 'Hide the map from the overlay' : 'Show the last map again'">
        <template #activator="{ props }">
          <v-btn v-bind="props" :color="showing ? 'primary' : undefined" variant="tonal" class="me-4"
                 :prepend-icon="showing ? 'mdi-eye-off' : 'mdi-eye'" :disabled="!showing && !player.state.lastMapCache"
                 @click="player.toggle()">
            {{ showing ? 'Hide map' : 'Show map' }}
          </v-btn>
        </template>
      </v-tooltip>
    </v-app-bar>

    <v-main class="main">
      <v-fade-transition mode="out-in">
        <MapsView v-if="ui.view === 'maps'" key="maps"/>
        <LobbyView v-else-if="ui.view === 'lobby'" key="lobby"/>
        <CustomMapsView v-else-if="ui.view === 'custom'" key="custom"/>
        <SettingsView v-else-if="ui.view === 'settings'" key="settings"/>
        <DocView v-else :key="ui.view" :name="ui.view" :title="viewTitle"/>
      </v-fade-transition>
    </v-main>

    <LanguageDialog/>

    <v-overlay :model-value="ui.loading.active" persistent class="align-center justify-center" scrim="#07080b"
               :opacity="0.85">
      <div class="d-flex flex-column align-center text-center loading">
        <img :src="iconUrl" alt="" class="loading-logo">
        <v-progress-linear indeterminate color="primary" rounded class="my-4" style="width: 220px"/>
        <div class="text-body-2 opacity-80">{{ ui.loading.text || 'Loading…' }}</div>
      </div>
    </v-overlay>

    <v-snackbar v-model="ui.snackbar.show" :color="ui.snackbar.color" :timeout="ui.snackbar.timeout"
                location="bottom right" rounded="lg">
      {{ ui.snackbar.text }}
      <template #actions>
        <v-btn icon="mdi-close" variant="text" size="small" @click="ui.snackbar.show = false"/>
      </template>
    </v-snackbar>
  </v-app>
</template>

<script setup>
import {computed, onMounted, watch} from 'vue';
import iconUrl from '@images/icon.png';
import {dbd} from './services/bridge';
import {debugLog} from './services/logger';
import {settings} from './services/settings';
import {catalog} from './services/catalog';
import {player} from './services/player';
import {lobby} from './services/lobby';
import {hotkeys} from './services/hotkeys';
import {detection} from './services/detection';
import {ui, notify} from './services/ui';
import {CONTRIBUTE_URL} from './services/constants';
import NowShowing from './components/NowShowing.vue';
import LanguageDialog from './components/LanguageDialog.vue';
import MapsView from './views/MapsView.vue';
import LobbyView from './views/LobbyView.vue';
import CustomMapsView from './views/CustomMapsView.vue';
import SettingsView from './views/SettingsView.vue';
import DocView from './views/DocView.vue';

const mainItems = [
  {value: 'maps', title: 'Maps', icon: 'mdi-map-search-outline'},
  {value: 'lobby', title: 'Lobby', icon: 'mdi-account-group-outline'},
  {value: 'custom', title: 'Custom maps', icon: 'mdi-image-plus-outline'},
  {value: 'settings', title: 'Settings', icon: 'mdi-cog-outline'},
];
const infoItems = [
  {value: 'faq', title: 'FAQ', icon: 'mdi-help-circle-outline'},
  {value: 'changelog', title: 'Changelog', icon: 'mdi-history'},
  {value: 'credits', title: 'Credits', icon: 'mdi-heart-outline'},
  {value: 'privacy', title: 'Privacy & Terms', icon: 'mdi-shield-account-outline'},
];
const titles = Object.fromEntries([...mainItems, ...infoItems].map(i => [i.value, i.title]));
const viewTitle = computed(() => titles[ui.view] || '');
const showing = computed(() => player.state.lastMap !== '');

function select(values) {
  if (values && values.length) ui.view = values[0];
}

async function toggleDetection(on) {
  try {
    await detection.setEnabled(on);
  } catch (e) {
    notify(`Auto-detect: ${e.message}`, 'error');
  }
}

function openObs() {
  dbd.send('obs-open');
  player.sendMap(player.state.lastMap, player.state.lastMapType);
}

// Sample map on the overlay only while the Overlay settings tab is on screen
// (minimize/tray hides the page, so the preview leaves the overlay too).
const previewWanted = computed(() => ui.view === 'settings' && ui.settingsTab === 'overlay' && ui.pageVisible);
watch(previewWanted, (on) => (on ? player.startPreview() : player.stopPreview()));

dbd.on('update-message', (message) => notify(message));

player.listen();
lobby.listen();
hotkeys.listen();
detection.listen();

onMounted(async () => {
  dbd.invoke('app-info').then(info => Object.assign(ui.info, info));
  await settings.init();
  ui.galleryCreator = settings.get('preferredCreator') || '';
  const progress = dbd.on('maps-sync-progress', (text) => {
    if (text) ui.loading.text = text;
  });
  ui.loading.active = true;
  ui.loading.text = 'Checking for map updates';
  try {
    await dbd.invoke('maps-sync');
  } catch (e) {
    debugLog('app::maps-sync::error', e.message);
  } finally {
    progress();
  }
  ui.loading.text = 'Loading maps';
  await catalog.load();
  ui.loading.active = false;
  await hotkeys.load();
  if (settings.get('disableFaqPopup') !== true) {
    notify('Map not showing over the game in fullscreen? Check the FAQ.', 'surface-variant', 10000);
  }
});
</script>

<style scoped>
.nav {
  background: #0f1015 !important;
  border-right: 1px solid rgba(255, 255, 255, 0.06) !important;
  box-shadow: 8px 0 24px rgba(0, 0, 0, 0.35);
}

.nav-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 60px;
  padding: 0 12px;
  overflow: hidden;
  white-space: nowrap;
}

.nav-logo {
  width: 40px;
  height: 40px;
  flex: none;
  filter: drop-shadow(0 0 8px rgba(224, 53, 63, 0.35));
}

.nav-brand-text {
  font-size: 1.05rem;
  font-weight: 600;
}

.topbar {
  background: rgba(12, 13, 17, 0.7) !important;
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;
}

.main {
  height: 100vh;
}

.detect :deep(.v-selection-control) {
  min-height: 0;
}

.loading-logo {
  width: 120px;
  filter: drop-shadow(0 0 24px rgba(224, 53, 63, 0.45));
}
</style>
