<template>
  <div class="page">
    <div class="page-inner">
      <div class="page-title">Settings</div>
      <div class="page-subtitle">Changes are saved right away.</div>
      <v-card>
        <v-tabs v-model="ui.settingsTab" color="primary" grow>
          <v-tab value="general" prepend-icon="mdi-tune-variant">General</v-tab>
          <v-tab value="overlay" prepend-icon="mdi-picture-in-picture-top-right">Overlay</v-tab>
          <v-tab value="hotkeys" prepend-icon="mdi-keyboard-outline">Hotkeys</v-tab>
          <v-tab value="detection" prepend-icon="mdi-text-recognition">Detection</v-tab>
          <v-tab value="streamdeck" prepend-icon="mdi-view-grid-outline">Stream Deck</v-tab>
        </v-tabs>
        <v-divider/>
        <v-tabs-window v-model="ui.settingsTab">
          <v-tabs-window-item value="general"><GeneralTab/></v-tabs-window-item>
          <v-tabs-window-item value="overlay"><OverlayTab/></v-tabs-window-item>
          <v-tabs-window-item value="hotkeys"><HotkeysTab/></v-tabs-window-item>
          <v-tabs-window-item value="detection"><DetectionTab/></v-tabs-window-item>
          <v-tabs-window-item value="streamdeck"><StreamDeckTab/></v-tabs-window-item>
        </v-tabs-window>
      </v-card>
    </div>
  </div>
</template>

<script setup>
import {ui} from '../services/ui';
import GeneralTab from './settings/GeneralTab.vue';
import OverlayTab from './settings/OverlayTab.vue';
import HotkeysTab from './settings/HotkeysTab.vue';
import DetectionTab from './settings/DetectionTab.vue';
import StreamDeckTab from './settings/StreamDeckTab.vue';
</script>
