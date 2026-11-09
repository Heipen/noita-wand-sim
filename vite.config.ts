import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Local dev uses '/', GitHub Pages build passes --base=/noita-wand-sim/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
});
