import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

// A data folder next to this file (anchored so src/components/models or src/components/tools/series are NOT ignored).
const under = (name: string) => path.resolve(__dirname, name).split(path.sep).join('/') + '/**';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      proxy: {
        '/api': 'http://localhost:3000',
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        // Only source changes should reload the page; data, model and output files changing mid-chat
        // (or while Series renders) was reloading the page and aborting replies.
        ignored: [
          '**/.code-review-graph/**', '**/node_modules/**', '**/*.gguf', '**/memory.json', '**/config.json',
          under('models'), under('android'), under('dist'), under('series'), under('outputs'), under('modules'), under('GGUF'),
          '**/*.db', '**/*.db-*', '**/app.log', '**/chats.json', '**/comfy-tool*.json', '**/google.json', '**/recent-documents.json',
        ],
      },
    },
  };
});
