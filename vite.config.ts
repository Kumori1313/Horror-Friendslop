import { defineConfig, loadEnv } from 'vite';
import { attachRoom } from './src/server/socket.ts';
import { attachHubRooms } from './src/server/hub-rooms.ts';
import { validateClientConfig, securityMeta } from './scripts/security-policy.mjs';

export default defineConfig(({mode, command}) => {
  const env = loadEnv(mode,process.cwd(),'VITE_');
  const backend = validateClientConfig(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY);
  const runtime = env.VITE_RELAY_RUNTIME_ORIGIN ? new URL(env.VITE_RELAY_RUNTIME_ORIGIN) : null;
  if (runtime && (runtime.protocol !== 'wss:' || runtime.href !== runtime.origin + '/')) {
    throw Error('Set VITE_RELAY_RUNTIME_ORIGIN to a trusted WSS origin without a path or credentials.');
  }
  function attach(server: import('node:events').EventEmitter) {
    attachRoom(server);
    if (backend) attachHubRooms(server,backend.origin,env.VITE_SUPABASE_PUBLISHABLE_KEY);
  }
  return {
    base:'./', build:{target:'es2022'},
    server:{host:'127.0.0.1',port:5176,strictPort:true},
    preview:{host:'127.0.0.1',port:4176,strictPort:true},
    plugins:[{
      name:'relay-room-runtime',
      configureServer(s) { if (s.httpServer) attach(s.httpServer); },
      configurePreviewServer(s) { attach(s.httpServer); },
      transformIndexHtml:{order:'post',handler:html => securityMeta(html,backend,command === 'serve' ? 5176 : null,runtime?.origin)},
    }],
  };
});
