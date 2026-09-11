import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import {fileURLToPath} from 'node:url';

// The same customer experience, delivered as static assets on Vercel.
// Production operations use Firebase Authentication and callable Cloud Functions.
export default defineConfig({
  plugins:[react()],
  resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},
  css:{postcss:{plugins:[tailwindcss()]}},
  build:{outDir:'dist-vercel',emptyOutDir:true},
});
