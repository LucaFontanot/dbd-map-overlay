<template>
  <div class="page">
    <div class="page-inner">
      <div class="page-title">{{ title }}</div>
      <div class="page-subtitle">Fetched from the project's GitHub repository</div>
      <v-card class="pa-6">
        <img v-if="name === 'credits'" :src="iconUrl" alt="" class="credits-logo">
        <v-skeleton-loader v-if="loading" type="paragraph, paragraph, paragraph" color="transparent"/>
        <v-alert v-else-if="error" type="error" :text="error"/>
        <!-- html is DOMPurify-sanitized (services/markdown.js) -->
        <div v-else class="markdown-body" v-html="html"/>
      </v-card>
    </div>
  </div>
</template>

<script setup>
import {ref, watch} from 'vue';
import iconUrl from '@images/icon.png';
import {dbd} from '../services/bridge';
import {debugLog} from '../services/logger';
import {renderMarkdown} from '../services/markdown';

const props = defineProps({
  name: {type: String, required: true},
  title: {type: String, required: true},
});

const html = ref('');
const loading = ref(true);
const error = ref('');

watch(() => props.name, async (name) => {
  loading.value = true;
  error.value = '';
  try {
    html.value = renderMarkdown(await dbd.invoke('docs-get', name));
  } catch (e) {
    debugLog('docs::error', name, e.message);
    error.value = `Could not load this page. Check your connection and try again.`;
  } finally {
    loading.value = false;
  }
}, {immediate: true});
</script>

<style scoped>
.credits-logo {
  display: block;
  width: 160px;
  margin: 0 auto 16px;
}
</style>
