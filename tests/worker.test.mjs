import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
const ROOT='https://cursos-aph.example.workers.dev';
const id='a'.repeat(48);
const BASE={ASSETS:{fetch:async()=>new Response('PAGINA ESTATICA',{status:200})}};
let calls=[];
let apiReply={ok:true,result:{revision:4,courses:[{id:'curso1'}]}};
let responseStatus=200;
let responseBody='';
globalThis.fetch=async (url,options={})=>{
 calls.push({url:String(url),options});
 if(options.method==='POST')return new Response(null,{status:302,headers:{Location:'https://script.googleusercontent.com/macros/echo'}});
 const cb=new URL(url).searchParams.get('callback');
 return new Response(responseBody || cb+'('+JSON.stringify(apiReply)+');',{status:responseStatus});
};
const rq=(path,opts={})=>worker.fetch(new Request(ROOT+path,opts),BASE);
test('arquivos estaticos sao servidos pelo binding, sem chamar Apps Script',async()=>{
 calls=[];const r=await rq('/');assert.equal(r.status,200);assert.equal(await r.text(),'PAGINA ESTATICA');assert.equal(calls.length,0);
});
test('GET publica usa Apps Script sem cookies e devolve JSON',async()=>{
 calls=[];apiReply={ok:true,result:{courses:[{id:'publico'}]}};
 const r=await rq('/api/aph?action=public');assert.equal(r.status,200);assert.deepEqual(await r.json(),apiReply);
 assert.equal(new URL(calls.at(-1).url).searchParams.get('action'),'public');
 assert.equal(calls.at(-1).options.redirect,'follow');
 assert.equal(calls.at(-1).options.headers?.Cookie,undefined);
});
test('diagnostico consulta catalogo',async()=>{
 const r=await rq('/api/health');assert.equal(r.status,200);assert.equal((await r.json()).cursosLiberados,1);
});
test('validacao de IDs e rota GET',async()=>{
 assert.equal((await rq('/api/aph?action=apagar')).status,400);
 assert.equal((await rq('/api/aph?action=chunk&id=xx&part=0')).status,400);
 assert.equal((await rq('/api/aph?action=chunk&id='+id+'&part=999')).status,400);
 apiReply={state:'ready',chunks:1}; const resp=await rq('/api/aph?action=status&id='+id);
 assert.equal((await resp.json()).state,'ready');
});
test('POST administrativo valido encaminha apenas para Google',async()=>{
 calls=[];
 const payload={id,method:'apiLogin',args:['senhateste']};
 const r=await rq('/api/aph',{method:'POST',headers:{'Origin':ROOT,'Content-Type':'application/json'},body:JSON.stringify(payload)});
 assert.equal(r.status,200);assert.equal((await r.json()).accepted,true);
 assert.equal(calls.at(-1).options.method,'POST');
 assert.equal(calls.at(-1).options.redirect,'manual');
 assert.equal(new URLSearchParams(calls.at(-1).options.body).get('payload'),JSON.stringify(payload));
});
test('POST bloqueia outra origem, metodo desconhecido e payload malformado',async()=>{
 const body=JSON.stringify({id,method:'apiLogin',args:['senha']});
 assert.equal((await rq('/api/aph',{method:'POST',headers:{Origin:'https://fake.example','Content-Type':'application/json'},body})).status,403);
 assert.equal((await rq('/api/aph',{method:'POST',headers:{Origin:ROOT,'Content-Type':'application/json'},body:JSON.stringify({id,method:'deleteAll',args:[]})})).status,400);
 assert.equal((await rq('/api/aph',{method:'POST',headers:{Origin:ROOT,'Content-Type':'application/json'},body:'invalid'})).status,400);
});
test('resposta invalida do Google retorna erro 502 em vez de HTML',async()=>{
 responseBody='<html>Sorry, unable to open the file at this time.</html>';
 const r=await rq('/api/aph?action=public');assert.equal(r.status,502);
 assert.match((await r.json()).error,/pagina em vez da resposta/);
 responseBody='';
});
test('nenhuma credencial Google enviada pelo Worker',async()=>{
 calls=[];await rq('/api/aph?action=public');
 assert.equal(calls.at(-1).options.credentials,undefined);
 assert.equal(calls.at(-1).options.headers.Cookie,undefined);
});
