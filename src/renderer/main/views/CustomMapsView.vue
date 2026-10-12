<template>
  <div class="page">
    <div class="page-inner">
      <div class="page-title">Custom maps</div>
      <div class="page-subtitle">Add your own images. They show up in the gallery under the “Custom” creator.</div>

      <v-card class="pa-2 mb-6">
        <v-card-text>
          <form class="d-flex flex-wrap ga-3 align-start" @submit.prevent="add">
            <v-text-field v-model="name" placeholder="Map name" prepend-inner-icon="mdi-format-title"
                          hide-details class="field"/>
            <v-file-input v-model="file" accept="image/*" placeholder="Choose an image" prepend-icon=""
                          prepend-inner-icon="mdi-image-outline" hide-details class="field"/>
            <v-btn type="submit" color="primary" size="large" :loading="saving" :disabled="!name || !file"
                   prepend-icon="mdi-plus">Add map</v-btn>
          </form>
          <div class="text-caption opacity-60 mt-3">By adding an image you agree to comply with the terms of service.</div>
        </v-card-text>
      </v-card>

      <div v-if="items.length" class="grid">
        <v-card v-for="item in items" :key="item.path" class="custom-card">
          <div class="thumb">
            <v-img :src="catalog.thumbUrl(item.path, 'custom')" aspect-ratio="1.333"/>
          </div>
          <div class="d-flex align-center pa-3 ga-2">
            <span class="text-truncate font-weight-medium" :title="item.name">{{ item.name }}</span>
            <v-spacer/>
            <v-btn icon="mdi-delete-outline" variant="text" color="error" size="small"
                   @click="remove(item)"/>
          </div>
        </v-card>
      </div>
      <div v-else class="empty opacity-60">
        <v-icon icon="mdi-image-off-outline" size="48" class="mb-2"/>
        <div>No custom maps yet</div>
      </div>
    </div>

    <v-dialog v-model="confirm.show" max-width="400">
      <v-card>
        <v-card-title class="pt-4">Delete “{{ confirm.item && confirm.item.name }}”?</v-card-title>
        <v-card-text class="opacity-80">The image is removed from this computer.</v-card-text>
        <v-card-actions>
          <v-spacer/>
          <v-btn variant="text" @click="confirm.show = false">Cancel</v-btn>
          <v-btn color="error" variant="flat" @click="doRemove">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import {computed, reactive, ref} from 'vue';
import {dbd} from '../services/bridge';
import {debugLog} from '../services/logger';
import {catalog} from '../services/catalog';
import {notify} from '../services/ui';

const name = ref('');
const file = ref(null);
const saving = ref(false);
const confirm = reactive({show: false, item: null});

const items = computed(() => catalog.state.customMaps.map(path => ({
  path,
  name: path.replace(/\\/g, '/').split('/').pop().replace(/\.[^/.]+$/, ''),
})));

async function add() {
  const picked = Array.isArray(file.value) ? file.value[0] : file.value;
  if (!picked || !name.value) return;
  saving.value = true;
  try {
    const bytes = new Uint8Array(await picked.arrayBuffer());
    // Path separators and dots would make a different (or invalid) file name
    const safeName = name.value.replace(/[/\\.]/g, ' ').trim();
    await dbd.invoke('write-custom-data', `${safeName}.png`, bytes);
    await catalog.reload();
    name.value = '';
    file.value = null;
    notify('Custom map added', 'success', 2500);
  } catch (e) {
    debugLog('custom::add::error', e.message);
    notify('Could not add the image: is it a valid picture?', 'error');
  } finally {
    saving.value = false;
  }
}

function remove(item) {
  Object.assign(confirm, {show: true, item});
}

async function doRemove() {
  const item = confirm.item;
  confirm.show = false;
  try {
    await dbd.invoke('delete-custom-data', item.path);
    await catalog.reload();
  } catch (e) {
    debugLog('custom::delete::error', e.message);
    notify('Could not delete the image', 'error');
  }
}
</script>

<style scoped>
.field {
  flex: 1 1 240px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
}

.thumb {
  background: radial-gradient(circle at 50% 40%, #1d2029, #101116);
  padding: 10px;
}

.empty {
  text-align: center;
  padding: 48px 0;
}
</style>
