<template>
  <div class="pa-6">
    <v-alert type="info" icon="mdi-linux" class="mb-5">
      Works with <a :href="STREAM_CONTROLLER_URL" target="_blank" rel="noopener noreferrer">Stream Controller</a>,
      a Linux app for Stream Decks. For other setups use the
      <a :href="CLI_DOCS_URL" target="_blank" rel="noopener noreferrer">command line support</a>.
    </v-alert>

    <div class="label">Stream Controller installation</div>
    <v-radio-group v-model="installType" hide-details class="mb-2">
      <v-radio value="flatpak" label="Flatpak (written to its data folder)"/>
      <v-radio value="system" label="Choose the output folder myself"/>
    </v-radio-group>

    <v-row dense>
      <v-col cols="12" md="4">
        <div class="label">Buttons on your deck</div>
        <v-text-field v-model.number="buttonCount" type="number" min="4" max="64" hide-details/>
      </v-col>
      <v-col cols="12" md="8">
        <div class="label">Creator</div>
        <v-select v-model="creator" :items="catalog.state.creators" hide-details placeholder="Select a creator"/>
      </v-col>
      <v-col cols="12">
        <div class="label">Command prefix</div>
        <v-text-field v-model="commandPrefix" hide-details/>
      </v-col>
      <v-col v-if="installType === 'system'" cols="12">
        <div class="label">Output folder</div>
        <v-text-field :model-value="outputDir" readonly hide-details placeholder="No folder selected">
          <template #append-inner>
            <v-btn variant="tonal" size="small" @click="browse">Browse</v-btn>
          </template>
        </v-text-field>
      </v-col>
    </v-row>

    <v-alert type="warning" variant="text" icon="mdi-alert-outline" class="px-0 mt-3">
      Install the Font Awesome icon pack in Stream Controller, otherwise the navigation icons are missing.
    </v-alert>

    <v-btn color="primary" prepend-icon="mdi-content-save-outline" class="mt-2" :loading="saving"
           :disabled="!creator || (installType === 'system' && !outputDir)" @click="create">Create configs</v-btn>
  </div>
</template>

<script setup>
import {ref} from 'vue';
import {dbd} from '../../services/bridge';
import {debugLog} from '../../services/logger';
import {catalog} from '../../services/catalog';
import {notify} from '../../services/ui';
import {CLI_DOCS_URL, STREAM_CONTROLLER_URL} from '../../services/constants';

const installType = ref('flatpak');
const buttonCount = ref(6);
const commandPrefix = ref('dbd-map-tool');
const creator = ref('');
const outputDir = ref('');
const saving = ref(false);

async function browse() {
  try {
    const result = await dbd.invoke('dialog:selectDirectory');
    if (result && !result.canceled && result.filePaths.length) outputDir.value = result.filePaths[0];
  } catch (e) {
    debugLog('streamdeck::browse::error', e.message);
  }
}

async function create() {
  saving.value = true;
  try {
    // Main checks every name before it reaches a page file or shell command
    const realms = JSON.parse(JSON.stringify(catalog.state.mapDictionary[creator.value] || {}));
    const result = await dbd.invoke('streamdeck:create', {
      installType: installType.value,
      outputDir: outputDir.value,
      buttonCount: buttonCount.value,
      commandPrefix: commandPrefix.value,
      creator: creator.value,
      realms,
    });
    notify(`Created ${result.pages} Stream Controller pages`, 'success');
  } catch (e) {
    debugLog('streamdeck::create::error', e.message);
    // Electron prefixes handler errors with "Error invoking remote method ..."
    notify(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error', 8000);
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.label {
  font-size: 0.85rem;
  opacity: 0.75;
  margin-bottom: 6px;
}
</style>
