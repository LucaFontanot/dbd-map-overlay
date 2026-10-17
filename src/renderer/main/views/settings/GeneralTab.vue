<template>
  <div class="pa-6">
    <v-list class="bg-transparent pa-0" lines="two">
      <v-list-item class="px-0">
        <v-list-item-title>Minimize to tray</v-list-item-title>
        <v-list-item-subtitle>Closing or minimizing the window keeps the app running in the system tray.</v-list-item-subtitle>
        <template #append>
          <v-switch :model-value="settings.get('minimizeToTray') === true"
                    @update:model-value="v => save('minimizeToTray', !!v)"/>
        </template>
      </v-list-item>
      <v-list-item class="px-0">
        <v-list-item-title>Hide the FAQ tip on start</v-list-item-title>
        <v-list-item-subtitle>The reminder about fullscreen mode shown when the app opens.</v-list-item-subtitle>
        <template #append>
          <v-switch :model-value="settings.get('disableFaqPopup') === true"
                    @update:model-value="v => save('disableFaqPopup', !!v)"/>
        </template>
      </v-list-item>
      <v-list-item class="px-0">
        <v-list-item-title>Debug log</v-list-item-title>
        <v-list-item-subtitle>Saved to your Downloads folder. Attach it when reporting a problem. It never contains your lobby token.</v-list-item-subtitle>
        <template #append>
          <v-btn variant="tonal" prepend-icon="mdi-download" @click="download">Download</v-btn>
        </template>
      </v-list-item>
    </v-list>
  </div>
</template>

<script setup>
import {settings} from '../../services/settings';
import {saveLogs} from '../../services/logger';
import {notify} from '../../services/ui';

async function save(key, value) {
  try {
    await settings.set(key, value);
  } catch (e) {
    notify('Could not save the setting', 'error');
  }
}

async function download() {
  try {
    const file = await saveLogs();
    notify(`Debug log saved to ${file}`);
  } catch (e) {
    notify('Could not save the debug log', 'error');
  }
}
</script>
