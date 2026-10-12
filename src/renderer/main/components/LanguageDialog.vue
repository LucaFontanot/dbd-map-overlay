<template>
  <v-dialog v-model="detection.state.languageDialog" max-width="440">
    <v-card>
      <v-card-item prepend-icon="mdi-translate">
        <v-card-title>Game language required</v-card-title>
      </v-card-item>
      <v-card-text>
        <p class="mb-4 opacity-80">
          Pick the language Dead by Daylight runs in. Reading a single language is faster and more
          accurate than trying all of them.
        </p>
        <v-select v-model="lang" :items="OCR_LANGUAGES" label="Game language" hide-details/>
      </v-card-text>
      <v-card-actions>
        <v-spacer/>
        <v-btn variant="text" @click="detection.state.languageDialog = false">Cancel</v-btn>
        <v-btn color="primary" variant="flat" @click="confirm">Save &amp; enable detection</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import {ref} from 'vue';
import {detection} from '../services/detection';
import {OCR_LANGUAGES} from '../services/constants';
import {notify} from '../services/ui';

const lang = ref('eng');

async function confirm() {
  try {
    await detection.confirmLanguage(lang.value);
  } catch (e) {
    notify(`Auto-detect: ${e.message}`, 'error');
  }
}
</script>
