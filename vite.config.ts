import { defineConfig, loadEnv } from 'vite';
import { execFileSync } from 'node:child_process';
import { generatorVersion } from './src/layout.ts';
import { readFileSync } from 'node:fs';
import { attachRoom } from './src/server/socket.ts';
import { attachHubRooms } from './src/server/hub-rooms.ts';
import { validateClientConfig, securityMeta } from './scripts/security-policy.mjs';

export default defineConfig(({mode, command}) => {
  const env = loadEnv(mode,process.cwd(),'VITE_');
  const backend = validateClientConfig(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY);
  const revision = mode === 'pages' ? execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim() : 'local';
  const runtime = env.VITE_RELAY_RUNTIME_ORIGIN ? new URL(env.VITE_RELAY_RUNTIME_ORIGIN) : null;
  if (runtime && (runtime.protocol !== 'wss:' || runtime.href !== runtime.origin + '/')) {
    throw Error('Set VITE_RELAY_RUNTIME_ORIGIN to a trusted WSS origin without a path or credentials.');
  }
  if (mode === 'pages' && backend?.protocol !== 'https:') {
    throw Error('Pages builds require the hosted Supabase URL and publishable key.');
  }
  function attach(server: import('node:events').EventEmitter) {
    attachRoom(server);
    if (backend) attachHubRooms(server,backend.origin,env.VITE_SUPABASE_PUBLISHABLE_KEY);
  }
  return {
    define:{'import.meta.env.VITE_RELAY_BUILD':JSON.stringify(revision.slice(0,12))},
    base:'./', build:{target:'es2022',license:{fileName:'THIRD-PARTY-LICENSES.md'}},
    server:{host:'127.0.0.1',port:5176,strictPort:true},
    preview:{host:'127.0.0.1',port:4176,strictPort:true},
    plugins:[{
      name:'relay-room-runtime',
      generateBundle() {
        if (mode === 'pages') this.emitFile({
          type:'asset',fileName:'release.json',
          source:JSON.stringify({revision,generatorVersion,players:2,game:'relay-room'})+'\n',
        });
        this.emitFile({type:'asset',fileName:'LICENSE.txt',source:readFileSync(new URL('./LICENSE',import.meta.url),'utf8')});
      },
      configureServer(s) { if (s.httpServer) attach(s.httpServer); },
      configurePreviewServer(s) { attach(s.httpServer); },
      transformIndexHtml:{order:'post',handler:html => securityMeta(html,backend,command === 'serve' ? 5176 : null,runtime?.origin)},
    }],
  };
});
