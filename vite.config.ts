import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react(), {
    name:'offline-paper',
    generateBundle(_options,bundle){
      const paths=['/','/favicon.svg',...Object.keys(bundle).map(name=>`/${name}`)];
      const revision=Object.keys(bundle).find(name=>/^assets\/index-.*\.js$/.test(name))??'first';
      this.emitFile({type:'asset',fileName:'sw.js',source:`
const CACHE=${JSON.stringify('te-paper-'+revision)};
const FILES=${JSON.stringify(paths)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('te-paper-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
// Precached same-origin static assets are identical for every Origin header.
// Module/worker requests and cache.addAll requests can have different Origin headers.
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;event.respondWith((async()=>{const cache=await caches.open(CACHE);const cached=await cache.match(event.request,{ignoreSearch:true,ignoreVary:true});if(cached)return cached;try{return await fetch(event.request);}catch{if(event.request.mode==='navigate')return await cache.match('/');return Response.error();}})());});
`});
    }
  }],
  server: { host: '127.0.0.1' }, worker: { format: 'es' }
});
