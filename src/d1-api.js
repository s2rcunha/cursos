/* Portal APH — API de catalogo e autenticacao no Cloudflare D1.
 * Mantem o contrato da interface existente (/api/aph e /api/health).
 * Nao faz chamadas ao Google. Tokens de sessao e hashes nunca sao devolvidos ao publico.
 */
const MAX_BYTES = 2_500_000;
// Cloudflare Workers (producao) limita PBKDF2 a 100.000 iteracoes por chamada.
// O custo efetivamente utilizado fica registrado em admin_auth.iterations.
// Nao altere o valor gravado em registros existentes sem recalcular seus hashes.
const ITERATIONS = 100_000;
const SESSION_SECONDS = 8 * 3600;
const AUTH_METHODS = new Set(['apiLogin','apiLogout','apiGetAdminCatalog','apiSaveCatalog','apiChangePassword']);
const JSON_HEADERS = {
  'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store, max-age=0',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'
};
const utf8 = new TextEncoder();
export const send = (value,status=200) => new Response(JSON.stringify(value),{status,headers:JSON_HEADERS});
const now = () => Math.floor(Date.now()/1000);
const iso = () => new Date().toISOString();
const randHex = (n=24) => Array.from(crypto.getRandomValues(new Uint8Array(n)),x=>x.toString(16).padStart(2,'0')).join('');
const hex = bytes => Array.from(new Uint8Array(bytes), x=>x.toString(16).padStart(2,'0')).join('');
async function sha256(s){return hex(await crypto.subtle.digest('SHA-256',utf8.encode(s)));}
async function passHash(pass,salt,iterations=ITERATIONS){
  const key=await crypto.subtle.importKey('raw',utf8.encode(pass),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:Uint8Array.from(salt.match(/.{2}/g),x=>parseInt(x,16)),iterations,hash:'SHA-256'},key,256));
}
const safeError = e => String(e?.message||e||'Erro desconhecido').slice(0,230);
const field=(str,max,label,required=false)=>{
  if(typeof str!=='string')throw Error(label+' invalido.');
  const val=str.trim(); if(val.length>max||(required&&!val))throw Error(label+' invalido ou muito longo.');
  return val;
};
const secureUrl=(value,label)=>{
  if(!value)return '';
  const url=field(value,1000,label);
  if(!/^https:\/\/[a-z0-9][\w.-]*\//i.test(url))throw Error(label+' deve ser um endereco HTTPS.');
  return url;
};
const safeId=v=>{
  if(typeof v!=='string'||!/^[a-zA-Z0-9_-]{3,80}$/.test(v))throw Error('Identificador invalido.');
  return v;
};
function youtubeId(value){
  const s=String(value||'').trim();
  if(/^[\w-]{11}$/.test(s))return s;
  const match=s.match(/^https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com|youtube-nocookie\.com)\/(?:watch\?[^#]*\bv=|embed\/|shorts\/|live\/)([\w-]{11})(?:[&#?/]|$)/i)||s.match(/^https?:\/\/(?:www\.)?youtu\.be\/([\w-]{11})(?:[?#/]|$)/i);
  if(!match)throw Error('URL de video do YouTube invalida.');
  return match[1];
}
export function validateCatalog(data){
  if(!data||!Array.isArray(data.courses)||data.courses.length>100)throw Error('Catalogo invalido ou limite de cursos excedido.');
  const ids=new Set();let moduleCount=0,videoCount=0;
  const result={revision:Number.isInteger(data.revision)?Math.max(0,data.revision):0,
    updatedAt:typeof data.updatedAt==='string'?data.updatedAt:'',courses:[]};
  for(const source of data.courses){
    if(!source||typeof source!=='object')throw Error('Curso invalido.');
    const id=safeId(source.id);if(ids.has(id))throw Error('ID de curso duplicado.');ids.add(id);
    const course={id,title:field(source.title,140,'Titulo do curso',true),
      description:field(source.description||'',1000,'Descricao do curso'),
      coverUrl:secureUrl(source.coverUrl||'','Imagem do curso'),
      published:source.published===true,modules:[]};
    if(!Array.isArray(source.modules))throw Error('Modulos do curso invalidos.');
    for(const s of source.modules){
      if(++moduleCount>1000)throw Error('Limite de modulos excedido.');
      const mid=safeId(s.id);if(ids.has(mid))throw Error('ID de modulo duplicado.');ids.add(mid);
      const mod={id:mid,title:field(s.title,160,'Titulo do modulo',true),
        description:field(s.description||'',1000,'Descricao do modulo'),
        pdfUrl:secureUrl(s.pdfUrl||'','PDF do modulo'),published:s.published!==false,videos:[]};
      if(!Array.isArray(s.videos))throw Error('Videos invalidos.');
      const vids=new Set();
      for(const v of s.videos){
        if(++videoCount>10000)throw Error('Limite de videos excedido.');
        const yt=youtubeId(v.youtubeId||v.url||v.id);
        if(vids.has(yt))throw Error('Video duplicado em '+mod.title+'.');vids.add(yt);
        const seconds=Number(v.durationSeconds||0);
        if(!Number.isInteger(seconds)||seconds<0||seconds>172800)throw Error('Duracao do video invalida.');
        mod.videos.push({youtubeId:yt,title:field(v.title,250,'Titulo do video',true),
          url:'https://www.youtube.com/watch?v='+yt,durationSeconds:seconds});
      }
      course.modules.push(mod);
    }
    result.courses.push(course);
  }
  return result;
}
export function counts(data){
  const courses=data.courses.length, modules=data.courses.reduce((t,c)=>t+c.modules.length,0);
  return {courses,modules,videos:data.courses.reduce((t,c)=>t+c.modules.reduce((s,m)=>s+m.videos.length,0),0),publishedCourses:data.courses.filter(c=>c.published).length};
}
export async function readCatalog(db, onlyPublic=false){
  const [meta,cs,ms,vs]=await Promise.all([
    db.prepare('SELECT revision,updated_at FROM catalog_meta WHERE id=1').first(),
    db.prepare(onlyPublic?'SELECT * FROM courses WHERE published=1 ORDER BY position':'SELECT * FROM courses ORDER BY position').all(),
    db.prepare(onlyPublic?'SELECT m.* FROM modules m JOIN courses c ON c.id=m.course_id WHERE c.published=1 AND m.published=1 ORDER BY c.position,m.position':'SELECT * FROM modules ORDER BY course_id,position').all(),
    db.prepare(onlyPublic?'SELECT v.* FROM videos v JOIN modules m ON m.id=v.module_id JOIN courses c ON c.id=m.course_id WHERE c.published=1 AND m.published=1 ORDER BY c.position,m.position,v.position':'SELECT * FROM videos ORDER BY module_id,position').all()
  ]);
  if(!meta)throw Error('Estrutura do D1 nao instalada. Execute a migracao SQL.');
  const courses=(cs.results||[]).map(c=>({id:c.id,title:c.title,description:c.description,coverUrl:c.cover_url||'',published:!!c.published,modules:[]}));
  const courseMap=new Map(courses.map(c=>[c.id,c]));
  const moduleMap=new Map();
  for(const m of ms.results||[]){
    const c=courseMap.get(m.course_id);if(!c)continue;
    const item={id:m.id,title:m.title,description:m.description,pdfUrl:m.pdf_url||'',published:!!m.published,videos:[]};
    c.modules.push(item);moduleMap.set(m.id,item);
  }
  for(const v of vs.results||[]){
    const m=moduleMap.get(v.module_id);
    if(m)m.videos.push({youtubeId:v.youtube_id,title:v.title,url:v.url,durationSeconds:v.duration_seconds});
  }
  return {revision:meta.revision,updatedAt:meta.updated_at,courses};
}
const q=(db,sql,...args)=>db.prepare(sql).bind(...args);
function editStatements(db,source,prior){
  const stmts=[];
  const oldCourses=new Map(prior.courses.map(x=>[x.id,x]));
  const newCourses=new Map(source.courses.map(x=>[x.id,x]));
  for(const [cid,old] of oldCourses){if(!newCourses.has(cid))stmts.push(q(db,'DELETE FROM courses WHERE id=?',cid));}
  for(const [ci,c] of source.courses.entries()){
    const prev=oldCourses.get(c.id);
    if(!prev||prev.title!==c.title||prev.description!==c.description||prev.coverUrl!==c.coverUrl||prev.published!==c.published||prior.courses.indexOf(prev)!==ci){
      stmts.push(q(db,`INSERT INTO courses(id,title,description,cover_url,published,position) VALUES(?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,cover_url=excluded.cover_url,published=excluded.published,position=excluded.position`,c.id,c.title,c.description,c.coverUrl,c.published?1:0,ci));
    }
    const oldMods=new Map((prev?.modules||[]).map(m=>[m.id,m]));
    const newMods=new Map(c.modules.map(m=>[m.id,m]));
    for(const [mid] of oldMods)if(!newMods.has(mid))stmts.push(q(db,'DELETE FROM modules WHERE id=?',mid));
    for(const [mi,m] of c.modules.entries()){
      const prevMod=oldMods.get(m.id);
      if(!prevMod||prevMod.title!==m.title||prevMod.description!==m.description||prevMod.pdfUrl!==m.pdfUrl||prevMod.published!==m.published||prev.modules.indexOf(prevMod)!==mi){
        stmts.push(q(db,`INSERT INTO modules(id,course_id,title,description,pdf_url,published,position) VALUES(?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET course_id=excluded.course_id,title=excluded.title,description=excluded.description,pdf_url=excluded.pdf_url,published=excluded.published,position=excluded.position`,m.id,c.id,m.title,m.description,m.pdfUrl,m.published?1:0,mi));
      }
      const oldVids=new Map((prevMod?.videos||[]).map(v=>[v.youtubeId,v]));
      const newVids=new Map(m.videos.map(v=>[v.youtubeId,v]));
      for(const [id] of oldVids)if(!newVids.has(id))stmts.push(q(db,'DELETE FROM videos WHERE module_id=? AND youtube_id=?',m.id,id));
      for(const [vi,v] of m.videos.entries()){
        const pv=oldVids.get(v.youtubeId);
        if(!pv||pv.title!==v.title||pv.durationSeconds!==v.durationSeconds||prevMod.videos.indexOf(pv)!==vi){
          stmts.push(q(db,`INSERT INTO videos(module_id,youtube_id,title,url,duration_seconds,position) VALUES(?,?,?,?,?,?)
            ON CONFLICT(module_id,youtube_id) DO UPDATE SET title=excluded.title,url=excluded.url,duration_seconds=excluded.duration_seconds,position=excluded.position`,m.id,v.youtubeId,v.title,v.url,v.durationSeconds,vi));
        }
      }
    }
  }
  return stmts;
}
async function saveCatalog(db,source,expectedRevision){
  const data=validateCatalog(source);
  const old=await readCatalog(db,false);
  if(!Number.isInteger(Number(expectedRevision))||Number(expectedRevision)!==old.revision)throw Error('CONFLITO: catalogo desatualizado. Recarregue e repita a alteracao.');
  const nonce=randHex();const when=iso();
  const statements=[
    q(db,'UPDATE catalog_meta SET revision=revision+1,updated_at=?,write_nonce=? WHERE id=1 AND revision=?',when,nonce,old.revision),
    q(db,'INSERT INTO revision_guard(id,nonce) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET nonce=excluded.nonce',nonce),
    ...editStatements(db,data,old)
  ];
  try{await db.batch(statements);}catch(e){
    if(/CATALOG_CONFLICT|constraint/i.test(safeError(e)))throw Error('CONFLITO: outro administrador alterou os dados. Recarregue antes de salvar.');
    throw e;
  }
  return {revision:old.revision+1,updatedAt:when};
}
function sameOrigin(request){
  const origin=request.headers.get('Origin'); const current=new URL(request.url).origin;
  if(origin)return origin===current;
  const ref=request.headers.get('Referer');if(ref){try{return new URL(ref).origin===current;}catch{return false;}}
  return request.headers.get('Sec-Fetch-Site')==='same-origin';
}
async function readBody(request){
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))throw Error('Envie dados JSON.');
  if(Number(request.headers.get('Content-Length')||0)>MAX_BYTES)throw Error('JSON excede 2,5 MB.');
  const raw=await request.text();if(utf8.encode(raw).length>MAX_BYTES)throw Error('JSON excede 2,5 MB.');
  try{return JSON.parse(raw);}catch{throw Error('JSON invalido.');}
}
async function requireAdmin(db,token){
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw Error('Sessao expirada. Entre novamente.');
  const hash=await sha256(token);
  const row=await q(db,'SELECT expires_at FROM admin_sessions WHERE token_hash=?',hash).first();
  if(!row||row.expires_at<=now())throw Error('Sessao expirada. Entre novamente.');
  return hash;
}
async function doLogin(db,password,request){
  if(typeof password!=='string'||password.length>256)throw Error('Senha invalida.');
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';const client=await sha256('aph-login:'+ip);
  const epoch=now();const attempts=await q(db,'SELECT attempts,resets_at FROM login_attempts WHERE client_key=?',client).first();
  if(attempts&&attempts.attempts>=12&&attempts.resets_at>epoch)throw Error('Muitas tentativas. Aguarde 10 minutos.');
  const row=await q(db,'SELECT salt,pass_hash,iterations FROM admin_auth WHERE id=1').first();
  if(!row)throw Error('Administrador ainda nao configurado no D1.');
  const digest=await passHash(password,row.salt,row.iterations);
  if(digest!==row.pass_hash){
    await q(db,`INSERT INTO login_attempts(client_key,attempts,resets_at) VALUES(?,1,?)
      ON CONFLICT(client_key) DO UPDATE SET attempts=CASE WHEN resets_at<? THEN 1 ELSE attempts+1 END,resets_at=CASE WHEN resets_at<? THEN excluded.resets_at ELSE resets_at END`,client,epoch+600,epoch,epoch).run();
    throw Error('Senha incorreta.');
  }
  await q(db,'DELETE FROM login_attempts WHERE client_key=?',client).run();
  const token=randHex(32);
  await q(db,'INSERT INTO admin_sessions(token_hash,created_at,expires_at) VALUES(?,?,?)',await sha256(token),epoch,epoch+SESSION_SECONDS).run();
  return {token,expiresInSeconds:SESSION_SECONDS};
}
async function doChangePassword(db,token,oldPassword,newPassword){
  await requireAdmin(db,token);
  if(typeof newPassword!=='string'||newPassword.length<12||newPassword.length>128)throw Error('Nova senha deve conter 12 a 128 caracteres.');
  const row=await q(db,'SELECT salt,pass_hash,iterations FROM admin_auth WHERE id=1').first();
  if(typeof oldPassword!=='string'||await passHash(oldPassword,row.salt,row.iterations)!==row.pass_hash)throw Error('Senha atual incorreta.');
  const salt=randHex(16);const hash=await passHash(newPassword,salt,ITERATIONS);
  await db.batch([q(db,'UPDATE admin_auth SET salt=?,pass_hash=?,iterations=?,updated_at=? WHERE id=1',salt,hash,ITERATIONS,iso()),q(db,'DELETE FROM admin_sessions')]);
  return true;
}
async function d1Rpc(request,db){
  const input=await readBody(request);
  if(!input||!AUTH_METHODS.has(input.method)||!Array.isArray(input.args)||input.args.length>3)throw Error('Operacao invalida.');
  const a=input.args;let result;
  switch(input.method){
    case 'apiLogin':result=await doLogin(db,a[0],request);break;
    case 'apiLogout':{
      if(typeof a[0]==='string'&&/^[a-f0-9]{64}$/.test(a[0]))await q(db,'DELETE FROM admin_sessions WHERE token_hash=?',await sha256(a[0])).run();
      result=true;break;
    }
    case 'apiGetAdminCatalog':await requireAdmin(db,a[0]);result=await readCatalog(db,false);break;
    case 'apiSaveCatalog':await requireAdmin(db,a[0]);result=await saveCatalog(db,a[1],a[2]);break;
    case 'apiChangePassword':result=await doChangePassword(db,a[0],a[1],a[2]);break;
  }
  return send({ok:true,direct:true,result});
}
export async function handleD1Api(request,env,url){
  if(!env.DB)return send({error:'Binding DB nao foi configurado.'},503);
  if(request.method==='GET'&&url.pathname==='/api/health'){
    try{const [c,m,v]=await Promise.all([
      env.DB.prepare('SELECT COUNT(*) n FROM courses').first(),env.DB.prepare('SELECT COUNT(*) n FROM modules').first(),env.DB.prepare('SELECT COUNT(*) n FROM videos').first()]);
      return send({status:'ok',api:'d1',database:'conectado',courses:c?.n||0,modules:m?.n||0,videos:v?.n||0});
    }catch(e){return send({status:'erro',api:'d1',error:safeError(e)},503);}
  }
  if(url.pathname!=='/api/aph')return send({error:'Endpoint nao encontrado.'},404);
  if(request.method==='GET'){
    if(url.searchParams.get('action')!=='public')return send({error:'Acao nao permitida no modo D1.'},400);
    try{return send({ok:true,result:await readCatalog(env.DB,true)});}catch(e){return send({error:safeError(e)},503);}
  }
  if(request.method!=='POST')return send({error:'Metodo nao permitido.'},405);
  if(!sameOrigin(request))return send({error:'Origem nao autorizada.'},403);
  try{return await d1Rpc(request,env.DB);}catch(e){
    const msg=safeError(e);const status=/Sessao|Senha incorreta/.test(msg)?401:/CONFLITO/.test(msg)?409:400;
    return send({error:msg},status);
  }
}
export async function handleD1Migration(request,env,url){
  if(!env.DB)return send({error:'D1 ainda nao vinculado ao Worker.'},503);
  if(url.pathname==='/api/d1/status'&&request.method==='GET'){
    try{const [meta,cc,mm,vv,auth]=await Promise.all([
      env.DB.prepare('SELECT revision,updated_at FROM catalog_meta WHERE id=1').first(),
      env.DB.prepare('SELECT COUNT(*) n FROM courses').first(),env.DB.prepare('SELECT COUNT(*) n FROM modules').first(),env.DB.prepare('SELECT COUNT(*) n FROM videos').first(),
      env.DB.prepare('SELECT id FROM admin_auth WHERE id=1').first()
    ]);
      return send({status:'ok',backend:env.CATALOG_BACKEND||'legacy',database:'conectado',imported:!!auth,
        revision:meta?.revision??null,courses:cc?.n??0,modules:mm?.n??0,videos:vv?.n??0});
    }catch(e){return send({status:'erro',error:safeError(e)},503);}
  }
  if(url.pathname!=='/api/d1/import'||request.method!=='POST')return send({error:'Endpoint nao encontrado.'},404);
  if(!sameOrigin(request))return send({error:'Origem nao autorizada.'},403);
  if(env.CATALOG_BACKEND==='d1')return send({error:'Importacao desativada: banco D1 ja esta em producao.'},409);
  if(typeof env.MIGRATION_KEY!=='string'||env.MIGRATION_KEY.length<32)return send({error:'Configure o Secret MIGRATION_KEY de pelo menos 32 caracteres no Worker.'},503);
  try{
    const input=await readBody(request);
    if(typeof input.migrationKey!=='string'||(await sha256(input.migrationKey))!==(await sha256(env.MIGRATION_KEY)))return send({error:'Chave de migracao incorreta.'},403);
    if(typeof input.adminPassword!=='string'||input.adminPassword.length<12||input.adminPassword.length>128)throw Error('Escolha uma senha do administrador com 12 a 128 caracteres.');
    const data=validateCatalog(input.catalog);
    if(!data.courses.length)throw Error('Importacao vazia bloqueada. Exporte o JSON completo na area administrativa primeiro.');
    const meta=await env.DB.prepare('SELECT revision FROM catalog_meta WHERE id=1').first();
    const admin=await env.DB.prepare('SELECT id FROM admin_auth WHERE id=1').first();
    if(!meta)throw Error('Aplique migrations/0001_portal_aph.sql antes de importar.');
    if(meta.revision!==0||admin)throw Error('D1 ja importado. A importacao inicial so pode ser feita uma vez.');
    const nonce=randHex();const stamp=data.updatedAt||iso();const salt=randHex(16),hashed=await passHash(input.adminPassword,salt,ITERATIONS);
    const statements=[
      q(env.DB,'UPDATE catalog_meta SET revision=?,updated_at=?,write_nonce=? WHERE id=1 AND revision=0',Math.max(1,data.revision),stamp,nonce),
      q(env.DB,'INSERT INTO revision_guard(id,nonce) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET nonce=excluded.nonce',nonce),
      ...editStatements(env.DB,data,{courses:[]}),
      q(env.DB,'INSERT INTO admin_auth(id,salt,pass_hash,iterations,updated_at) VALUES(1,?,?,?,?)',salt,hashed,ITERATIONS,iso())
    ];
    await env.DB.batch(statements);
    return send({ok:true,imported:true,revision:Math.max(1,data.revision),counts:counts(data)});
  }catch(e){const message=safeError(e);return send({error:message},/importado|CONFLICT|UNIQUE|CATALOG_CONFLICT/i.test(message)?409:400);}
}
