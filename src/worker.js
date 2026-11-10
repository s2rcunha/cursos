/**
 * Portal APH: hospedagem e API no mesmo dominio Cloudflare.
 * O Worker nao armazena o catalogo, a senha ou as sessoes.
 * O Apps Script continua validando a senha e salvando no JSON privado do Drive.
 *
 * GET /api/health  -> testa a conexao com o catalogo publico.
 * GET /api/aph     -> consulta public/status/chunk em JSON.
 * POST /api/aph    -> envia uma operacao administrativa autorizada ao Apps Script.
 */
const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbymdOy53r_yr72xCUpmF1WTVKEENAk8txd0sxCKLCsv5Kr37Cye5xJyHaShRiRqItPF/exec';
const ID_RE = /^[a-f0-9]{48}$/;
const RPC_METHODS = new Set(['apiLogin', 'apiLogout', 'apiGetAdminCatalog', 'apiSaveCatalog', 'apiChangePassword']);
const ACTIONS = new Set(['public', 'status', 'chunk']);
const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  'Pragma': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}
function safeError(error) {
  return String(error?.message || error || 'Erro desconhecido').slice(0, 260);
}
function upstreamUrl(env, params) {
  const url = new URL(env?.GAS_URL || DEFAULT_GAS_URL);
  if (url.origin !== 'https://script.google.com' || !/^\/macros\/s\/[a-zA-Z0-9_-]+\/exec\/?$/.test(url.pathname)) {
    throw Error('URL do Apps Script incorreta no Worker.');
  }
  url.search = params.toString();
  return url.href;
}
function makeCallback() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return '__aphcb_' + Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
}
function decodeJsonp(source, callback) {
  const text = String(source).trim();
  const prefix = callback + '(';
  if (!text.startsWith(prefix) || !text.endsWith(');')) {
    throw Error('O Google retornou uma pagina em vez da resposta da API. Confira a implantacao publica do Apps Script.');
  }
  try { return JSON.parse(text.slice(prefix.length, -2)); }
  catch { throw Error('A resposta JSON do Apps Script veio invalida.'); }
}
async function getFromScript(env, action, args = {}) {
  const callback = makeCallback();
  const params = new URLSearchParams({action, callback, _: String(Date.now())});
  for (const [key, value] of Object.entries(args)) params.set(key, String(value));
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(upstreamUrl(env, params), {
        method: 'GET', redirect: 'follow',
        headers: {'Accept': 'application/javascript, text/javascript, */*'},
        cache: 'no-store'
      });
      if (!response.ok) throw Error('Apps Script indisponivel (HTTP ' + response.status + ').');
      const text = await response.text();
      if (text.length > 3000000) throw Error('Resposta do Apps Script excedeu o limite.');
      return decodeJsonp(text, callback);
    } catch (error) { last = error; }
  }
  throw last || Error('Falha ao consultar o Apps Script.');
}
function sameOriginPost(request) {
  const origin = request.headers.get('Origin');
  const siteOrigin = new URL(request.url).origin;
  if (origin) return origin === siteOrigin;
  const referer = request.headers.get('Referer');
  if (referer) {
    try { return new URL(referer).origin === siteOrigin; } catch { return false; }
  }
  // Rejeita POST externo sem referencia; isso nao substitui a senha no Apps Script.
  return request.headers.get('Sec-Fetch-Site') === 'same-origin';
}
async function handleApi(request, env, url) {
  if (request.method === 'GET') {
    if (url.pathname === '/api/health') {
      try {
        const response = await getFromScript(env, 'public');
        if (!response?.ok) throw Error(response?.error || 'Catalogo nao disponivel.');
        return json({status:'ok', api:'conectada', appsScript:'conectado', cursosLiberados:response?.result?.courses?.length ?? null});
      } catch (error) {
        return json({status:'erro', api:'online', appsScript:'indisponivel', erro:safeError(error)},502);
      }
    }
    if (url.pathname !== '/api/aph') return json({error:'Endpoint nao encontrado.'}, 404);
    const action = url.searchParams.get('action') || '';
    if (!ACTIONS.has(action)) return json({error:'Acao nao permitida.'}, 400);
    const args = {};
    if (action !== 'public') {
      const id = url.searchParams.get('id') || '';
      if (!ID_RE.test(id)) return json({error:'ID de operacao invalido.'}, 400);
      args.id = id;
    }
    if (action === 'chunk') {
      const part = Number(url.searchParams.get('part'));
      if (!Number.isInteger(part) || part < 0 || part > 199 || url.searchParams.get('part') === null)
        return json({error:'Indice de fragmento invalido.'}, 400);
      args.part = part;
    }
    try { return json(await getFromScript(env, action, args)); }
    catch (error) { return json({error:'Falha ao consultar o Google: ' + safeError(error)}, 502); }
  }
  if (request.method === 'POST' && url.pathname === '/api/aph') {
    if (!sameOriginPost(request)) return json({error:'Origem do envio nao autorizada.'},403);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || ''))
      return json({error:'Envie dados JSON.'},415);
    if (Number(request.headers.get('Content-Length') || 0) > 3000000) return json({error:'Dados excessivos.'},413);
    let payload;
    try {
      const body=await request.text();
      if (body.length > 3000000) return json({error:'Dados excessivos.'},413);
      payload=JSON.parse(body);
    } catch { return json({error:'JSON invalido.'},400); }
    if (!payload || !ID_RE.test(payload.id || '') || !RPC_METHODS.has(payload.method) ||
        !Array.isArray(payload.args) || payload.args.length > 3) return json({error:'Operacao invalida.'},400);
    try {
      const upstream=await fetch(upstreamUrl(env, new URLSearchParams()), {
        method:'POST',redirect:'manual',
        headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8', 'Accept':'text/plain'},
        body:new URLSearchParams({payload:JSON.stringify(payload)}).toString(),
        cache:'no-store'
      });
      const target=upstream.headers.get('Location') || '';
      if (target.includes('accounts.google.com')) throw Error('O Apps Script pediu login. Confira o acesso publico da implantacao.');
      if (upstream.status < 200 || upstream.status >= 400)
        throw Error('O Google recusou o envio (HTTP '+upstream.status+').');
      // doPost grava o resultado no CacheService; o navegador consulta status/chunk.
      return json({accepted:true});
    } catch (error) { return json({error:'Falha ao enviar ao Apps Script: ' + safeError(error)},502); }
  }
  return json({error:'Metodo nao permitido.'},405);
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env, url);
    // Rotas nao-API sao entregues pelo Cloudflare Static Assets.
    return env.ASSETS.fetch(request);
  }
};
