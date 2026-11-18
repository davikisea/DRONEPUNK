import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    define: {
      'process.env': {},
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        '@domains': path.resolve(__dirname, 'src/domains'),
        '@shared': path.resolve(__dirname, 'src/shared'),
      },
    },
    server: {
      port: 5000,
      host: '0.0.0.0',
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    preview: {
      port: 5000,
      host: '0.0.0.0',
    },
      build: {
        target: 'es2022',
        minify: 'esbuild' as const,
        cssMinify: true,
        assetsInlineLimit: 4096,
        chunkSizeWarningLimit: 650,
        rolldownOptions: {
          output: {
            codeSplitting: {
              maxSize: 550_000,
              groups: [
                { name: 'vendor-react', test: /node_modules[\\/](react|react-dom)[\\/]/, priority: 30 },
                { name: 'vendor-lucide', test: /node_modules[\\/]lucide-react[\\/]/, priority: 30 },
                { name: 'vendor-supabase', test: /node_modules[\\/]@supabase[\\/]/, priority: 30 },
                { name: 'vendor-motion', test: /node_modules[\\/]motion[\\/]/, priority: 30 },
                { name: 'vendor-maplibre', test: /node_modules[\\/]maplibre-gl[\\/]/, priority: 30 },
                { name: 'vendor-genai', test: /node_modules[\\/]@google[\\/]genai[\\/]/, priority: 30 },
                { name: 'vendor-topojson', test: /node_modules[\\/]topojson/, priority: 30 },
                { name: 'domain-world', test: /src[\\/]domains[\\/]world[\\/]/, priority: 20, minSize: 0 },
                { name: 'domain-tactics', test: /src[\\/]domains[\\/]tactics[\\/]/, priority: 20, minSize: 0 },
                { name: 'domain-economy', test: /src[\\/]domains[\\/]economy[\\/]/, priority: 20, minSize: 0 },
                { name: 'domain-game-feel', test: /src[\\/]domains[\\/]game-feel[\\/]/, priority: 20, minSize: 0 },
                { name: 'domain-shared', test: /src[\\/]shared[\\/]/, priority: 20, minSize: 0 },
              ],
            },
          },
        },
      },
  };
});
