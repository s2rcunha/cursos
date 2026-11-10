/* Portal APH — migracao sem parada do Apps Script para Cloudflare D1.
 * CATALOG_BACKEND=legacy: continua com o Apps Script (padrao da primeira publicacao).
 * CATALOG_BACKEND=d1: usa o banco D1, sem chamadas ao Google.
 * Os endpoints de importacao/status D1 ficam disponiveis antes da troca.
 */
import legacy from './legacy-worker.js';
import {handleD1Api,handleD1Migration,send} from './d1-api.js';
export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/d1/'))return handleD1Migration(request,env,url);
    if(url.pathname.startsWith('/api/') && env.CATALOG_BACKEND==='d1')return handleD1Api(request,env,url);
    return legacy.fetch(request,env,ctx);
  }
};
