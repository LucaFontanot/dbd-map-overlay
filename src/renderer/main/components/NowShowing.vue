<template>
  <v-chip v-if="current" variant="tonal" color="secondary" prepend-icon="mdi-map-marker-radius" class="now">
    <span class="text-truncate">
      <strong>{{ current.name }}</strong>
      <span v-if="current.realm" class="opacity-70"> · {{ current.realm }}</span>
    </span>
  </v-chip>
  <v-chip v-else variant="text" class="opacity-50 now" prepend-icon="mdi-map-marker-off-outline">No map on overlay</v-chip>
</template>

<script setup>
import {computed} from 'vue';
import {player} from '../services/player';

const current = computed(() => player.state.lastMap !== '' ? player.current() : null);
</script>

<style scoped>
.now {
  max-width: 340px;
}
</style>
