import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined;
          }

          if (id.includes('three')) {
            return 'three-vendor';
          }

          if (id.includes('satellite.js')) {
            return 'orbital-vendor';
          }

          if (id.includes('lil-gui')) {
            return 'ui-vendor';
          }

          return 'vendor';
        },
      },
    },
  },
});
