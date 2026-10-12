<template>
  <div class="page">
    <div class="toolbar">
      <div class="toolbar-inner d-flex ga-3 align-center">
        <v-text-field v-model="query" placeholder="Search maps or realms…" prepend-inner-icon="mdi-magnify"
                      clearable hide-details autofocus class="flex-grow-1"/>
        <v-select v-model="ui.galleryCreator" :items="creatorItems" prepend-inner-icon="mdi-palette-outline"
                  hide-details class="creator" @update:model-value="onCreator"/>
      </div>
    </div>
    <div class="page-inner pt-2">
      <div class="d-flex align-center mb-3 text-body-2 opacity-60">
        <span>{{ results.length }} {{ results.length === 1 ? 'map' : 'maps' }}</span>
        <span v-if="query" class="ms-1">for “{{ query }}”</span>
        <v-spacer/>
        <span>Click a map to put it on the overlay</span>
      </div>
      <v-alert v-if="catalog.state.loadError" type="error" class="mb-4"
               :text="`Could not read the local maps: ${catalog.state.loadError}`"/>
      <div v-if="results.length" class="grid">
        <MapCard v-for="item in results" :key="item.path" :src="catalog.thumbUrl(item.path)"
                 :name="stripExt(item.name)" :realm="item.realm" :creator="item.creator"
                 :active="item.path === player.state.lastMap" @pick="pick(item)"/>
      </div>
      <div v-else-if="catalog.state.loaded" class="empty">
        <v-icon icon="mdi-map-search-outline" size="56" class="opacity-40 mb-3"/>
        <div class="text-h6">No maps found</div>
        <div class="opacity-60">
          {{ query ? 'Try another spelling or clear the creator filter.' : 'Maps download on start; check your connection and restart the app.' }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import {computed, ref, watch} from 'vue';
import {catalog} from '../services/catalog';
import {player} from '../services/player';
import {ui} from '../services/ui';
import MapCard from '../components/MapCard.vue';

const query = ref('');
const debounced = ref('');
let timer = null;
watch(query, (value) => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    debounced.value = value || '';
  }, 120);
});

const creatorItems = computed(() => [
  {title: 'All creators', value: ''},
  ...catalog.state.creators.map(c => ({title: c, value: c})),
]);

const results = computed(() => catalog.search(debounced.value, ui.galleryCreator));

const stripExt = (name) => name.replace(/\.[^/.]+$/, '');

function pick(item) {
  player.sendMap(item.path, catalog.typeOf(item.path));
}

// Remaps the live overlay to the same map in that creator's layout
function onCreator(creator) {
  player.onCreatorLayoutChanged(creator || '');
}
</script>

<style scoped>
.toolbar {
  position: sticky;
  top: 0;
  z-index: 2;
  background: linear-gradient(rgb(var(--v-theme-background)) 70%, transparent);
}

.toolbar-inner {
  max-width: 1100px;
  margin: 0 auto;
  padding: 20px 28px 12px;
}

.creator {
  max-width: 240px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 16px;
}

.empty {
  text-align: center;
  padding: 80px 0;
}
</style>
