import { defineConfig } from 'vite';
import { attachRoom } from './src/server/socket.ts';

export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: 5176, strictPort: true },
  preview: { host: '127.0.0.1', port: 4176, strictPort: true },
  plugins: [{
    name: 'local-multiplayer-room',
    configureServer(server) { if (server.httpServer) attachRoom(server.httpServer); },
    configurePreviewServer(server) { attachRoom(server.httpServer); },
  }],
});
