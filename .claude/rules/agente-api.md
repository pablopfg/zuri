---
paths:
  - "apps/agent/src/api/**"
  - "apps/agent/src/auth/**"
---

# API e autenticação

- Rotas seguem a tabela "Contrato da API" da especificação; rota nova entra na tabela no mesmo PR.
- Toda rota de sessão exige cookie `__Host-` + CSRF; ação sensível exige senha recente (15 min).
- Sem acesso por token (decisão do Pablo, 11/11/2026): pedido com `Authorization` recebe 401 no Worker e na API, mesmo com sessão válida junto. Nenhuma rota nova aceita token.
- Erros no formato `{ code, message, details? }`, com os códigos da especificação; nunca stack trace na resposta.
- Limites de tamanho em todo corpo, lista e string. Limitadores por rede nas rotas de login, recuperação e aprovação.
- Nunca registre senha, código, token, e-mail digitado errado ou corpo de requisição.
- Rota nova: o teste que percorre `app.routes` (`auth-password-route.test.ts`) já a cobre na troca de senha obrigatória; rota pública nova vai para a lista `PUBLIC` dele. Ação sensível nova entra no teste de senha recente (14:50 passa, 15:00 falha, nada gravado quando recusa).
- Texto guardado: schemas com `line()`/`text()` de `packages/shared/src/productivity.ts` (sem controle, sem surrogate solto, em NFC). Busca literal compara `foldSearch(q)` com `searchColumn(col, q)`, nunca `lower()` puro (o SQLite só dobra A–Z); a coluna só é dobrada quando a busca tem acento, porque as 30 trocas custam ~20x mais CPU.
