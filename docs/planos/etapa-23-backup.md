# Plano · Etapa 23 · Backup, importação e retenção

Situação: aprovado em 09/11/2026 (modo contínuo; nenhuma pergunta de produto, custo ou segurança ficou aberta)
Origem: etapa 23 da especificação; decisão do Pablo de 02/11/2026 (backup diário cifrado no R2 ⚠); `docs/planos/migracao-vps.md`
Dependências: 0 a 22c, 19b–19d, 20 e 21 mescladas (`develop` em 6a2ba55)

## 1. Resumo

Hoje os dados do dono só saem da Zuri pelo próprio código: se a conta da
Cloudflare parar, ficam presos. A etapa 23 entrega, em duas PRs mescláveis
sozinhas:

- **23a (esta PR):** exportar tudo o que o contrato do backup permite num
  arquivo JSON versionado e portátil, importar esse arquivo com as regras de
  entrada não confiável (tudo ou nada) e mostrar o uso do armazenamento por
  tipo em Configurações › Dados.
- **23b:** backup automático diário, compactado e cifrado com a chave pública
  do dono (a chave privada nasce no navegador e nunca vai ao servidor),
  enviado ao R2 `BACKUP_BUCKET` ⚠ com as 7 cópias mais novas, restauração no
  navegador, a cópia mensal pelo Telegram e o aviso de 30 dias.

Lixeira de 30 dias, limites por tipo e teto de 900 MB já existem (etapa 6,
`apps/agent/src/productivity/storage.ts`); a 23a só os mostra.

## 2. Contexto no sistema

- Banco: `apps/agent/src/db/migrations.ts` já diz, tabela por tabela, o que
  entra no backup ("In the backup" / "Not in the backup"). A última migration
  é a 29 (`paid_models`, `local_only` em memórias e notas); a 30 está
  reservada para os guardrails parte 2 (#196). **Esta etapa não cria
  migration**: o estado do backup automático (23b) fica em chaves internas de
  `zur_settings` (`InternalState`), como os outros estados de uma linha.
- Limites: `STORAGE_LIMITS` e `DATABASE_MAX_BYTES` em
  `packages/shared/src/productivity.ts`; `StorageGuard` lê `zur_counts`
  (contadores por gatilho) e `databaseSize`.
- Configurações: `apps/agent/src/db/settings.ts` (`STORAGE_KEYS`); as chaves
  internas (`InternalState`) nunca saem, porque a lista do backup é positiva.
- Automações: `AutomationService` (`apps/agent/src/automations/service.ts`),
  com `pending_approval` e `approve` (senha quando há MCP em rotinas).
- CRM: `CrmService` (`apps/agent/src/crm/service.ts`), limites `CRM_LIMITS`.
- Alertas de segurança: `zur_auth_events` + `SECURITY_ALERT_EVENTS`
  (`packages/shared/src/alerts.ts`), como `crm_events_key`.
- Tela: `apps/web/src/pages/settings/DataTab.tsx` (lixeira e um cartão
  "chega numa próxima versão").
- Bot: `/backup` em `apps/agent/src/telegram/commands.ts` (texto fixo e
  botão para Configurações › Dados; a 23b passa a contar a idade).
- Talorys: `apps/agent/src/services/backup.ts` (export/import JSON, upsert por
  id). Aproveitamos a ideia de lista fechada de configurações e do "nada que
  liga sozinho"; evitamos o upsert por id (o contrato pede ids novos) e a
  validação frouxa (aqui o schema é estrito e recusa o arquivo inteiro).
- Decisões: 02/11/2026 (backup diário cifrado, 7 cópias, R2 ⚠, Telegram
  mensal); 22b ("o backup leva o CRM inteiro"); 19b/19c (contatos e
  avaliações fora do backup); 20 (`zur_remote_*` fora); 21 (chaves de
  provedor fora; `local_only` dentro).

## 3. Objetivo e critérios de aceite

| Nº | Critério | Origem |
| --- | --- | --- |
| CA1 | Exportação JSON `{ format: "zuri-backup", version: 1, schema, exportedAt, data }` com tarefas, notas, projetos, memórias, conversas, automações (pausadas) e configurações não sensíveis, mais o CRM e o aprendizado de prioridade dos avisos | especificação, 22b |
| CA2 | Leva a versão do formato e o número da última migration, e nada que dependa da Cloudflare para ser lido | prompt da etapa |
| CA3 | Nunca leva TOTP, códigos de recuperação, passkeys, sessões, tokens, vínculo do Telegram, credenciais MCP/Google/fluxos, `zur_contact_*`, `zur_review*`, `zur_crm_inbox`, `zur_remote_*`, `zur_flow_runs`, segredos de provedor de IA nem as chaves internas de `zur_settings` | especificação, decisões |
| CA4 | Leva `localOnly` de memórias e notas, e ele volta igual na importação | coordenador (decisão 21) |
| CA5 | Ida e volta: exportar, importar num banco vazio e comparar dá o mesmo conteúdo | prompt da etapa |
| CA6 | Importação é entrada não confiável: schema estrito; um backup malicioso (automação ligada, MCP, 11 MB, 10.001 memórias) é recusado inteiro, sem gravar nada | prompt da etapa, regra 8 |
| CA7 | Importar nunca liga automação, MCP, modelo pago, nome do agente nem instruções; rotinas com IA chegam esperando aprovação | especificação, regra 8 |
| CA8 | A importação mescla com ids novos; um limite por tipo ou o teto do banco ultrapassado desfaz tudo | especificação |
| CA9 | Exportar e importar pedem senha recente, não funcionam no bloqueio nem com token remoto, e geram alerta de segurança | regra 7 |
| CA10 | Configurações › Dados mostra o uso por tipo contra o limite e o tamanho do banco contra 900 MB | etapa ("limites de armazenamento") |
| CA11 (23b) | Backup diário pelo alarme, gzip + cifra com a chave pública do dono, upload em partes ao R2, 7 cópias, apaga as antigas só depois do upload confirmado; 8º apaga o 1º; falha no upload não apaga nada; nome do objeto sem dado pessoal; operações do R2 dentro do grátis | prompt da etapa |
| CA12 (23b) | Sem `BACKUP_BUCKET` o automático fica desligado e a tela diz isso | especificação |
| CA13 (23b) | A primeira cópia cifrada de cada mês vai como documento só ao chat de `TELEGRAM_ADMIN_ID` (até 40 MB); acima, só o aviso com o link | decisão 02/11/2026 |
| CA14 (23b) | O bot avisa quando o último backup baixado tem mais de 30 dias e `/backup` diz a idade do último | especificação |
| CA15 (23b) | Restaurar abre o arquivo no navegador com a chave privada, que nunca vai ao servidor nem ao R2 | especificação |

## 4. Escopo

**Entra (23a):** formato v1 em `packages/shared/src/backup.ts`, exportação em
fluxo (sem montar o arquivo inteiro na memória), importação tudo ou nada,
cartões **Uso do armazenamento** e **Exportar e importar** em Configurações ›
Dados, alertas `backup_exported` e `backup_imported`, documentação
`docs/backup.md`.

**Entra (23b):** chave do dono, backup automático no R2, lista e download das
cópias, restauração do arquivo cifrado no navegador (em partes quando passa de
10 MB), envio mensal pelo Telegram, aviso de 30 dias, `/backup` com a idade.

**Fica fora (e onde vai parar):**

- Fluxos, conexões e servidores MCP → não entram no formato v1: são
  integrações com endereço e credencial de terceiros, e a regra 8 manda nunca
  religar MCP por importação. Depois de restaurar, o dono cadastra de novo
  (como o Google e o Telegram). Um arquivo com `mcp` ou `flows` é recusado.
- Histórico de execuções, avisos, uso de IA, atividade e diagnóstico → dados
  de operação, não do dono; recomeçam vazios.
- Tarefas, notas e projetos na lixeira → não vão (a lixeira é de 30 dias).
- Exportar o CRM em CSV → não faremos agora (o backup leva o CRM inteiro).
- A "camada do dono" do prompt (guardrails parte 2) → entra no formato quando
  aquela PR existir, como versão 2 (a importação aceita v1 para sempre).

## 5. Como funciona para o Pablo

### Fluxo 1 · Exportar (23a)

1. Configurações › Dados › **Exportar e importar** › **Baixar backup**.
2. Sem senha digitada nos últimos 15 min, abre o pedido de senha de sempre.
3. O navegador baixa `zuri-backup-AAAA-MM-DD.json`; o cartão diz que o
   arquivo não é cifrado e deve ficar num lugar seguro.
4. Chega o alerta de segurança "Backup baixado" em todos os canais.

### Fluxo 2 · Importar (23a)

1. **Importar backup** abre a escolha de arquivo (`.json`, até 10 MB).
2. Arquivo maior que 10 MB: o navegador já recusa, sem enviar.
3. Confirmação: "Os itens do arquivo entram como novos, ao lado dos que já
   existem. Automações chegam pausadas e rotinas com IA esperam a sua
   aprovação." Botões **Importar** e **Cancelar** (foco em Cancelar).
4. Sucesso: toast com o resumo ("Importados: 12 tarefas, 3 notas…").
   Recusa: o erro diz o motivo (arquivo inválido, limite de um tipo, banco
   cheio) e que nada foi gravado.
5. Chega o alerta de segurança "Backup importado".

### Fluxo 3 · Uso do armazenamento (23a)

Cartão no topo de Dados: uma barra por tipo (tarefas, notas, projetos,
memórias, conversas, mensagens, automações, clientes) com "n de limite" e uma
barra do banco ("12 MB de 900 MB"). Em 80% a barra muda de cor e o texto diz
"Perto do limite". Carregando: esqueleto; erro: aviso com **Tentar de novo**.

Estados, teclado e leitor de tela: botões com rótulo, barras como
`role="meter"` com `aria-valuenow/max`, diálogo com foco preso, tudo no tema
escuro e no celular. A aba Dados já está na paleta Ctrl/⌘ K.

### Fluxo 4 · Backup automático e restauração (23b)

1. Cartão **Backup automático**: sem `BACKUP_BUCKET`, "Desligado: o espaço de
   backups não foi configurado na instalação" e o link do guia.
2. Com o espaço: **Criar chave do backup** (senha recente). O navegador gera
   o par de chaves, baixa `zuri-chave-do-backup.json` uma única vez e manda só
   a chave pública. Aviso: sem esse arquivo nenhum backup abre.
3. Todo dia, depois das 3 h no fuso do dono, sai uma cópia. O cartão lista as
   7 cópias (data e tamanho) com **Baixar** e mostra a última falha.
4. **Restaurar** pede o arquivo `.zuri` e a chave; o navegador abre, mostra o
   resumo e importa (em partes quando passa de 10 MB).
5. A primeira cópia de cada mês vai como documento ao privado do bot (até
   40 MB); acima disso, só o aviso com o link da tela. Se o Telegram falhar,
   a cópia do dia seguinte tenta de novo.
6. Último backup baixado (tela ou Telegram) há mais de 30 dias: aviso no bot.

### Textos visíveis (23a)

| Chave | pt-BR | en | Onde aparece |
| --- | --- | --- | --- |
| `web.backup.storage.title` | Uso do armazenamento | Storage use | cartão |
| `web.backup.storage.database` | Banco de dados | Database | cartão |
| `web.backup.storage.of` | {n} de {limit} | {n} of {limit} | barras |
| `web.backup.storage.near` | Perto do limite | Close to the limit | barra em 80% |
| `web.backup.export.title` | Exportar e importar | Export and import | cartão |
| `web.backup.export.body` | O arquivo leva tarefas, notas, projetos, memórias, conversas, automações, clientes e configurações. Senhas, chaves e conexões ficam de fora. Ele não é cifrado: guarde num lugar seguro. | … | cartão |
| `web.backup.export.action` | Baixar backup | Download backup | botão |
| `web.backup.import.action` | Importar backup | Import backup | botão |
| `web.backup.import.confirm` | Os itens do arquivo entram como novos, ao lado dos que já existem. Automações chegam pausadas e rotinas com IA esperam a sua aprovação. | … | diálogo |
| `web.backup.import.done` | Importados: {summary}. | Imported: {summary}. | toast |
| `web.backup.import.tooLarge` | O arquivo passa de 10 MB. | The file is over 10 MB. | erro |
| `error.backup.invalid` | Este arquivo não é um backup válido da Zuri. Nada foi gravado. | … | erro da API |
| `error.backup.newer` | Este backup veio de uma versão mais nova da Zuri. Atualize antes de importar. | … | erro da API |
| `notice.security.backup_exported.*` | Backup baixado / Alguém baixou um backup com todos os seus dados. Se não foi você, troque a senha e encerre as sessões. | … | alerta |
| `notice.security.backup_imported.*` | Backup importado / Um backup foi importado. Automações chegaram pausadas. Se não foi você, troque a senha e confira os dados. | … | alerta |

Textos finais no catálogo, depois da passada do humanizer.

## 6. Regras de negócio e limites

| Regra | Valor | No limite | Erro |
| --- | --- | --- | --- |
| Tamanho do arquivo importado | 10 MB (10.485.760 bytes) | 10 MB entra; 1 byte a mais é recusado no Worker, antes do objeto | 400 `VALIDATION_FAILED` ("corpo grande demais") |
| Registros por tipo no arquivo | os de `STORAGE_LIMITS` (memórias 10.000, tarefas 20.000, notas 5.000, projetos 1.000, conversas 5.000, mensagens 200.000, automações 500) e `CRM_LIMITS.clients` 5.000 | 10.000 memórias passam no schema; 10.001 recusa o arquivo | `VALIDATION_FAILED` |
| Existentes + importados por tipo | os mesmos limites | passou: desfaz tudo | 507 `STORAGE_LIMIT_REACHED` |
| Teto do banco | 900 MB | conferido depois de gravar, dentro da transação | 507 |
| Campos | schema estrito, campos dos schemas de criação (títulos, textos, datas ISO, enums) | campo desconhecido (`mcp`, `enabled`, `aiModel`…) recusa o arquivo | `VALIDATION_FAILED` |
| Automação | `paused: true` obrigatório | `paused: false` recusa o arquivo | `VALIDATION_FAILED` |
| Rotina com IA | chega `pending_approval` | aprovar segue a regra de sempre (senha se houver MCP em rotinas) | — |
| Versão | `version` 1 | 2 ou mais: "versão mais nova" | `VALIDATION_FAILED` |
| Referências | projeto, conversa, memória substituta e etapa do funil apontam para itens do mesmo arquivo | referência a id ausente vira `null` (projeto, substituta) ou recusa (mensagem sem conversa não existe: elas vão aninhadas) | — |
| Ciclo de substituição de memórias | proibido | ligação que fecharia ciclo fica `null` | — |
| Cliente com `ref` já existente | é o mesmo cliente do n8n | não importa esse cliente (conta como já existente) | — |
| Etapas do funil | casadas por nome com as atuais; nome novo cria etapa até 12 | sem lugar, vai para a primeira etapa | — |
| Etiquetas do CRM | 20 por cliente, 200 distintas | passou de 200 distintas: desfaz tudo | 507 |
| Erros devolvidos | até 20 caminhos de campo | — | — |
| Concorrência | importação inteira numa transação síncrona do objeto | outra escrita espera | — |

## 7. Desenho técnico

### Arquivos (23a)

| Arquivo | Cria ou muda | Para quê |
| --- | --- | --- |
| `packages/shared/src/backup.ts` | cria | formato v1 (Zod estrito), limites, tipos do resumo e do uso |
| `apps/agent/src/backup/export.ts` | cria | gerador síncrono que lê em páginas de 500 linhas e devolve o JSON em pedaços |
| `apps/agent/src/backup/import.ts` | cria | importação tudo ou nada com ids novos |
| `apps/agent/src/api/backup.ts` | cria | rotas `/api/storage`, `/api/backup/export`, `/api/backup/import` |
| `apps/agent/src/gates/body.ts` | muda | teto de 10 MB só para `/api/backup/import` |
| `apps/agent/src/api/app.ts`, `agent/zuri-agent.ts` | muda | registrar as rotas e os serviços |
| `packages/shared/src/alerts.ts`, `auth-activity.ts`, `alerts/service.ts`, `components/security/activity.ts` | muda | eventos `backup_exported` e `backup_imported` |
| `apps/web/src/pages/settings/DataTab.tsx` | muda | carrega os cartões novos sob demanda |
| `apps/web/src/pages/settings/BackupCards.tsx` | cria | uso do armazenamento, exportar e importar |
| `packages/shared/i18n/pt-BR-backup.ts`, `en.ts`, `pt-BR-server.ts` | cria/muda | textos |
| `docs/backup.md` | cria | formato, o que entra e o que não entra, como ler fora da Cloudflare |

### Rotas e contratos

- `GET /api/storage` (sessão + CSRF): `{ kinds: [{ kind, count, limit }], bytes, maxBytes }`; lê só `zur_counts` (uma linha por tipo) e `databaseSize`.
- `GET /api/backup/export` (sessão + CSRF + senha recente): 200 `application/json`, `Content-Disposition: attachment; filename="zuri-backup-AAAA-MM-DD.json"`, `Cache-Control: no-store`, corpo em fluxo. Alerta `backup_exported`.
- `POST /api/backup/import` (sessão + CSRF + senha recente, corpo até 10 MB): 200 `{ summary }`; 400 `VALIDATION_FAILED` (`details.fields` até 20); 507 `STORAGE_LIMIT_REACHED`. Alerta `backup_imported`.
- As três ficam fora de `WHILE_LOCKDOWN` (423) e fora da lista dos tokens remotos.

### Banco

Sem migration. A exportação lê por `rowid` em páginas de 500 (índice da
chave primária); as mensagens de cada conversa pelo índice
`zur_messages_conversation`. A importação grava com os mesmos `INSERT` dos
serviços, então gatilhos de contagem, FTS e versões de área seguem sozinhos.

### Ferramentas do agente

Nenhuma: o agente não exporta nem importa nada.

### Agendamentos, IA e integrações externas

23a: nenhum. 23b: o backup diário roda no alarme único das automações, num
despertar só dele, e conta no contador único de subrequisições (as chamadas
ao R2 pelo binding contam nos 50 por invocação do plano Free).

### Desenho da 23b (para a próxima PR)

- **Chave:** ECDH P-256 gerada no navegador (`crypto.subtle`). O arquivo
  baixado leva a chave privada em JWK e um id curto (SHA-256 da pública). O
  servidor guarda só a pública e o id (chave interna `backup_public_key`).
- **Arquivo `.zuri`:** cabeçalho em texto (`ZURI-BACKUP 1`, id da chave,
  chave pública efêmera, sal) e pedaços de 1 MiB do JSON compactado com gzip,
  cada um cifrado com AES-256-GCM. A chave do arquivo vem de HKDF-SHA256 sobre
  o segredo ECDH; o nonce é contado por pedaço e o último pedaço é marcado no
  dado associado (truncar o arquivo é detectado). Lido com Web Crypto e
  `DecompressionStream`, presentes em navegadores, Node 18+ e Deno: nada da
  Cloudflare.
- **Upload:** até 8 MiB, um `put`; acima, `createMultipartUpload` com partes
  de 8 MiB (mínimo do R2: 5 MiB, todas iguais menos a última), `complete` e
  só então a limpeza. Falha: `abort` e nada é apagado.
- **Nome do objeto:** `zuri/AAAA-MM-DD-<8 hex aleatórios>.zuri`, sem dado
  pessoal; lista pelo prefixo e mantém as 7 mais novas.
- **Telegram:** `sendDocument` multipart com o objeto lido do R2, só no chat
  privado vinculado e igual a `TELEGRAM_ADMIN_ID`; acima de 40 MB (folga
  abaixo dos 50 MB da Bot API e da memória do alarme), só o aviso.

## 8. Custo e cotas do plano Free

| Recurso | Uso típico | Pior caso | Folga | Fonte |
| --- | --- | --- | --- | --- |
| Pedidos | 1 exportação ou importação de vez em quando | — | sobra | `docs/arquitetura/orcamento-free-tier.md` |
| Linhas lidas (exportação) | uma por registro + uma por página | 245.000 (tudo no limite) | 5 milhões/dia | idem |
| Linhas escritas (importação) | uma por registro + índices e gatilhos (~4) | ~1 milhão no pior arquivo de 10 MB | 100.000/dia: um arquivo enorme pode passar da cota do dia; acontece uma vez e o dono escolheu importar | idem |
| Memória (exportação) | uma página de 500 linhas | uma nota de 200 KB por vez | 128 MB | limites dos Workers |
| Memória (importação) | o arquivo e o objeto do JSON | 10 MB de texto ≈ 40 MB em objetos | 128 MB | idem |
| R2 (23b) ⚠ aprovado | ~5 operações Classe A por dia, 1 Classe B por download | 7 cópias de até ~100 MB = 0,7 GB | 10 GB, 1 milhão Classe A, 10 milhões Classe B por mês; apagar é grátis | developers.cloudflare.com/r2/pricing |
| JS inicial | cartões novos sob demanda | — | teto 139.600 B | `scripts` do bundle |

## 9. Segurança e privacidade

| Ameaça | Defesa | Teste |
| --- | --- | --- |
| Sessão roubada baixa todos os dados | senha recente, alerta `backup_exported`, 423 no bloqueio, token remoto não alcança | `backup-routes.test.ts` |
| Arquivo forjado liga rotina com IA, MCP ou modelo pago | schema estrito; `paused: true`; rotina com IA em `pending_approval`; configurações em lista fechada sem IA, sessão ou nome do agente | `backup-import.test.ts` |
| Arquivo enorme derruba o objeto | 10 MB no Worker, antes do objeto; limites por tipo no schema | idem |
| Texto com controle, surrogate solto ou injeção | mesmos `line`/`text` dos schemas de criação; o conteúdo continua dado (`<data>`) | idem |
| Datas no futuro para "ganhar" comparações | ids novos, sem comparação de datas; datas validadas como ISO | idem |
| Segredo no arquivo | lista positiva de colunas e configurações; teste procura no arquivo valores de TOTP, passkey, sessão, token, credencial e chaves internas | `backup-export.test.ts` |
| Importação pela metade | uma transação; erro no meio desfaz tudo | idem |
| Mensagem importada virar fala do dono | `source = 'import'`, sem ferramentas nem propostas | idem |

Seções relidas: "Backup é entrada não confiável", "Passo extra para o
sensível", "Conteúdo guardado é dado". Auditoria em modo orientação na 23a;
na 23b (cifra e R2) com o `revisor-cloudflare`.

## 10. Testes

| CA | Teste | Camada | Arquivo |
| --- | --- | --- | --- |
| CA1, CA2 | exporta e confere formato, versão, `schema` = última migration e as seções | integração | `apps/agent/test/backup-export.test.ts` |
| CA3 | nenhum segredo nem tabela proibida no arquivo | segurança | idem |
| CA4, CA5 | ida e volta num banco vazio, comparando sem os ids | integração | `apps/agent/test/backup-import.test.ts` |
| CA6 | automação ligada, `mcp`, 11 MB, 10.001 memórias, campo desconhecido: recusa e banco igual | segurança | idem + `backup-routes.test.ts` |
| CA7 | rotina com IA chega esperando aprovação; configurações de IA recusadas | segurança | idem |
| CA8 | ids novos; importar duas vezes duplica; limite por tipo e teto desfazem tudo | integração | idem |
| CA9 | sem senha recente 403, bloqueio 423, token 403, alertas | contrato | `backup-routes.test.ts` |
| CA10 | `/api/storage` e o cartão | contrato + e2e + axe | `backup-routes.test.ts`, `tests/e2e/backup.spec.ts` |
| CA11–CA15 | na 23b | — | — |

Também: orçamento de linhas de `/api/storage` em `free-tier-budget.test.ts`.

## 11. Entrega

- **Ordem:** 23a (esta PR) → 23b.
- **Capturas:** Configurações › Dados (computador e celular, claro e escuro).
- **Docs:** `docs/backup.md`; README ("O que já funciona").
- **Changelog:** `changelog/nao-lancado/backup-exportar-importar.md` (23a) e o da 23b com `<!-- versao: minor -->`.
- **Instalação:** 23a nada novo; 23b binding `BACKUP_BUCKET` ⚠ opcional.
- **Portabilidade:** o arquivo é JSON puro (23a) ou gzip + Web Crypto padrão (23b); `docs/backup.md` traz como abrir com Node.

## 12. Riscos

| Risco | Chance | Impacto | O que fazemos |
| --- | --- | --- | --- |
| Backup completo passa de 10 MB (muitas conversas) | média em meses | não importa de uma vez | a 23b restaura em partes (dados + lotes de conversas, cada lote tudo ou nada); a 23a avisa o tamanho |
| Escrita grande passa da cota diária de linhas | baixa | o banco recusa escritas até 00:00 UTC | documentado; a importação é rara e pedida pelo dono |
| Mudança de schema futura quebra o formato | média | arquivo velho não entra | `version` no arquivo e importação aceita sempre a v1 |

## 13. Suposições

- Fluxos, conexões e MCP fora do formato v1 (ver Escopo).
- Ids novos em tudo, como manda o contrato; importar duas vezes duplica.
- Clientes com `ref` igual a um existente não são importados.
- Exportação sem cifra é escolha consciente do dono (o cartão avisa); a
  cifra é do backup automático.
- Sem migration: o estado do automático cabe em chaves internas.

## 14. Entrevista com o Pablo

| Data | Pergunta | Resposta |
| --- | --- | --- |
| — | Nenhuma: R2, cópias, exclusões e `local_only` já decididos (decisoes.md, 02/11 e 04/11/2026; instruções desta thread) | — |

### Perguntas abertas

- Nenhuma.
