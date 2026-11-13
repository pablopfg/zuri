# Plano · A Zuri dentro do Chatwoot, só para o Pablo

Situação: opção A aprovada pelo Pablo em 13/11/2026, 02:10 UTC, com configuração automática; protótipo esperando aprovação
Origem: pedido do Pablo em 13/11/2026, 01:56 UTC
Dependências: S17 (cofre de credenciais no servidor, `docs/planos/implementacao-frontend-sinal.md`), onde entra um tipo novo de credencial para este canal. Não depende do envio de pedido de avaliação.

## 1. Resumo

O Pablo quer conversar com a Zuri de dentro do Chatwoot, como já conversa pelo Telegram, e a Zuri não pode responder a mais ninguém: nem paciente, nem outro atendente. Dá para fazer no plano gratuito. O jeito mais seguro é uma **caixa de entrada própria, do tipo API, chamada "Zuri"**, onde só existe uma conversa (a do Pablo com a Zuri), em vez de colocar a Zuri na caixa do WhatsApp dos pacientes. Toda mensagem que chega do Chatwoot é tratada como campainha: a Zuri confere a assinatura, busca a mensagem de novo pela API do Chatwoot e só responde quando o autor é a conta do Pablo nessa conversa. Isso abre uma porta nova de fora para dentro e muda duas decisões fechadas; o Pablo aprovou em 13/11 e pediu que a Zuri configure tudo sozinha, com área de configuração e teste no menu.

## 2. Contexto no sistema

| O que já existe | Onde | Uso aqui |
| --- | --- | --- |
| Bot do Telegram de dono único: webhook com segredo no cabeçalho, conta do vínculo, chat privado, estranho não grava nada nem recebe resposta | `apps/agent/src/telegram/`, `docs/seguranca.md` (Bot do Telegram) | Modelo de canal do dono que este plano copia |
| Conversa do agente com ferramentas, confirmações e propostas destrutivas | `apps/agent/src/telegram/conversation.ts`, `channel.ts`, `confirmations.ts` | O Chatwoot vira mais um canal da mesma conversa |
| Plano do envio de pedido de avaliação pelo Chatwoot: credencial cifrada `chatwoot-v1`, caminhos fixos, retorno `/api/chatwoot/events/:key` com `X-Chatwoot-Signature` (HMAC-SHA256 de `timestamp.corpo`), `X-Chatwoot-Timestamp` e `X-Chatwoot-Delivery` | [envio-chatwoot-pela-zuri.md](envio-chatwoot-pela-zuri.md), seção 7 | Mesma conferência de assinatura e mesma regra "o aviso é só sinal, confere pela API" |
| Sem acesso externo por API ou token: `Authorization` recebe 401 | `docs/seguranca.md` | Continua igual: o Chatwoot não ganha token da Zuri, só um endereço de retorno assinado |
| Modo de bloqueio | `auth.lockdown` | Canal fica mudo durante o bloqueio |
| Conteúdo de terceiros entra como dado | regra 4 do `AGENTS.md`, blocos `<data>` | Vale para tudo que vier do Chatwoot |

Decisões que este pedido toca (em `.claude/memoria/decisoes.md` e na especificação):

1. A especificação põe "WhatsApp, Chatwoot ou atendimento a terceiros" fora do escopo; o Pablo já abriu exceções para pedido de avaliação e confirmação de consulta. Conversar com a Zuri pelo Chatwoot é uma exceção nova.
2. Telegram só do admin, em privado, é hoje o único canal do dono fora do app.

## 3. Objetivo e critérios de aceite

- O Pablo escreve na conversa "Zuri" do Chatwoot e recebe a resposta ali, com as mesmas ferramentas e travas do Telegram.
- Mensagem de qualquer outra pessoa (outro atendente, administrador, paciente, contato novo) não recebe resposta, não chega ao modelo de IA e não grava nada além de um contador.
- Um corpo forjado (assinatura errada, timestamp velho, entrega repetida, conversa ou caixa diferente) é recusado antes de acordar o Durable Object.
- Mesmo com assinatura válida, a Zuri só age sobre a mensagem que ela mesma buscou pela API do Chatwoot.
- A Zuri nunca escreve em outra caixa ou conversa por este canal: as chamadas de envio têm caixa e conversa fixas no código.
- Ação destrutiva nunca é aprovada pelo Chatwoot; vira proposta no app ou no Telegram.
- Um botão desliga o canal na hora; o modo de bloqueio o deixa mudo.

## 4. Escopo

Entra: caixa "Zuri" no Chatwoot, vínculo com a conta de atendente do Pablo, endereço de retorno assinado, resposta da Zuri na mesma conversa, configuração automática e teste em Configurações › Chatwoot.

Fica de fora: a Zuri ler ou responder conversas de pacientes, notas privadas nas conversas dos pacientes (opção C, só se o Pablo pedir depois), grupos, anexos e áudio na primeira entrega, aprovação de ação destrutiva pelo Chatwoot.

## 5. Como funciona para o Pablo

### Fluxo 1 · Configurar (automático)

Pedido do Pablo (13/11, 02:10 UTC): a Zuri cria tudo sozinha. Fica em **Configurações › Chatwoot**, página própria no grupo Conexões, com um atalho em Integrações.

1. O Pablo toca em **Configurar** e informa o endereço do Chatwoot, o número da conta e a **chave de acesso dele** (Perfil › Chave de acesso). A chave precisa ser de administrador. Confirma com a senha da Zuri.
2. A Zuri pergunta ao Chatwoot quem é o dono da chave e mostra "Esta conta é você?" com nome, e-mail e número do atendente. O vínculo fica preso a esse número.
3. A Zuri cria a caixa "Zuri", deixa só o Pablo como membro, cria o contato "Zuri" e a conversa, manda um código de 8 caracteres e descarta a chave de administrador. Cada passo aparece na tela. Se um falhar, ela desfaz o que criou (apaga a caixa) e mostra onde parou.
4. O Pablo responde o código na conversa "Zuri" com a própria conta. O código vale 10 minutos e dá para pedir outro.
5. No app, **Confirmar esta conta**, com a senha. A partir daí a Zuri responde.

### Fluxo 1b · Testar a configuração

Botão **Testar configuração**, sem pedir chave nenhuma: Chatwoot responde por https sem redirecionamento; a caixa existe; um pedido sem o HMAC do contato é recusado (prova que a HMAC está obrigatória); contato e conversa existem; a Zuri manda "Teste da configuração" e confere a assinatura do aviso que volta, em até 30 s.

**Teste completo** pede a chave de administrador de novo, só para essa hora, e confere também: o endereço de retorno da caixa continua o da Zuri, os membros são só o Pablo, o Pablo continua administrador, e quem mais é administrador (esses veem todas as caixas; a tela lista os nomes).

Falha na assinatura ou no HMAC pausa o canal e aponta **Trocar os segredos**, que pede a chave de administrador, gera segredo e HMAC novos no Chatwoot e roda o teste de novo.

### Fluxo 2 · Dia a dia

O Pablo abre a conversa "Zuri" no Chatwoot e escreve como escreveria no Telegram. A resposta chega na mesma conversa, como mensagem do contato "Zuri". Se a Zuri propõe algo destrutivo, a resposta diz "Aprove no app ou no Telegram" e traz o link do app.

### Fluxo 3 · Alguém mais escreve

Se outro atendente escrever na conversa "Zuri" (um administrador do Chatwoot enxerga todas as caixas), a Zuri não responde nada ali. O Pablo recebe um aviso no app e no Telegram: "Alguém que não é você escreveu na conversa Zuri do Chatwoot", sem o texto. Três avisos em 24 h desligam o canal sozinho até o Pablo religar.

### Fluxo 4 · Quando algo some ou muda (pergunta do Pablo, 13/11, 02:36 UTC)

| Situação | Como a Zuri percebe | O que ela faz | Chave de administrador? |
| --- | --- | --- | --- |
| Conversa "Zuri" apagada | 404 ao escrever ou ler a conversa | Abre uma conversa nova pelo mesmo contato (API pública), grava o novo id e avisa no app e no Telegram. Continua só com o id do atendente do Pablo | Não |
| Contato "Zuri" apagado | 404 no contato | Cria contato e conversa de novo (`identifier` e `identifier_hash` novos) e avisa | Não |
| Caixa "Zuri" apagada | 404 na caixa | Pausa o canal e mostra **Reparar**, que refaz a caixa e o resto | Sim, uma vez |
| Segredo ou HMAC trocados no Chatwoot | Assinatura não bate ou 401 da API pública | Pausa o canal e mostra **Trocar os segredos** | Sim, uma vez |
| Endereço do Chatwoot ou da Zuri mudou | Teste falha ou o retorno deixa de chegar | **Reparar** atualiza o endereço do Chatwoot na Zuri e o `webhook_url` da caixa | Sim, uma vez |
| Pablo trocou de conta de atendente | O autor das mensagens deixa de bater | Nada responde à conta nova até **Vincular outra conta**: código novo na conversa, respondido pela conta nova, confirmado com a senha da Zuri | Não |
| Pablo trocou o número do celular | Não afeta | A caixa "Zuri" é de API e o Pablo fala pelo Chatwoot logado | Não |

A recriação automática só acontece dentro da caixa do vínculo e no máximo 3 vezes por dia; depois disso o canal pausa e pede **Reparar**, para um apagar repetido não virar laço.

### Textos visíveis

Ficam no catálogo de i18n (pt-BR e en) quando houver código; as palavras finais saem do protótipo, que vem antes, pela regra de 12/11.

## 6. Regras de negócio e limites

| Regra | Valor |
| --- | --- |
| Conversas atendidas | 1 (a conversa criada no vínculo) |
| Autor aceito | `sender.type = "user"` com o id da conta do Pablo gravado no vínculo, numa mensagem `outgoing`, não privada, na caixa e conversa do vínculo |
| Tamanho da mensagem | Até 8.000 caracteres (`CHAT_MESSAGE_MAX`); acima, resposta fixa pedindo para dividir |
| Corpo do retorno | Até 64 KB (como o Telegram) |
| Janela do timestamp | 5 minutos; `X-Chatwoot-Delivery` visto uma vez só (últimos 100) |
| Mensagens por hora | 60, iguais ao Telegram |
| Estranho na conversa | Sem resposta; 3 em 24 h desligam o canal |
| Ação destrutiva | Nunca aprovada pelo Chatwoot |
| Código de vínculo | 8 caracteres sem 0/O/1/I, 10 minutos, um por vez, guardado só como HMAC; 10 erros em 10 min apagam o código |
| Chave de administrador | Só no pedido; nunca gravada, nunca em log |
| Bloqueio | Canal mudo, nada sai |

## 7. Desenho técnico

### As três opções que o Chatwoot oferece

| | A. Caixa API "Zuri" (recomendada) | B. Agent Bot na caixa do WhatsApp | C. Notas privadas com "@Zuri" nas conversas |
| --- | --- | --- | --- |
| Como funciona | Caixa só da Zuri; o Pablo é atendente, a Zuri é o "contato". O Chatwoot manda ao "Webhook URL" da caixa cada mensagem que o atendente envia | Bot ligado à caixa dos pacientes recebe todo evento dela | Webhook da conta recebe toda mensagem de todas as caixas; a Zuri responde só a nota do Pablo que a cita |
| O que a Zuri enxerga | Só a conversa dela | Todas as conversas de pacientes | Todas as conversas de pacientes |
| Risco para pacientes | Nenhum: ela não tem caminho para escrever a eles por aqui | Alto: o bot assume as conversas novas (fica "pendente" com o bot) e qualquer erro de filtro responde a paciente | Médio: dado de saúde de paciente vai para o modelo; nota privada é editável por qualquer atendente |
| Injeção | Só o Pablo escreve | Qualquer paciente escreve | Paciente escreve no histórico que o Pablo pede para ler |
| Utilidade | Igual ao Telegram, dentro do Chatwoot | Nenhuma além de A, com muito mais risco | Maior (resumir a conversa de um paciente), mas é outro produto |

B fica descartada. C só entra se o Pablo pedir depois, em plano próprio, porque leva dados de pacientes ao modelo e precisa de regra de privacidade.

### Conferências, em ordem (opção A)

No Worker, antes do objeto:

1. POST, `Content-Type` JSON, corpo até 64 KB, chave aleatória certa no caminho (`/api/chatwoot/owner/:key`, 32 bytes, comparada em tempo constante).
2. `X-Chatwoot-Signature` = `sha256=` + HMAC-SHA256(segredo, `timestamp + "." + corpo cru`), comparado em tempo constante; timestamp dentro de 5 min. Sem assinatura: 403. Assim já está desenhado no plano do pedido de avaliação.

No objeto:

3. `X-Chatwoot-Delivery` novo; evento `message_created`; `inbox.id` e `conversation.id` iguais aos do vínculo; `message_type = outgoing`, `private = false`. Qualquer diferença: 200 sem gravar nada (o Chatwoot não precisa saber por quê).
4. **Busca de volta:** `GET /public/api/v1/inboxes/{inbox_identifier}/contacts/{source_id}/conversations/{display_id}/messages` com o `identifier_hash` e pega a mensagem pelo id. Só o que voltou dessa busca é usado; o corpo do retorno é descartado. Um corpo forjado com segredo vazado ainda não consegue inventar texto, porque o texto vem do Chatwoot.
5. Autor da mensagem buscada = id da conta do Pablo do vínculo. Senão, conta como estranho (fluxo 3).
6. Modo de bloqueio, teto por hora, canal ligado.
7. Texto entra na conversa do agente como mensagem do dono (é o próprio Pablo), e qualquer coisa que o agente leia por ferramenta continua indo em `<data>`.

### Chamadas ao Chatwoot, conferidas no código-fonte

Conferidas em 13/11/2026 no código do Chatwoot (`chatwoot/chatwoot`, branch `develop`). O "Teste completo" confere de novo na versão instalada do Pablo.

| Passo | Chamada | Chave | Fonte |
| --- | --- | --- | --- |
| Quem é o dono da chave | `GET /api/v1/profile` → `id`, `name`, `email`, `accounts[].role` | administrador | `config/routes.rb` (`resource :profile`), `app/views/api/v1/models/_user.json.jbuilder` |
| Criar a caixa | `POST /api/v1/accounts/{conta}/inboxes` com `name: "Zuri"`, `channel: { type: "api", webhook_url, hmac_mandatory: true }` → `id`, `inbox_identifier`, `secret`, `hmac_token` (os dois últimos só voltam para administrador) | administrador | `InboxPolicy#create?`, `Channel::Api::EDITABLE_ATTRS`, `_inbox.json.jbuilder` |
| Só o Pablo na caixa | `PATCH /api/v1/accounts/{conta}/inbox_members` com `inbox_id` e `user_ids: [id do Pablo]` (a lista enviada vira a lista exata) | administrador | `InboxMembersController#update` |
| Criar o contato "Zuri" | `POST /public/api/v1/inboxes/{inbox_identifier}/contacts` com `identifier` aleatório, `identifier_hash` = HMAC-SHA256(`hmac_token`, `identifier`) e `name: "Zuri"` → `source_id` | nenhuma (API pública) | `Public::Api::V1::Inboxes::ContactsController#create` |
| Criar a conversa | `POST /public/api/v1/inboxes/{inbox_identifier}/contacts/{source_id}/conversations` | nenhuma + `identifier_hash` | `Public::Api::V1::InboxesController#ensure_hmac_verified` |
| A Zuri escreve | `POST …/conversations/{display_id}/messages` com `content` (sai como mensagem do contato) | nenhuma + `identifier_hash` | `Public::Api::V1::Inboxes::MessagesController#create` |
| Busca de volta | `GET …/conversations/{display_id}/messages` → últimas 20, sem notas privadas nem atividade, com `sender.id` e `sender.type` | nenhuma + `identifier_hash` | `MessageFinder` (`filter_internal_messages`), `public/api/v1/models/_message.json.jbuilder` |
| Trocar segredos | `POST /api/v1/accounts/{conta}/inboxes/{id}/reset_secret` e `…/rotate_hmac_token` | administrador | `config/routes.rb`, `InboxPolicy#reset_secret?`, `#rotate_hmac_token?` |
| Desfazer na falha | `DELETE /api/v1/accounts/{conta}/inboxes/{id}` | administrador | `InboxPolicy#destroy?` |

O aviso que chega: o Chatwoot manda ao `webhook_url` da caixa de API os eventos `message_created`, `message_updated`, `conversation_*` e `typing`, com `X-Chatwoot-Signature: sha256=` + HMAC-SHA256(`secret` da caixa, `timestamp.corpo`), `X-Chatwoot-Timestamp` e `X-Chatwoot-Delivery` (`lib/webhooks/trigger.rb`, `WebhookListener#deliver_api_inbox_webhooks`). Ele espera 5 s pela resposta e não repete; se a Zuri não responder 2xx, a mensagem do Pablo aparece como "falhou" no Chatwoot. Por isso a Zuri responde 200 na hora e trata depois. As mensagens que a própria Zuri manda também geram aviso (`incoming`), e ela as ignora.

### O que cada chave do Chatwoot pode

| Chave | O que pode | Uso na Zuri |
| --- | --- | --- |
| De usuário **administrador** (a do Pablo) | Tudo na conta: cria e apaga caixas, muda membros, lê `secret` e `hmac_token` das caixas | Só na configuração, no teste completo e em "Trocar os segredos". Fica em memória durante o pedido e nunca é gravada |
| De usuário **atendente** | Só as caixas em que é membro (`InboxPolicy::Scope` → `assigned_inboxes`); não cria caixa nem muda membros; não vê `secret` nem `hmac_token` | Não serve para configurar. Se a chave colada for de atendente, a tela diz isso |
| De **Agent Bot** | Só `conversations` (show, create, update, toggle_status, toggle_priority, custom_attributes), `messages#create`, `assignments#create` e `labels` (`BOT_ACCESSIBLE_ENDPOINTS` em `access_token_auth_helper.rb`); não lista mensagens nem caixas | Não usada: não consegue fazer a busca de volta, e ligar um bot muda o estado das conversas da caixa |
| De **Platform App** (Super Admin da instalação) | Cria contas e usuários em toda a instalação | Nunca |
| **API pública** da caixa: `inbox_identifier` + `source_id` + `identifier_hash` | Só cria contato, conversa e mensagem como contato, e lê as mensagens não privadas da conversa desse contato, nesta caixa | É o que fica guardado. Com `hmac_mandatory`, sem o `hmac_token` não se lê nem se escreve na conversa |

Um detalhe que fica: quem tiver o `inbox_identifier` pode criar outros contatos na caixa "Zuri" pela API pública (criar contato não pede HMAC). Isso não chega a nada: a Zuri só lê a conversa do vínculo e só aceita mensagem `outgoing` do Pablo.

### Envio da resposta

Uma chamada só, pela API pública, com o caminho montado no código a partir do vínculo. Texto puro, sem formatação que o Chatwoot transforme em link ou menção (`disarmLinks`, como no Telegram). Sem redirecionamento, prazo de 10 s, sem rede privada (`mcp/guarded-fetch.ts`).

### Chaves e segredos

- Não existe atendente "Zuri" com chave guardada: a Zuri fala como o contato da caixa dela. A chave do pedido de avaliação (outra credencial) continua separada.
- Fica guardado, no cofre da S17, num tipo novo de credencial (`chatwoot-dono`): endereço, conta, id da caixa, `inbox_identifier`, `secret` da assinatura, `hmac_token`, `identifier` e `source_id` do contato, id e `display_id` da conversa, id do atendente do Pablo. Os quatro segredos ficam cifrados, fora do backup e nunca voltam ao navegador.
- A Zuri não ganha token de entrada: a regra "sem acesso externo por API" continua. O que entra é um retorno assinado, como o do Telegram e o do Google Agenda.

### Arquivos, rotas, banco e ferramentas

Ficam para o plano de implementação, depois do protótipo. Estimativa: uma migration (estado do vínculo e contadores; os segredos vão para o cofre da S17), `apps/agent/src/chatwoot/owner-setup.ts` (configuração e desfazer), `owner-channel.ts` (retorno e resposta, reaproveitando a conversa do Telegram), rotas `POST /api/chatwoot/owner/setup`, `/confirm`, `/test`, `/rotate`, `DELETE /api/chatwoot/owner` e o retorno `/api/chatwoot/owner/:key`, todas em `ROUTE_WORDS`; a configuração e o teste completo recebem a chave de administrador no corpo, que nunca é registrada em log nem gravada. Nenhuma ferramenta nova do agente.

## 8. Custo e cotas do plano Free

- Cloudflare: cada mensagem do Pablo custa 1 requisição ao Worker, 2 subrequisições ao Chatwoot (busca e resposta) e os Neurons da conversa, os mesmos do Telegram, dentro dos 9.000 por dia que a Zuri reserva. Nada novo é ligado: sem KV, D1, Queues ou plano pago.
- Chatwoot: self-hosted no servidor do Pablo, sem custo por mensagem. A caixa "Zuri" não passa pela ponte do WhatsApp, então não há risco de bloqueio do número.

## 9. Segurança e privacidade

| Ameaça | Defesa |
| --- | --- |
| Paciente ou atendente pedindo coisas à Zuri | Só a conversa do vínculo, só o autor do vínculo, conferido na mensagem buscada pela API |
| Retorno forjado ou repetido | Chave no caminho, assinatura HMAC em tempo constante, janela de 5 min, `X-Chatwoot-Delivery` uma vez só, busca de volta |
| Segredo de assinatura vazado | Busca de volta impede texto inventado; trocar o segredo na tela invalida o antigo |
| `inbox_identifier`, `source_id` e `hmac_token` vazados | Só escrevem e leem como o contato "Zuri" na caixa "Zuri"; nada das caixas de pacientes. "Trocar os segredos" gera `secret` e `hmac_token` novos |
| Chave de administrador do Pablo | Nunca gravada nem registrada em log; usada só no pedido da configuração, do teste completo e da troca de segredos; a tela sugere gerar outra no Chatwoot depois |
| Chave colada de outra pessoa | "Esta conta é você?" antes de criar qualquer coisa, e o código respondido pela mesma conta, confirmado com a senha da Zuri |
| Administrador do Chatwoot escrevendo na conversa | Autor diferente: sem resposta, aviso ao Pablo, 3 avisos desligam |
| Servidor do Chatwoot invadido | É o mesmo poder de quem invade o celular do Pablo no Telegram: ver as respostas. Por isso destrutiva nunca é aprovada por aqui, e o link do app continua pedindo login |
| Injeção por conteúdo lido | Tudo que o agente lê continua em `<data>`; a mensagem do Pablo é a única instrução |
| Resposta virar link ou menção no Chatwoot | Texto puro com `disarmLinks` |
| Respostas ficam guardadas no servidor do Chatwoot | É o servidor do Pablo; o cartão avisa que o histórico fica lá |

## 10. Testes

Quando houver código: unitário da assinatura (certa, errada, sem `sha256=`, timestamp no limite de 5 min, n−1/n/n+1), entrega repetida, autor diferente, caixa e conversa diferentes, mensagem privada, `incoming`; integração no workerd com um Chatwoot falso (busca de volta devolvendo outro texto, outro autor, 401, 5xx, redirecionamento recusado); bloqueio; teto por hora; e2e do cartão e do vínculo; teste de orçamento de subrequisições.

Configuração automática (pedido de 13/11), no workerd com o Chatwoot falso: chave de atendente recusada com a mensagem certa; chave inválida (401); endereço sem https, com caminho ou de rede privada recusado antes de chamar; cada passo da tabela falhando (timeout, 5xx, 422) desfaz o que já foi criado e não grava nada; resposta de criação sem `secret` ou `hmac_token` (versão antiga) para e explica; chave de administrador nunca aparece no banco, no log, no backup nem na resposta da rota (busca pelo valor em todo o estado depois do teste); configurar duas vezes não cria duas caixas; teste rápido com HMAC desligada no Chatwoot acusa falha; teste completo com outro membro na caixa acusa e lista; troca de segredos invalida a assinatura antiga. E2e da página Configurações › Chatwoot em todos os estados do protótipo, com axe, claro e escuro, computador e celular.

## 11. Entrega

1. Esta PR: plano e protótipo (Configurações › Chatwoot).
2. Com o protótipo aprovado: uma PR de código depois da S17, com Chatwoot falso no workerd cobrindo cada chamada da tabela acima, e um ensaio no Chatwoot do Pablo pelo "Teste completo".

## 12. Riscos

- A versão do Chatwoot pode mudar o formato da assinatura; a busca de volta segura o canal mesmo assim, e o teste de vínculo confere a assinatura antes de ligar.
- Administradores do Chatwoot sempre veem a conversa "Zuri" e as respostas dela. Se isso incomodar, a resposta é o Telegram.

## 13. Suposições

- S1: a versão instalada do Pablo se comporta como a `develop` do Chatwoot conferida em 13/11 (assinatura da caixa de API, `hmac_mandatory`, `secret` e `hmac_token` na resposta de criação). O "Teste completo" confere antes de ligar e recusa ligar se algo não bater.
- S2: o Pablo tem uma conta própria de administrador no Chatwoot, separada da dos outros atendentes.
- S3: a Zuri alcança o Chatwoot por https público, como no pedido de avaliação.

## 14. Entrevista com o Pablo

### Respostas

- 13/11/2026, 02:10 UTC: opção A, caixa própria "Zuri". Ações destrutivas continuam só no app e no Telegram; notas nas conversas de pacientes ficam para depois. Pedido a mais: a Zuri configura sozinha (caixa, contato e limite ao atendente do Pablo), com área de configuração e teste no menu, e a tela explica o limite de cada tipo de chave do Chatwoot.

### Perguntas abertas

Nenhuma. Falta aprovar o protótipo.
