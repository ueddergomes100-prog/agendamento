import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import {fileURLToPath} from 'node:url';
import {build as bundleWorker} from 'esbuild';

// The same customer experience, delivered as static assets on Vercel.
// Production operations use Firebase Authentication and callable Cloud Functions.
export default defineConfig({
  plugins:[react(),{name:'firebase-push-worker',async closeBundle(){await bundleWorker({entryPoints:['worker/push.ts'],outfile:'dist-vercel/sw.js',bundle:true,minify:true,format:'iife',target:'es2020'});}}],
  resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},
  css:{postcss:{plugins:[tailwindcss()]}},
  build:{outDir:'dist-vercel',emptyOutDir:true},
});
