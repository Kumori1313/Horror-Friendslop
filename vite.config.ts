import { defineConfig, loadEnv } from 'vite';
import { execFileSync } from 'node:child_process';
import { generatorVersion } from './src/layout.ts';
import { readFileSync } from 'node:fs';
import { attachRoom } from './src/server/socket.ts';
import { validateClientConfig, securityMeta } from './scripts/security-policy.mjs';

export default defineConfig(({mode, command}) => {
  const env = loadEnv(mode,process.cwd(),'VITE_');
  const backend = validateClientConfig(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY);
  const revision = mode === 'pages' ? execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim() : 'local';
  if (mode === 'pages' && backend?.protocol !== 'https:') {
    throw Error('Pages builds require the hosted Supabase URL and publishable key.');
  }
  function attach(server: import('node:events').EventEmitter) {
    attachRoom(server);
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
          source:JSON.stringify({revision,generatorVersion,players:2,modes:['solo','co-op'],game:'relay-room'})+'\n',
        });
        this.emitFile({type:'asset',fileName:'LICENSE.txt',source:readFileSync(new URL('./LICENSE',import.meta.url),'utf8')});
        this.emitFile({type:'asset',fileName:'AUDIO-CREDITS.md',source:readFileSync(new URL('./src/audio/CREDITS.md',import.meta.url),'utf8')});
      },
      configureServer(s) { if (s.httpServer) attach(s.httpServer); },
      configurePreviewServer(s) { attach(s.httpServer); },
      transformIndexHtml:{order:'post',handler:html => securityMeta(html,backend,command === 'serve' ? 5176 : null)},
    }],
  };
});
