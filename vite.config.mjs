// Builds the renderer pages (main window, overlay, OBS) into out/renderer.
// Main and preload stay plain CommonJS and are not bundled.
import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import {fileURLToPath} from 'node:url';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
    root: r('./src/renderer'),
    base: './',
    plugins: [vue(), vuetify({autoImport: true})],
    resolve: {
        alias: {
            '@core': r('./src/core'),
            '@shared': r('./src/shared'),
            '@images': r('./src/images'),
        },
    },
    build: {
        outDir: r('./out/renderer'),
        emptyOutDir: true,
        target: 'chrome130',
        chunkSizeWarningLimit: 1500,
        // The pure helpers shared with main are CommonJS
        commonjsOptions: {
            include: [/node_modules/, /src[\\/]core[\\/](map-match|overlay-position)\.js$/, /src[\\/]shared[\\/]/],
        },
        rollupOptions: {
            input: {
                index: r('./src/renderer/index.html'),
                overlay: r('./src/renderer/overlay.html'),
                obs: r('./src/renderer/obs.html'),
            },
        },
    },
});
