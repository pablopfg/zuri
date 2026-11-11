# Plano · Tirar a integração com o n8n

Situação: aprovado em 11/11/2026 (pedido do próprio Pablo)
Origem: pedido do Pablo em 11/11/2026: "A Zuri não vai receber evento do n8n, logo, o sistema não será integrado ao n8n. Remova essa integração se estiver no código."
Dependências: nenhuma. A PR #293 (ajustes do CRM e dos fluxos na tela) foi avisada para não mexer nos limites dos eventos.

Versão curta do modelo: é uma remoção, sem tela nova, sem migration e sem rota nova.

- **Problema:** desde a etapa 22b a Zuri aceita eventos assinados do n8n em
  `POST /api/crm/events/<chave>`, uma porta que o Worker atende antes do
  Cloudflare Access e sem sessão. O Pablo decidiu que a Zuri não se integra ao
  n8n: os fluxos de lá serão reescritos como funcionalidade no código da Zuri
  (plano `docs/planos/modulos-crm.md`, fora desta PR).
- **Mudança:**
  - Servidor: saem `apps/agent/src/crm/events.ts`,
    `apps/agent/src/gates/crm-events.ts`, o desvio dos eventos em
    `apps/agent/src/index.ts`, `registerCrmEvents` e as rotas
    `POST`/`DELETE /api/crm/events-key` em `apps/agent/src/api/crm.ts`, e o
    campo `events` de `GET /api/crm`. Sai também o aviso de cliente novo vindo
    do n8n (`announceNew`, `newClients` em `PATCH /api/crm/settings`), que só
    os eventos disparavam.
  - Pacote comum: saem `crmEventSchema`, `CRM_EVENTS_PATH`, `CRM_EVENTS_KEY`,
    os dois cabeçalhos de assinatura, `CRM_ACTIVITY_KINDS` e os limites dos
    eventos em `CRM_LIMITS`.
  - Tela **CRM** (`apps/web/src/pages/crm/CrmCards.tsx`): sai o cartão
    **Eventos do n8n** e o interruptor **Cliente novo vindo do n8n**. Fica o
    cartão **Avisos do CRM** com retorno e aniversários.
  - Textos: saem as chaves `web.crm.events.*`, `web.crm.settings.newClients` e
    `error.crmUnknownClient`. Os exemplos do acesso remoto deixam de citar o
    n8n.
  - Documentos: `docs/crm.md`, `docs/acesso-remoto.md`, `docs/backup.md`,
    `docs/instalacao-cloudflare.md`, `README.md`, a seção de contratos de
    `docs/especificacao.md` e `.claude/memoria/decisoes.md`.
- **Fica fora:**
  - O banco. Migration não se desfaz e dado do dono não se apaga:
    `zur_crm_inbox`, `zur_crm_counts` e as colunas `events_key`,
    `last_event_at` e `new_clients` ficam sem uso; clientes com `source = 'n8n'`
    e `ref` continuam guardados, e o backup continua levando e trazendo os
    dois campos.
  - Registros antigos continuam legíveis: o tipo `crm_events_key` da atividade
    de acesso e o aviso `crm.newClient` ficam nas listas e no catálogo, com
    texto que não promete mais o recurso.
  - A trava que faz as ferramentas de MCP pedirem confirmação depois que a
    conversa lê o CRM continua: o histórico pode guardar texto vindo de fora.
  - O acesso remoto por token (etapa 20, `POST /api/remote/events`) é outro
    recurso, genérico, e continua. Se o Pablo quiser tirá-lo também, é outra
    PR.
  - Trazer os fluxos do n8n para o código da Zuri.
- **Testes:**
  - `apps/agent/test/crm-routes.test.ts`: uma chave deixada ligada no banco e
    um evento assinado com o segredo certo não gravam nada; sem sessão a
    resposta é a de qualquer endereço da API (401 ou 403), com sessão é 404;
    `GET /api/crm` não traz `events`; `newClients` é recusado com 400.
  - `packages/shared/test/crm.test.ts`: o pacote não exporta mais nada dos
    eventos.
  - `apps/agent/test/remote-routes.test.ts`: a caminhada por todas as rotas
    não tem mais exceção para `/api/crm/events/`.
  - `tests/e2e/crm-cartoes.spec.ts`: a tela não oferece eventos e os endereços
    respondem 404; axe e alvos de 44 px no cartão que ficou.
  - Saem `apps/agent/test/crm-events.test.ts` e os testes do esquema dos
    eventos, junto com o código que provavam.
- **Riscos e custo:** um n8n que ainda mande eventos passa a receber recusa;
  não há instalação em produção. Custo: nenhum recurso novo; some uma rota que
  gastava até 1.000 requisições por dia.
- **Segurança:** diminui a superfície. Some o único caminho de gravação no CRM
  sem sessão, e a exceção ao Cloudflare Access para `api/crm/events/*` sai do
  guia de instalação.

Sem perguntas ao Pablo: o pedido já decide o que sai, e o que fica no banco
segue as regras de migration e de dado do dono.
