import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');

test('manifesto PWA com escopo e icones válidos',()=>{
  const manifest=JSON.parse(read('public/manifest.webmanifest'));
  assert.equal(manifest.start_url,'/');
  assert.equal(manifest.scope,'/');
  assert.equal(manifest.display,'standalone');
  assert.ok(manifest.icons.filter(x=>x.purpose==='maskable').length===2);
  for(const icon of manifest.icons) assert.ok(fs.existsSync(path.join(root,'public',icon.src)));
  const html=read('public/index.html');
  assert.match(html,/rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html,/src="\/pwa\.js" defer/);
  assert.equal((html.match(/<button[^>]*data-pwa-install/g)||[]).length,3);
});

test('worker PWA atende só interface, ignora /api/, e abre a tela offline',async()=>{
  const listeners={};
  const storage=new Map();
  let offline=false;
  const cacheImpl={
    async match(key){return storage.get(typeof key==='string'?key:key.url);},
    async put(key,value){storage.set(typeof key==='string'?key:key.url,value);},
    async keys(){return [...storage.keys()].map(k=>({url:k}));}
  };
  const caches={async open(){return cacheImpl;},async keys(){return ['aph-cloudflare-shell-v1-20261110'];},async delete(){return true;}};
  const fetch=async request=>{
    if(offline) throw Error('offline');
    return {ok:true,type:'basic',url:request.url??request,clone(){return this;}};
  };
  class MockRequest{constructor(url){this.url=url;}}
  const self={location:{origin:'https://cursos-aph.s2rcunha.workers.dev'},clients:{async claim(){}},addEventListener(k,fn){listeners[k]=fn;},skipWaiting(){}};
  vm.runInNewContext(read('public/sw.js'),{self,caches,fetch,Request:MockRequest,Response,URL,Set,Promise,console});
  let installPromise;
  listeners.install({waitUntil(p){installPromise=p;}});
  await installPromise;
  assert.ok(storage.has('/index.html'));
  assert.ok(storage.has('/config.js'));
  let captured;
  const apiRequest={method:'GET',url:'https://cursos-aph.s2rcunha.workers.dev/api/aph?action=public',mode:'cors'};
  listeners.fetch({request:apiRequest,respondWith(r){captured=r;}});
  assert.equal(captured,undefined,'API deve ficar totalmente fora do Service Worker');
  offline=true;
  let offlineResponse;
  listeners.fetch({request:{method:'GET',url:'https://cursos-aph.s2rcunha.workers.dev/',mode:'navigate'},respondWith(p){offlineResponse=p;}});
  const resolved=await offlineResponse;
  assert.ok(resolved && resolved.url==='/index.html');
  assert.equal([...storage.keys()].filter(k=>k.startsWith('/api/')).length,0);
});
