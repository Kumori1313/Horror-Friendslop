import { createServer } from 'node:http';
import { attachHubRooms } from '../src/server/hub-rooms.ts';
import { validateClientConfig } from './security-policy.mjs';

const backend = validateClientConfig(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_PUBLISHABLE_KEY);
if (!backend) throw Error('Configure the shared Supabase project.');
const origin = new URL(process.env.RELAY_CLIENT_ORIGIN);
if (origin.origin !== process.env.RELAY_CLIENT_ORIGIN || origin.protocol !== 'https:') {
  throw Error('RELAY_CLIENT_ORIGIN must be the HTTPS origin hosting the trusted game client.');
}
const server = createServer((_req,res) => { res.writeHead(404); res.end(); });
attachHubRooms(server,backend.origin,process.env.VITE_SUPABASE_PUBLISHABLE_KEY,origin.origin);
server.listen(Number(process.env.PORT ?? 4180),'127.0.0.1',() => {
  console.log('Relay Room runtime listening on loopback port',server.address().port);
});
