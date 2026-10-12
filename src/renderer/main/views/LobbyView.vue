<template>
  <div class="page">
    <div class="page-inner narrow">
      <div class="page-title">Lobby</div>
      <div class="page-subtitle">Share the overlay with friends: the map one of you picks shows up for everyone.</div>

      <v-card v-if="!lobby.state.joined" class="pa-2">
        <v-card-item prepend-icon="mdi-login-variant">
          <v-card-title>Join a lobby</v-card-title>
          <v-card-subtitle>Ask the lobby creator for the code</v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <form class="d-flex ga-3" @submit.prevent="join">
            <v-text-field v-model="code" :type="showCode ? 'text' : 'password'" placeholder="Lobby code"
                          inputmode="numeric" hide-details :append-inner-icon="showCode ? 'mdi-eye-off' : 'mdi-eye'"
                          @click:append-inner="showCode = !showCode"/>
            <v-btn type="submit" color="primary" size="large" :loading="lobby.state.busy" :disabled="!code">Join</v-btn>
          </form>
        </v-card-text>
        <v-divider class="mx-4"/>
        <v-card-item prepend-icon="mdi-plus-circle-outline">
          <v-card-title>Create a lobby</v-card-title>
          <v-card-subtitle>Get a code to share with your team</v-card-subtitle>
          <template #append>
            <v-btn color="secondary" variant="tonal" :loading="lobby.state.busy" @click="create">Create lobby</v-btn>
          </template>
        </v-card-item>
      </v-card>

      <v-card v-else class="pa-2">
        <v-card-item prepend-icon="mdi-account-group">
          <v-card-title>{{ lobby.state.creator ? 'Your lobby' : 'Joined lobby' }}</v-card-title>
          <template #append>
            <v-chip :color="lobby.state.closed ? 'warning' : 'success'" variant="tonal" size="small">
              {{ lobby.state.closed ? 'Closed to new players' : 'Open' }}
            </v-chip>
          </template>
        </v-card-item>
        <v-card-text>
          <v-text-field :model-value="lobby.state.code" :type="showCode ? 'text' : 'password'" readonly
                        label="Lobby code" hide-details class="mb-4">
            <template #append-inner>
              <v-btn :icon="showCode ? 'mdi-eye-off' : 'mdi-eye'" variant="text" size="small"
                     @click="showCode = !showCode"/>
              <v-btn icon="mdi-content-copy" variant="text" size="small" @click="copy"/>
            </template>
          </v-text-field>
          <div class="d-flex flex-wrap ga-2">
            <template v-if="lobby.state.creator">
              <v-btn v-if="!lobby.state.closed" color="warning" variant="tonal" prepend-icon="mdi-lock-outline"
                     :loading="lobby.state.busy" @click="lobby.setOpen(false)">Close lobby</v-btn>
              <v-btn v-else color="success" variant="tonal" prepend-icon="mdi-lock-open-variant-outline"
                     :loading="lobby.state.busy" @click="lobby.setOpen(true)">Open lobby</v-btn>
            </template>
            <v-btn color="error" variant="tonal" prepend-icon="mdi-logout" :loading="lobby.state.busy"
                   @click="lobby.leave()">Leave lobby</v-btn>
          </div>
        </v-card-text>
        <v-alert type="info" variant="tonal" class="mx-4 mb-4" icon="mdi-update">
          The map is checked every 15 seconds. Press <kbd>{{ lobbyHotkey }}</kbd> to check now, also in game.
        </v-alert>
      </v-card>
    </div>
  </div>
</template>

<script setup>
import {computed, ref} from 'vue';
import {lobby} from '../services/lobby';
import {hotkeys, acceleratorToDisplay} from '../services/hotkeys';
import {notify} from '../services/ui';

const code = ref('');
const showCode = ref(false);
const lobbyHotkey = computed(() => acceleratorToDisplay(hotkeys.systemAccelerator('check-lobby')));

async function join() {
  const value = parseInt(code.value, 10);
  if (Number.isNaN(value)) {
    notify('Please enter a valid code', 'warning');
    return;
  }
  if (await lobby.join(value)) {
    code.value = '';
  } else {
    notify('Could not join the lobby. Check the code and try again.', 'error');
  }
}

async function create() {
  if (!(await lobby.create())) notify('Could not create the lobby. Try again later.', 'error');
}

async function copy() {
  try {
    await navigator.clipboard.writeText(lobby.state.code);
    notify('Lobby code copied', 'success', 2000);
  } catch (e) {
    notify('Could not copy the code', 'error');
  }
}
</script>

<style scoped>
.narrow {
  max-width: 640px;
}
</style>
