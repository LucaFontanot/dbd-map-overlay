<template>
  <v-dialog :model-value="modelValue" max-width="520" @update:model-value="$emit('update:modelValue', $event)">
    <v-card>
      <v-card-item prepend-icon="mdi-keyboard-outline">
        <v-card-title>{{ actionId ? `Change hotkey: ${SYSTEM_HOTKEY_DEFS[actionId].description}` : 'New map hotkey' }}</v-card-title>
      </v-card-item>
      <v-card-text>
        <div class="label">Key combination</div>
        <div ref="captureEl" tabindex="0" :class="['capture', {listening}]" @keydown.prevent="onKey"
             @focus="listening = true" @blur="listening = false">
          <kbd v-if="combo">{{ combo }}</kbd>
          <span v-else class="opacity-60">{{ listening ? 'Press the keys…' : 'Click here, then press the keys' }}</span>
        </div>
        <template v-if="!actionId">
          <div class="label mt-5">Creator</div>
          <v-select v-model="creator" :items="catalog.state.creators" hide-details placeholder="Select a creator"/>
          <div class="label mt-4">Map</div>
          <v-autocomplete v-model="mapKey" :items="mapItems" hide-details placeholder="Search a map"
                          :disabled="!creator" no-data-text="No maps for this creator">
            <template #item="{ props, item }">
              <v-list-item v-bind="props" :subtitle="item.raw.realm"/>
            </template>
          </v-autocomplete>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer/>
        <v-btn variant="text" @click="close">Cancel</v-btn>
        <v-btn color="primary" variant="flat" :disabled="!canSave" @click="save">Save hotkey</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import {computed, nextTick, ref, watch} from 'vue';
import {catalog} from '../services/catalog';
import {hotkeys, keyEventToDisplay, SYSTEM_HOTKEY_DEFS} from '../services/hotkeys';

const props = defineProps({
  modelValue: {type: Boolean, default: false},
  // System action being edited, or null for a new map hotkey
  actionId: {type: String, default: null},
});
const emit = defineEmits(['update:modelValue']);

const captureEl = ref(null);
const listening = ref(false);
const combo = ref('');
const creator = ref('');
const mapKey = ref(null);

const mapItems = computed(() => {
  const realms = catalog.state.mapDictionary[creator.value] || {};
  return Object.entries(realms).flatMap(([realm, maps]) => maps.map(name => ({
    title: name.replace(/\.[^/.]+$/, ''),
    value: `${creator.value}/${realm}/${name}`,
    realm,
  })));
});

// A combination needs a real key, not only modifiers
const comboComplete = computed(() => combo.value !== '' && !combo.value.endsWith('+ ') &&
    !['Ctrl', 'Meta', 'Alt', 'Shift'].includes(combo.value.split(' + ').pop()));
const canSave = computed(() => comboComplete.value && (props.actionId || mapKey.value));

watch(() => props.modelValue, async (open) => {
  if (!open) return;
  combo.value = '';
  mapKey.value = null;
  creator.value = creator.value || catalog.state.creators[0] || '';
  await nextTick();
  captureEl.value && captureEl.value.focus();
});
watch(creator, () => {
  mapKey.value = null;
});

function onKey(e) {
  combo.value = keyEventToDisplay(e);
}

function close() {
  emit('update:modelValue', false);
}

function save() {
  if (props.actionId) {
    hotkeys.saveSystem(props.actionId, combo.value);
  } else {
    hotkeys.saveMap(combo.value, mapKey.value);
  }
  close();
}
</script>

<style scoped>
.label {
  font-size: 0.85rem;
  opacity: 0.75;
  margin-bottom: 6px;
}

.capture {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 64px;
  border-radius: 10px;
  border: 1px dashed rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  outline: none;
  font-size: 1.1rem;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.capture.listening {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(224, 53, 63, 0.08);
}
</style>
