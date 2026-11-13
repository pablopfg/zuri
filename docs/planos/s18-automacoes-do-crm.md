# Plano · S18 Servidor das automações do CRM (manifesto, ensaio, conferência)

Situação: em implementação (PR da S18)
Origem: PR S18 de [implementacao-frontend-sinal.md](implementacao-frontend-sinal.md) (linha da seção 11 e P20 da seção 4.2); PR 1 ("Base dos módulos") de [modulos-crm.md](modulos-crm.md) e de [modulos.md](modulos.md)
Dependências: S17 (#327) mesclada

## 1. Resumo

A base das automações do CRM: o manifesto que cada automação declara, o registro fixo no código, os estados (Desligada, Em ensaio, Ligada, Pausada), o ensaio que roda no horário real sem mudar nada fora, a conferência do ensaio pelo Pablo e a parte **CRM › Automações** com a lista na ordem em que as automações chegam. Nenhuma automação de verdade entra aqui: todas aparecem como "Próxima a chegar" ou "Em desenvolvimento", e a primeira com código (o pedido de avaliação) vem na S20. Tudo nasce desligado.

## 2. Contexto no sistema

- Credenciais da S17 (`apps/agent/src/flows/connections.ts`): tipos `http` e `chatwoot`, chave cifrada por tipo, `fixed()` para os clientes do código, `testConnection` (5 por minuto por credencial).
- Alarme único (`apps/agent/src/agent/zuri-agent.ts`): os fluxos rodam no `tick` com o contador de subrequisições do despertar (`currentWake()`, teto de 44).
- Bloqueio (`auth.lockdown.active()`): nada externo roda.
- Feriados nacionais em `packages/shared/src/holidays.ts`.
- Decisões: 09/11 (Automações do n8n reescritas no código), 10/11 (termos: "Automação" só as do CRM; "módulo" só no código), **11/11 (sem integração com o n8n: a Zuri não recebe eventos dele)**.

### O ensaio sem o n8n

Os planos de 09 e 10/11 comparavam o ensaio com um retorno assinado do n8n. A decisão de 11/11 tirou a rota que recebia eventos do n8n, e em 13/11 o Pablo disse que vai remover as automações do n8n: a Zuri passa a ser a única responsável. Por isso o ensaio vira uma **prévia conferida pelo Pablo**: a Zuri roda no horário real, não envia nada e lista, dia a dia, o que faria; o Pablo marca o dia como **Está certo** ou **Tem erro** (com o motivo). Três dias úteis seguidos certos liberam **Ligar de verdade**; antes disso, só assumindo o risco com a senha.

### A ordem das automações

A do protótipo aprovado do Sinal (CRM › Automações): pedido de avaliação, ligar avaliação ao contato, confirmação de consulta, aviso de plano liberado, relatório das mensagens, contatos iguais no Chatwoot, posts no Perfil do Google, parabéns de aniversário, convite para voltar e acompanhamento do plano. A lista é só a ordem de chegada: cada uma que escreve a pacientes continua precisando do "sim" do Pablo quando a PR dela chegar.

## 3. Objetivo e critérios de aceite

| Nº | Critério | Origem |
| --- | --- | --- |
| CA1 | O manifesto de cada automação é conferido por Zod no teste e na partida: id, versão, versão dos efeitos, gatilho, tipo de credencial, chamadas permitidas (método e caminho), opções com padrão e faixa, efeitos e tetos | modulos.md, "O manifesto" |
| CA2 | Toda automação nasce **desligada**; ligar começa sempre em ensaio | plano S18 |
| CA3 | No ensaio, nenhuma chamada que muda algo fora sai: o efeito vira anotação "Faria" e uma chamada que não é leitura fora de um efeito é recusada | modulos.md, CA3 |
| CA4 | Chamada fora do manifesto (método ou caminho) é recusada antes de sair | modulos.md, CA6 |
| CA5 | Começar o ensaio pede a senha recente, a credencial do tipo certo (quando o manifesto pede) e opções dentro da faixa | modulos.md |
| CA6 | Ligar de verdade pede a senha recente e 3 dias úteis seguidos marcados como "Está certo" desde o início do ensaio, ou a confirmação de assumir o risco | modulos.md, regra |
| CA7 | Até 10 automações ligadas (ensaio ou ligada) ao mesmo tempo | modulos.md |
| CA8 | Desligar não pede nada e para na hora; o bloqueio para tudo | modulos.md |
| CA9 | Disjuntor: 2 falhas seguidas ou a credencial recusada pausam e avisam; o teto de execuções do dia segura até o dia seguinte | modulos.md |
| CA10 | Versão nova dos efeitos no código devolve uma automação ligada ao ensaio e avisa | modulos.md |
| CA11 | Cada efeito tem chave única: a mesma chave nunca sai duas vezes | modulos.md, "Envio sem repetir" |
| CA12 | Credencial usada por uma automação não pode ser apagada (`CONFLICT` com o nome) e aparece em "Usada por" | modulos.md, regra 5 |
| CA13 | "Avisar quando chegar" guarda o pedido e avisa uma vez quando a automação ganha código | protótipo |
| CA14 | CRM › Automações mostra a lista na ordem, o estado de cada uma, se escreve a contatos e o que usa, com estados vazio, carregando e erro | protótipo, P20 |

## 4. Escopo

**Entra:** migration 39; tipos e schemas em `packages/shared/src/crm-automations.ts`; manifesto, registro, runtime e serviço em `apps/agent/src/crm/automations/`; rotas `/api/crm/automations/*`; avisos; parte CRM › Automações (lista, "Avisar quando chegar", painel de ligar e acompanhar); uma automação de exemplo **só no ambiente local** (para o e2e e as capturas, nunca registrada em produção).

**Fora:** qualquer automação real (S20 em diante); a fila do Chatwoot e CRM › Envios (S19); calendário de dias sem expediente (E5 da agenda); retorno do n8n (decisões de 11/11 e 13/11).

## 5. Como funciona para o Pablo

1. CRM abre em **Automações**: a base (dias úteis e feriados, fila do Chatwoot, contato de cada consulta, cada uma com o estado real) e a lista numerada.
2. Automação sem código: "Próxima a chegar" ou "Em desenvolvimento", com o sino **Avisar quando chegar**.
3. Automação com código: **Ligar** abre o painel com a credencial (só as do tipo que ela pede), **Testar credencial** (o teste da S17, `POST /api/flows/connections/:id/test`), as opções com faixa e **Salvar e começar o ensaio** (senha).
4. Em ensaio, **Acompanhar** mostra o que a Zuri faria, dia a dia, com **Está certo** e **Tem erro**; depois de 3 dias úteis conferidos, **Ligar de verdade** (senha). **Desligar** sempre.

### Textos visíveis

`packages/shared/i18n/pt-BR-crm-automations.ts` e `en`; erros `error.crmAutomation*`. Passada do humanizer.

## 6. Regras de negócio e limites

`CRM_AUTOMATION_LIMITS`: 10 ligadas; 3 dias úteis; motivo da diferença até 280 caracteres; execuções guardadas por 90 dias, efeitos por 180, conferências por 180; até 50 linhas por página do acompanhamento; uma automação por despertar. Dia útil: segunda a sexta sem feriado nacional.

## 7. Desenho técnico

### Rotas

| Rota | O que faz | Proteção |
| --- | --- | --- |
| `GET /api/crm/automations` | Base, lista e estado | Sessão |
| `PUT /api/crm/automations/:id/config` | Credencial e opções | Sessão + senha recente |
| `POST /api/crm/automations/:id/mode` | `rehearsal`, `live`, `off` | Sessão + senha recente, menos `off` |
| `GET /api/crm/automations/:id/activity` | Execuções, efeitos e dias conferidos | Sessão |
| `PUT /api/crm/automations/:id/days/:day` | Conferência do dia (`match` = "Está certo", `differs` = "Tem erro", com o motivo) | Sessão |
| `PUT /api/crm/automations/:id/watch` | Avisar quando chegar | Sessão |

Fora de `WHILE_LOCKDOWN`, como as rotas dos fluxos.

### Arquivos

`packages/shared/src/crm-automations.ts`, i18n; `apps/agent/src/crm/automations/{manifest,registry,runtime,service,example}.ts`, `api/crm-automations.ts`, `agent/zuri-agent.ts`, `db/migrations.ts`, `flows/service.ts` (uso da credencial); `apps/web/src/pages/crm/AutomationsPart.tsx`, `CrmPage.tsx`, `App.tsx`.

### Banco

Migration 39 `crm_automations`, só acréscimo:

- `zur_crm_automations`: id, versão dos efeitos, estado, opções (JSON), credencial, motivo da pausa, falhas seguidas, início do ensaio, ligada desde, próxima execução, pedido de aviso. Gatilhos da área `crm`.
- `zur_crm_automation_runs`: execuções (modo, resultado, chamadas, efeitos), sem conteúdo de mensagem; 90 dias.
- `zur_crm_automation_effects`: chave única, modo, estado (`would`, `pending`, `done`, `failed`), rótulo curto; 180 dias.
- `zur_crm_automation_days`: conferência por dia; 180 dias.

Fora do backup, como as credenciais que elas usam: restaurar não religa nada.

### Ferramentas do agente

Nenhuma. Ligar, desligar e conferir ficam só na tela.

### Agendamentos, IA e integrações externas

No alarme único, depois dos fluxos, uma automação por despertar, dividindo o contador de subrequisições. Sem IA nesta PR.

## 8. Custo e cotas do plano Free

Nenhum recurso novo. Sem automação ligada, o despertar lê uma linha a mais (a próxima execução). Medido em `free-tier-budget.test.ts`.

## 9. Segurança e privacidade

- Nenhum caminho, método ou endereço fora do manifesto; a credencial só pelo `fixed()` da S17.
- No ensaio, o runtime não chama o efeito: o teste prova por automação.
- A automação de exemplo só existe com o ambiente local (`development()`); em produção o registro é só o fixo.
- Rótulos dos efeitos curtos, sem texto de mensagem; fora do backup e apagados no prazo.
- Auditoria completa (S18 está na lista).

## 10. Testes

Unitário e integração em `apps/agent/test/crm-automations.test.ts` (manifesto, estados, senha, credencial, faixas, dias úteis n−1/n, risco, teto de 10, ensaio sem efeito, chamada fora do manifesto, disjuntor, versão, chave única, bloqueio, aviso, poda, migration); `flows` (credencial em uso); `free-tier-budget`; shared (schemas); e2e de CRM › Automações com axe.

## 11. Entrega

Uma PR para a `develop`.

## 12. Riscos

- JS inicial a 10 B do teto: a parte nova fica no pedaço do CRM, sem ícone novo fora dele.
- Conferência manual mais lenta que a automática: o Pablo pode assumir o risco com a senha.

## 13. Suposições

- Dia útil sem os dias sem expediente do consultório até a E5 trazer esse calendário.

## 14. Entrevista com o Pablo

| Data | Pergunta | Resposta |
| --- | --- | --- |
| 13/11/2026 | Como o ensaio confere o que o n8n fez, sem integração com ele? Recomendação: o Pablo marca cada dia | O Pablo vai remover as automações do n8n; o ensaio vira prévia conferida por ele, dia a dia (03:19 UTC) |
