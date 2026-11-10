import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCatalog,counts,handleD1Migration,handleD1Api} from '../src/d1-api.js';
const seed={revision:1,updatedAt:'2026-11-10T00:00:00Z',courses:[{id:'curso-aph',title:'Curso de exemplo',description:'',coverUrl:'',published:true,modules:Array.from({length:5},(_,m)=>({id:'modulo-'+m,title:'Modulo '+m,description:'',pdfUrl:'',published:true,videos:Array.from({length:m===0?20:19},(_,i)=>({youtubeId:'X'+String(m).padStart(2,'0')+String(i).padStart(8,'0'),title:'Aula '+(i+1),durationSeconds:0}))}))}]};
const url='https://cursos-aph.s2rcunha.workers.dev/api/d1/import';
const key='TesteChaveMigracaoMuitoLonga_ABCdef1234567890';
class MockDB {
  constructor(){this.revision=0;this.auth=false;this.calls=[];this.counts={courses:0,modules:0,videos:0};}
  prepare(sql){return {bind:(...args)=>({first:async()=>this.first(sql,args),all:async()=>({results:[]}),run:async()=>({success:true}),sql,args}),first:async()=>this.first(sql,[])};}
  async first(sql,args){
    if(sql.includes('FROM catalog_meta'))return {revision:this.revision,updated_at:''};
    if(sql.includes('FROM admin_auth'))return this.auth?{id:1}:null;
    if(sql.includes('COUNT(*)'))return {n:sql.includes('FROM courses')?this.counts.courses:sql.includes('FROM modules')?this.counts.modules:this.counts.videos};
    return null;
  }
  async batch(stmts){this.calls.push(stmts);this.revision=seed.revision||1;this.auth=true;this.counts={...counts(seed)};return stmts.map(()=>({success:true}));}
}
const makeRequest=payload=>new Request(url,{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://cursos-aph.s2rcunha.workers.dev'},body:JSON.stringify(payload)});
test('Estrutura equivalente: valida 96 vídeos e 5 módulos',()=>{
  const normalized=validateCatalog(seed);
  assert.deepEqual(counts(normalized),{courses:1,modules:5,videos:96,publishedCourses:1});
  assert.equal(normalized.courses[0].modules.length,5);
});
test('bloqueia IDs e dados inválidos',()=>{
  const bad=structuredClone(seed);bad.courses[0].id='!';assert.throws(()=>validateCatalog(bad));
  const bad2=structuredClone(seed);bad2.courses[0].modules[0].videos[0].durationSeconds=-1;assert.throws(()=>validateCatalog(bad2));
});
test('nao aceita importação sem secret ou chave incorreta',async()=>{
  const db=new MockDB();
  let r=await handleD1Migration(makeRequest({migrationKey:'x',adminPassword:'senha_com_12+',catalog:seed}),{DB:db},new URL(url));
  assert.equal(r.status,503);
  r=await handleD1Migration(makeRequest({migrationKey:'chave_errada_12345678901234567890',adminPassword:'senha_com_12+',catalog:seed}),{DB:db,MIGRATION_KEY:key,CATALOG_BACKEND:'legacy'},new URL(url));
  assert.equal(r.status,403);assert.equal(db.calls.length,0);
});
test('importa todos os registros uma vez, preservando disponibilidade do legado',async()=>{
  const db=new MockDB();
  const env={DB:db,MIGRATION_KEY:key,CATALOG_BACKEND:'legacy'};
  const payload={migrationKey:key,adminPassword:'MinhaSenhaAdminMuitoBoa123',catalog:seed};
  const r=await handleD1Migration(makeRequest(payload),env,new URL(url));
  assert.equal(r.status,200,await r.text().catch(()=>''));
  assert.equal(db.calls.length,1);
  const sql=db.calls[0];
  assert.equal(sql.filter(x=>/INSERT INTO courses/.test(x.sql)).length,1);
  assert.equal(sql.filter(x=>/INSERT INTO modules/.test(x.sql)).length,5);
  assert.equal(sql.filter(x=>/INSERT INTO videos/.test(x.sql)).length,96);
  const again=await handleD1Migration(makeRequest(payload),env,new URL(url));
  assert.equal(again.status,409);assert.equal(db.calls.length,1);
});
test('D1 nao exposto ate selecao do backend',async()=>{
  const db=new MockDB();const response=await handleD1Api(new Request('https://cursos-aph.s2rcunha.workers.dev/api/aph?action=wrong'),{DB:db},new URL('https://cursos-aph.s2rcunha.workers.dev/api/aph?action=wrong'));
  assert.equal(response.status,400);
});
