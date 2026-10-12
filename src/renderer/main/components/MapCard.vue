<template>
  <v-card :class="['map-card', {active}]" :ripple="false" @click="$emit('pick')">
    <div class="thumb">
      <v-img :src="src" aspect-ratio="1.333" class="thumb-img">
        <template #placeholder>
          <div class="d-flex align-center justify-center fill-height">
            <v-progress-circular indeterminate size="22" width="2" color="grey"/>
          </div>
        </template>
        <template #error>
          <div class="d-flex align-center justify-center fill-height opacity-40">
            <v-icon icon="mdi-image-broken-variant" size="32"/>
          </div>
        </template>
      </v-img>
      <v-chip v-if="active" size="x-small" color="primary" variant="flat" class="badge" prepend-icon="mdi-eye">
        On overlay
      </v-chip>
    </div>
    <div class="meta">
      <div class="name text-truncate" :title="name">{{ name }}</div>
      <div class="sub text-truncate opacity-70" :title="realm">{{ realm }}</div>
      <div class="sub creator text-truncate" :title="creator">{{ creator }}</div>
    </div>
  </v-card>
</template>

<script setup>
defineProps({
  src: {type: String, required: true},
  name: {type: String, required: true},
  realm: {type: String, default: ''},
  creator: {type: String, default: ''},
  active: {type: Boolean, default: false},
});
defineEmits(['pick']);
</script>

<style scoped>
.map-card {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(255, 255, 255, 0.06);
  transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
  cursor: pointer;
}

.map-card:hover {
  transform: translateY(-3px);
  border-color: rgba(224, 53, 63, 0.45);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
}

.map-card.active {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 0 0 1px rgb(var(--v-theme-primary)), 0 10px 30px rgba(224, 53, 63, 0.25);
}

.thumb {
  position: relative;
  background: radial-gradient(circle at 50% 40%, #1d2029, #101116);
  padding: 10px;
}

.thumb-img :deep(img) {
  object-fit: contain;
}

.badge {
  position: absolute;
  top: 8px;
  left: 8px;
}

.meta {
  padding: 10px 12px 12px;
}

.name {
  font-weight: 600;
  font-size: 0.95rem;
}

.sub {
  font-size: 0.78rem;
  line-height: 1.35;
}

.creator {
  color: rgb(var(--v-theme-secondary));
}
</style>
