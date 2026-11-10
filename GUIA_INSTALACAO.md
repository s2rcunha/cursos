# Portal APH — migração para Cloudflare Workers + Static Assets

**Projeto de origem:** `s2rcunha/cursos`  
**Site antigo (não alterado automaticamente):** https://s2rcunha.github.io/cursos/  
**Banco de dados:** JSON privado no seu Google Drive  
**Backend:** Apps Script já implantado (não precisa trocar `Code.gs`)

## O que muda

Antes: GitHub Pages → navegador → Google Apps Script.

Depois: **Cloudflare (HTML e API no mesmo domínio)** → Apps Script → JSON privado no Drive.

O Chrome do celular não acessará mais `script.google.com` diretamente para consultar o catálogo. O Cloudflare consulta o Google por conta própria, sem encaminhar cookies das contas Google do aluno. Essa arquitetura reduz a interferência das várias contas conectadas no Chrome. Ainda é necessário verificar a conexão real após a publicação.

## Opção recomendada: publicar sem usar terminal, conectando o repositório `cursos`

### Etapa 1 — manter a versão antiga funcionando

Não exclua nem desative o site GitHub Pages atual. Não execute `INSTALAR_PORTAL` outra vez e não substitua o JSON. A versão nova ficará em `public/index.html` e não sobrescreverá o `index.html` da raiz do repositório.

### Etapa 2 — colocar os arquivos no GitHub

1. Extraia o ZIP deste pacote no computador.
2. Abra https://github.com/s2rcunha/cursos.
3. Envie à **raiz** do repositório, preservando nomes e pastas:
   - `wrangler.jsonc`
   - `package.json`
   - `src/worker.js`
   - `public/index.html`, `public/config.js` e `public/_headers`
4. É permitido colocar também `GUIA_INSTALACAO.md` e `extra/exportar-progresso-github.html` para consulta/backup. Não envie `node_modules`.
5. Confirme o commit na branch `main` (ou na branch que pretende conectar ao Cloudflare).

**Importante:** não substitua o `index.html` antigo da **raiz** do repositório. O Cloudflare vai usar a pasta `public`.

### Etapa 3 — criar o Worker vinculado ao GitHub

1. Abra https://dash.cloudflare.com/ e entre ou crie uma conta gratuita.
2. Vá para **Workers & Pages → Create application**.
3. Escolha a opção de **importar/conectar GitHub** (a apresentação pode mudar de nome).
4. Autorize o acesso e escolha o repositório **`s2rcunha/cursos`**.
5. Nome do Worker: **`cursos-aph`** (deve corresponder ao campo `name` do `wrangler.jsonc`).
6. Branch de produção: `main`. Diretório raiz: a raiz do repositório (`/` ou vazio).
7. Se aparecerem configurações de build, deixe **Build command** vazio e use **Deploy command:** `npx wrangler deploy`.
8. Clique em **Save and Deploy** ou **Deploy**.

O Cloudflare instalará as dependências e publicará a página e a API numa única implantação. A URL será exibida no painel, semelhante a `https://cursos-aph.<seu-subdominio>.workers.dev`. **Não invente o subdomínio: use o que o Cloudflare fornecer.**

### Etapa 4 — testar antes de divulgar

1. Acesse `https://SEU-ENDERECO.workers.dev/api/health`.
2. Resultado esperado: algo parecido com:

   ```json
   {"status":"ok","api":"conectada","appsScript":"conectado","cursosLiberados":1}
   ```

   O número de cursos pode ser `0` se você ocultou todos — isso não é erro.
3. Entre na raiz `https://SEU-ENDERECO.workers.dev/`: o Portal APH deve abrir sem pedir endereço do servidor.
4. Confira no Chrome normal do celular, inclusive com várias contas Google conectadas.
5. Faça login administrativo. Teste **uma alteração reversível**, por exemplo ocultar e liberar um módulo, e confirme que o catálogo público é atualizado.
6. **Somente depois dos testes**, divulgue o novo endereço aos alunos. Mantenha o antigo por alguns dias como contingência.

### Etapa 5 — atualizações posteriores

Com a integração GitHub ativada, alterações nos arquivos do repositório conectado disparam novas implantações automaticamente no Cloudflare. Não é preciso reconfigurar o Apps Script nem copiar arquivos manualmente a cada atualização.

## Opção alternativa: publicar pelo computador (terminal)

Requer **Node.js** instalado e acesso à sua conta Cloudflare:

```bash
npm install
npx wrangler login
npx wrangler deploy
```

Execute esses comandos **na pasta que contém `wrangler.jsonc`**, não dentro de `public`. Para testar localmente: `npm run dev`.

## Como está organizada a pasta

```
wrangler.jsonc                 configuração do Worker e da pasta de assets
package.json                  comandos e dependência Wrangler
src/worker.js                 servidor Cloudflare e ponte com Apps Script
public/index.html             portal do aluno e área administrativa
public/config.js              API local (/api/aph), sem senha
public/_headers               orientações de cache para o navegador
tests/worker.test.mjs          testes automatizados do servidor
tests/test_browser.py          teste de interface em ambiente simulado
extra/exportar-progresso-github.html   transferência opcional de progresso
GUIA_INSTALACAO.md            este guia
```

## Progresso das aulas já assistidas

O histórico de aulas assistidas fica no `localStorage`, separado por domínio. Ele **não migra automaticamente** do antigo `s2rcunha.github.io` para `workers.dev`.

Para transferir, caso queira:

1. Envie `extra/exportar-progresso-github.html` para dentro da pasta `extra` do repositório GitHub original.
2. No mesmo navegador/dispositivo em que fez as aulas, abra `https://s2rcunha.github.io/cursos/extra/exportar-progresso-github.html`.
3. Toque em **Baixar meu progresso**. O arquivo será `progresso_aph.json`.
4. Abra o Portal APH no Cloudflare → **Meu progresso → Restaurar progresso** → selecione o arquivo.

A importação junta as aulas do backup com as já marcadas no novo endereço, sem apagar as existentes.

## Segurança

- A senha administrativa continua validada pelo Apps Script, **não** por JavaScript no navegador.
- O código do Worker só aceita operações administrativas reconhecidas e solicitações POST provenientes do próprio domínio (verificação de origem; a autenticação do Apps Script é a proteção principal).
- O Worker **não grava** o JSON, a senha ou as sessões em um banco Cloudflare. Repassa o necessário ao Apps Script via HTTPS.
- O Apps Script deve continuar publicado com **Executar como: Eu** e **Quem pode acessar: Qualquer pessoa** para a API pública; a edição depende da senha do portal.
- Não habilite logs de corpos de solicitações no Cloudflare: eles podem conter tokens e credenciais administrativas.
- O catálogo público enviado aos alunos é filtrado pelo `Code.gs` para mostrar somente cursos e módulos liberados. Links do PDF precisam ter suas permissões de compartilhamento ajustadas no Drive.

## Se não carregar

| Sintoma | Verificação |
| --- | --- |
| `404` na raiz do Worker | Confira `assets.directory = ./public`, branch e log da implantação. |
| `/api/health` retorna `status: erro` | Verifique a implantação `/exec` do Apps Script e a permissão **Qualquer pessoa**. |
| `/api/health` retorna conectado, mas a página não carrega cursos | Abra a aba de rede/console do navegador; confira se `/api/aph?action=public` retorna JSON. |
| Área do aluno abre, mas login não funciona | Teste o login no portal antigo, sem mudar a senha; confira o resultado do POST `/api/aph` e da consulta `/api/aph?action=status`. |
| Módulo não aparece | Confira **Liberação de conteúdo** na administração. |
| Miniatura ou PDF não abre | Revise o link e as permissões externas do YouTube/Drive. |

## Custo

O Cloudflare Workers Free oferece uma franquia gratuita de requisições ao Worker e serve arquivos estáticos dentro de seus limites. O Apps Script e o Google Drive seguem sujeitos às cotas do Google. Se a utilização ultrapassar os limites gratuitos, reveja a configuração e as condições vigentes do serviço antes de contratar recursos adicionais.

## Observações de testes

- A sintaxe JavaScript do site e do Worker foi verificada.
- Testes locais passaram para leitura pública, endpoint de diagnóstico, operações administrativas, validação de origem e erros da API.
- A navegação em tela de 390 px foi conferida com uma **API simulada**, sem conexão real à conta Google.
- **Não houve implantação na sua conta Cloudflare**; a validação ponta a ponta da implantação depende de você publicar o pacote.
