<template>
  <div class="pa-6">
    <v-alert type="info" icon="mdi-eye-outline" class="mb-6">
      While this tab is open the overlay shows a preview image, so you can see every change live.
    </v-alert>

    <v-row>
      <v-col cols="12" md="6">
        <div class="label">Monitor</div>
        <v-select v-model="monitor" :items="displays" item-title="label" item-value="index" hide-details
                  prepend-inner-icon="mdi-monitor" @update:model-value="saveNow('monitor', $event)"/>
      </v-col>
      <v-col cols="12" md="6">
        <div class="label">Rotation</div>
        <v-btn-toggle v-model="rotation" mandatory color="primary" variant="outlined" divided density="comfortable"
                      @update:model-value="saveNow('rotation', $event)">
          <v-btn v-for="deg in [0, 90, 180, 270]" :key="deg" :value="deg">{{ deg }}°</v-btn>
        </v-btn-toggle>
      </v-col>

      <v-col cols="12" md="6">
        <div class="label">Size <span class="value">{{ size }} px</span></div>
        <v-slider v-model="size" :min="50" :max="500" :step="50" show-ticks="always" tick-size="2"
                  @update:model-value="live('size', $event)" @end="final('size', $event)"/>
      </v-col>
      <v-col cols="12" md="6">
        <div class="label">Opacity <span class="value">{{ Math.round(opacity * 100) }}%</span></div>
        <v-slider v-model="opacity" :min="0.1" :max="1" :step="0.1"
                  @update:model-value="live('opacity', $event)" @end="final('opacity', $event)"/>
      </v-col>
    </v-row>

    <v-divider class="my-4"/>

    <div class="section-title">Position</div>
    <v-row>
      <v-col cols="12" md="5">
        <div class="label">Corner</div>
        <v-select v-model="position" :items="corners" :disabled="draggable" hide-details
                  prepend-inner-icon="mdi-arrow-top-left-bottom-right" @update:model-value="onCorner"/>
        <v-btn variant="text" size="small" class="mt-2" prepend-icon="mdi-magnet" :disabled="draggable"
               @click="snap">Snap to the selected corner</v-btn>
      </v-col>
      <v-col cols="12" md="7">
        <div class="label">Horizontal <span class="value">{{ glideX }}%</span></div>
        <v-slider v-model="glideX" :min="0" :max="100" :step="1" :disabled="draggable"
                  @update:model-value="live('glideX', $event)" @end="final('glideX', $event)"/>
        <div class="label mt-2">Vertical <span class="value">{{ glideY }}%</span></div>
        <v-slider v-model="glideY" :min="0" :max="100" :step="1" :disabled="draggable"
                  @update:model-value="live('glideY', $event)" @end="final('glideY', $event)"/>
        <div class="text-caption opacity-60">0 is the left/top edge of the screen, 100 the right/bottom edge.</div>
      </v-col>
    </v-row>

    <v-divider class="my-4"/>

    <v-list class="bg-transparent pa-0" lines="two">
      <v-list-item class="px-0">
        <v-list-item-title>Hide the overlay</v-list-item-title>
        <v-list-item-subtitle>Maps still reach the OBS window and the lobby.</v-list-item-subtitle>
        <template #append>
          <v-switch :model-value="settings.get('hideOverlay') === true" @update:model-value="setHidden"/>
        </template>
      </v-list-item>
      <v-list-item class="px-0">
        <v-list-item-title>Drag the overlay with the mouse</v-list-item-title>
        <v-list-item-subtitle>Replaces the corner and sliders with a position you drag yourself.</v-list-item-subtitle>
        <template #append>
          <v-switch :model-value="draggable" @update:model-value="setDraggable"/>
        </template>
      </v-list-item>
    </v-list>

    <v-expand-transition>
      <div v-if="draggable">
        <v-alert v-if="ui.info.wayland" type="warning" class="mb-3">
          Your session runs on Wayland, where dragging the overlay does not work. Turn this off and use the sliders.
        </v-alert>
        <v-card variant="tonal" class="pa-4">
          <div class="d-flex align-center ga-4 flex-wrap">
            <v-btn :color="player.state.settingPosition ? 'warning' : 'primary'" variant="flat"
                   :prepend-icon="player.state.settingPosition ? 'mdi-stop' : 'mdi-cursor-move'"
                   @click="player.setPositioning(!player.state.settingPosition)">
              {{ player.state.settingPosition ? 'Stop setting position' : 'Set position' }}
            </v-btn>
            <div class="text-body-2 opacity-80 flex-grow-1" style="flex-basis: 260px">
              Show any map, press “Set position”, drag the overlay where you want it, then press
              “Stop setting position”.
            </div>
          </div>
          <v-alert type="warning" variant="text" density="compact" class="mt-2 pa-0" icon="mdi-alert-outline">
            Leaving it on makes the overlay catch the mouse while you play.
          </v-alert>
        </v-card>
      </div>
    </v-expand-transition>
  </div>
</template>

<script setup>
import {onMounted, ref, watch} from 'vue';
import overlayPosition from '@core/overlay-position.js';
import {dbd} from '../../services/bridge';
import {settings} from '../../services/settings';
import {player} from '../../services/player';
import {ui, notify} from '../../services/ui';

const {presetToGlide} = overlayPosition;

const corners = [
  {title: 'Top left', value: 1},
  {title: 'Top right', value: 2},
  {title: 'Bottom left', value: 3},
  {title: 'Bottom right', value: 4},
];

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const displays = ref([{index: 0, label: 'Primary monitor'}]);
const monitor = ref(num(settings.get('monitor'), 0));
const size = ref(num(settings.get('size'), 250));
const opacity = ref(num(settings.get('opacity'), 0.5));
const position = ref(num(settings.get('position'), 1));
// Snap any stored value to the nearest quarter turn in case a stray rotation got saved
const rotation = ref((Math.round(num(settings.get('rotation'), 0) / 90) * 90) % 360);
// A saved 0 is a real position; only null means "unset -- follow the corner preset"
const corner = presetToGlide(position.value);
const glideX = ref(settings.get('glideX') ?? corner.x);
const glideY = ref(settings.get('glideY') ?? corner.y);
const draggable = ref(settings.get('draggable') === true);

// Rotation also changes from the rotate hotkey and the lobby
watch(() => settings.get('rotation'), (value) => {
  rotation.value = (Math.round(num(value, 0) / 90) * 90) % 360;
});

onMounted(async () => {
  try {
    displays.value = await dbd.invoke('get-displays');
  } catch (e) {
    // keep the primary-monitor fallback
  }
});

async function write(key, value) {
  try {
    await settings.set(key, value);
  } catch (e) {
    notify('Could not save the setting', 'error');
  }
}

async function saveNow(key, value) {
  await write(key, value);
  // Rotation is shared with the lobby, the other overlay settings are local
  player.refresh({lobby: key === 'rotation'});
}

// Sliders: while dragging, the value goes to main at most every 60 ms (main
// positions the overlay from settings, so the live preview needs it there
// first); drag end always writes the final value immediately.
const pending = {};
const timers = {};

function live(key, value) {
  pending[key] = value;
  if (timers[key]) return;
  timers[key] = setTimeout(async () => {
    timers[key] = null;
    if (!(key in pending)) return;
    const v = pending[key];
    delete pending[key];
    await write(key, v);
    player.refresh();
  }, 60);
}

async function final(key, value) {
  clearTimeout(timers[key]);
  timers[key] = null;
  delete pending[key];
  await saveNow(key, value);
}

// The corner preset doubles as a glide shortcut: picking a corner snaps both
// sliders to it, then they can fine-tune from there
async function snapGlide() {
  const target = presetToGlide(position.value);
  glideX.value = target.x;
  glideY.value = target.y;
  await write('glideX', target.x);
  await write('glideY', target.y);
}

async function onCorner(value) {
  await write('position', value);
  await snapGlide();
  player.refresh();
}

async function snap() {
  await snapGlide();
  player.refresh();
}

async function setHidden(value) {
  await write('hideOverlay', !!value);
  player.refresh();
}

async function setDraggable(value) {
  draggable.value = !!value;
  await write('draggable', draggable.value);
  if (!draggable.value && player.state.settingPosition) player.setPositioning(false);
  player.refresh();
}
</script>

<style scoped>
.section-title {
  font-weight: 600;
  margin-bottom: 8px;
}

.label {
  font-size: 0.85rem;
  opacity: 0.75;
  margin-bottom: 6px;
}

.value {
  float: right;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--v-theme-secondary));
  opacity: 1;
}
</style>
