# Plano · S17 Servidor de credenciais (tipos, espera e teste)

Situação: implementado (PR da S17)
Origem: PR S17 de [implementacao-frontend-sinal.md](implementacao-frontend-sinal.md) (linha da seção 11 e P22 da seção 4.2)
Dependências: S15 (#320) e S16 (#325) mescladas

## 1. Resumo

As credenciais de CRM › Credenciais ganham um **tipo**. `http` é o que já existe (o passo "Chamar um serviço" dos fluxos). `chatwoot` é novo: endereço, número da conta, caixa de entrada, chave do agente e as duas esperas entre mensagens (envios em massa e mensagem a uma pessoa). A linha da credencial passa a mostrar o tipo e o final da chave, e o botão **Testar** faz só uma leitura. Mudar o endereço agora pede a chave de novo, em vez de apagá-la calado. O cofre fica aberto a tipos novos (a entrega E6 acrescenta `fzap` e SMTP) com um registro por tipo.

## 2. Contexto no sistema

- `apps/agent/src/flows/connections.ts` (`FlowConnections`): cria, muda, apaga, apresenta e chama as credenciais; tabela `zur_flow_connections` (migration 24); chave cifrada com `McpCredentials` (`MCP_CREDENTIAL_KEY`, `info` "flows-v1", id da linha como dado associado).
- Rotas em `apps/agent/src/api/flows.ts` (`/api/flows/connections`); senha recente para criar e editar; aviso de segurança (`flow_connection_added`/`changed`).
- `FlowService.removeConnection` já recusa apagar credencial usada por fluxo (`CONFLICT`, `error.flowConnectionInUse`).
- Tela: `apps/web/src/pages/automations/flows/ConnectionDialog.tsx` e `FlowsPanel.tsx` (`CredentialsPart`), carregadas sob demanda pela página do CRM (S15).
- Backup: lista positiva de tabelas em `apps/agent/src/backup/export.ts`; as credenciais não vão.
- Decisões: 09/11 (pedido de avaliação pelo Chatwoot, caixa API); 10/11 (intervalo na credencial, uma fila por caixa); 12/11 22:11 e 22:37 (espera em segundos: envios em massa 5 a 600 s, padrão 30 a 60; mensagem a uma pessoa 1 a 30 s, padrão 2 a 5, sempre menor que a dos envios em massa). Planos: [modulos.md](modulos.md) seção "Conexões compartilhadas", [modulos-crm.md](modulos-crm.md) "Fluxo 1 · Cadastrar o Chatwoot", [envio-chatwoot-pela-zuri.md](envio-chatwoot-pela-zuri.md) (chamadas e cabeçalho `api_access_token`).

## 3. Objetivo e critérios de aceite

| Nº | Critério | Origem |
| --- | --- | --- |
| CA1 | Toda credencial tem um tipo, `http` ou `chatwoot`; as que já existiam viram `http` sem mudar nada | plano S17 |
| CA2 | A chave nunca volta ao navegador: a lista traz só "tem chave" e os 4 últimos caracteres (só com chave de 12 ou mais) | plano S17 |
| CA3 | Credencial em uso por um fluxo não pode ser apagada (`CONFLICT` com os nomes) | plano S17 |
| CA4 | Mudar o endereço ou o modo da chave sem mandar a chave nova é recusado (`VALIDATION_FAILED`, campo `credential`) | modulos.md, regra 3 |
| CA5 | Chatwoot: endereço https público, conta de 1 a 999.999.999, chave obrigatória ao criar | modulos.md |
| CA6 | Espera dos envios em massa de 5 a 600 s (padrão 30 a 60) e de mensagem a uma pessoa de 1 a 30 s (padrão 2 a 5), "De" ≤ "Até" e a de uma pessoa sempre menor que o "De" dos envios em massa; fora disso, `VALIDATION_FAILED` | decisões 12/11 |
| CA7 | Mudar só as esperas não pede a senha, mas entra na atividade | modulos-crm.md |
| CA8 | Escolher a caixa de entrada confere, com a chave guardada, que a caixa existe e guarda o nome dela | modulos-crm.md |
| CA9 | "Testar" só lê: `http` faz um GET no primeiro caminho (só se GET é permitido); `chatwoot` lista as caixas. Respeita DNS público, sem redirecionamento, 10 s e 256 KB; no máximo um teste a cada 5 s por credencial | modulos.md, regra 8 |
| CA10 | Fluxo não usa credencial `chatwoot`: o servidor recusa salvar e o motor recusa chamar | modulos.md, regra 7 |
| CA11 | Cada tipo tem a sua chave de cifra (`flows-v1`, `chatwoot-v1`): a chave cifrada de um tipo não abre como outro | modulos.md, regra 2 |
| CA12 | Tipo novo entra por um registro (tipo → `info` da cifra, schemas, teste), sem mexer nas rotas | coordenador (E6) |

## 4. Escopo

**Entra:** migration 38 (colunas `kind`, `meta`, `key_end`), tipos e schemas em `packages/shared`, `FlowConnections` com registro por tipo, rota `POST /api/flows/connections/:id/test`, cliente fixo `apps/agent/src/flows/chatwoot.ts` (só listar caixas), tela: escolha do tipo ao criar, diálogo do Chatwoot, etiqueta do tipo, final da chave, Testar e o aviso do endereço.

**Fora:** fila de envio, "próximo envio livre em" e CRM › Envios (S19); webhook do Chatwoot e o segredo dele (S19/S20, junto com quem recebe os eventos); "Enviar teste para mim" (S19, precisa da fila); `fzap` e SMTP (E6); rota separada `/secret` (a troca de chave continua no `PATCH`, que já pede a senha: duas rotas para a mesma coisa seriam dois lugares a proteger).

## 5. Como funciona para o Pablo

1. CRM › Credenciais › **Nova credencial** pergunta o tipo: **Chatwoot** ou **Outro serviço (https)**.
2. Chatwoot: nome, endereço, número da conta, chave de acesso e as duas esperas. Salvar pede a senha (como hoje).
3. Na linha da credencial, **Testar**: no Chatwoot, mostra quantas caixas a chave enxerga. Em **Editar**, "Buscar caixas" lista as caixas para escolher a do WhatsApp.
4. A linha mostra "Chatwoot" ou "Serviço", "Chave terminada em 4f2a" e, no Chatwoot, a conta, a caixa e as esperas.
5. Editar o endereço sem digitar a chave: a tela avisa "O endereço mudou: digite a chave de novo." e o servidor recusa do mesmo jeito.

### Textos visíveis

Catálogo `pt-BR-flows`/`en` (chaves `web.flows.connection.*`, `web.flows.connections.*`) e erros `error.flowConnection*`. Passada do humanizer.

## 6. Regras de negócio e limites

`CHATWOOT_LIMITS` em `packages/shared/src/flows.ts`: conta 1 a 999.999.999; massa 5 a 600 s (30 a 60); uma pessoa 1 a 30 s (2 a 5); até 50 caixas listadas, nome cortado em 80 caracteres; teste a cada 5 s por credencial. Final da chave: 4 caracteres, só com chave de 12 ou mais.

## 7. Desenho técnico

### Rotas

- `POST /api/flows/connections`: corpo com `kind` (`http` quando falta). Senha recente.
- `PATCH /api/flows/connections/:id`: schema do tipo da linha (o tipo não muda). Senha recente, menos quando o corpo só traz `bulkGap` e `oneGap`.
- `POST /api/flows/connections/:id/test` (novo): sem corpo, sem senha (só lê, e a chave só vai ao endereço que o dono já cadastrou). `RATE_LIMITED` com `retryAfter` dentro de 5 s.

### Arquivos

`packages/shared/src/flows.ts`, `flows-schemas.ts`, i18n; `apps/agent/src/flows/connections.ts`, `chatwoot.ts` (novo), `service.ts`, `engine.ts`, `api/flows.ts`, `agent/zuri-agent.ts`, `db/migrations.ts`; `apps/web/src/pages/automations/flows/ConnectionDialog.tsx`, `ChatwootDialog.tsx` (novo), `FlowsPanel.tsx`, `CrmPage.tsx`.

### Banco

Migration 38 `flow_connection_kinds`, só acréscimo: `kind TEXT NOT NULL DEFAULT 'http'` (sem `CHECK`, para que um tipo novo não peça refazer a tabela; o código confere), `meta TEXT` (JSON do tipo: conta, caixa, esperas) e `key_end TEXT`. Nenhum dado existente muda.

### Ferramentas do agente

Nenhuma. Nenhuma ferramenta nem comando do bot chega às credenciais.

### Agendamentos, IA e integrações externas

Sem alarme novo. O teste faz até 3 subrequisições (duas consultas de DNS e um GET), dentro do teto por requisição. Nenhuma chamada de IA.

## 8. Custo e cotas do plano Free

Nenhum recurso novo. Listar as credenciais lê as mesmas linhas de antes (até 20); salvar a espera grava uma linha mais a da atividade. Medido em `free-tier-budget.test.ts`.

## 9. Segurança e privacidade

- A chave cifrada por tipo (`info` próprio) e com o id da linha como dado associado.
- O final da chave (4 caracteres de uma chave de 12 ou mais) é o mesmo que serviços de chave mostram; nada mais da chave sai do objeto.
- O teste e a escolha da caixa usam o mesmo caminho das chamadas dos fluxos: DNS público conferido, sem redirecionamento, prazo, tamanho, resposta de erro nunca lida. A resposta do Chatwoot é dado: só id, nome (texto, cortado) e se a caixa é do tipo API voltam.
- Fluxo nunca chama o Chatwoot (CA10).
- Auditoria completa (S17 está na lista).

## 10. Testes

Unitário e integração em `apps/agent/test/flow-connections.test.ts` (kinds, esperas n−1/n/n+1, chave de novo, final da chave, teste, caixa, cifra por tipo, migration), `flows-routes` (senha, rate), `free-tier-budget`; shared (schemas); e2e de Credenciais (escolher tipo, Chatwoot, etiqueta, final da chave, Testar) com axe.

## 11. Entrega

Uma PR para a `develop`.

## 12. Riscos

- JS inicial a 9 B do teto: o diálogo novo fica no pedaço do CRM, sem ícone novo do lucide fora dele. Medido com `npm run size`.

## 13. Suposições

- A resposta de `GET /api/v1/accounts/{conta}/inboxes` é `{ payload: [{ id, name, channel_type }] }` (documentação da API do Chatwoot). Formato diferente vira "resposta fora do formato".

## 14. Entrevista com o Pablo

Sem pergunta nova: as esperas e o comportamento vêm das decisões de 10/11 e 12/11.
