# Plano · A Zuri dentro do Chatwoot, só para o Pablo

Situação: esperando o Pablo (estudo de viabilidade, sem código)
Origem: pedido do Pablo em 13/11/2026, 01:56 UTC
Dependências: integração Chatwoot da [envio-chatwoot-pela-zuri.md](envio-chatwoot-pela-zuri.md) (credencial cifrada, chamadas com caminho fixo, retorno assinado). Nada disso está no código ainda.

## 1. Resumo

O Pablo quer conversar com a Zuri de dentro do Chatwoot, como já conversa pelo Telegram, e a Zuri não pode responder a mais ninguém: nem paciente, nem outro atendente. Dá para fazer no plano gratuito. O jeito mais seguro é uma **caixa de entrada própria, do tipo API, chamada "Zuri"**, onde só existe uma conversa (a do Pablo com a Zuri), em vez de colocar a Zuri na caixa do WhatsApp dos pacientes. Toda mensagem que chega do Chatwoot é tratada como campainha: a Zuri confere a assinatura, busca a mensagem de novo pela API do Chatwoot e só responde quando o autor é a conta do Pablo nessa conversa. Isso abre uma porta nova de fora para dentro e muda duas decisões fechadas, então precisa do OK do Pablo antes de qualquer protótipo ou código.

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

Entra: caixa "Zuri" no Chatwoot, vínculo com a conta de atendente do Pablo, endereço de retorno assinado, resposta da Zuri na mesma conversa, cartão em Configurações › Integrações › Chatwoot.

Fica de fora: a Zuri ler ou responder conversas de pacientes, notas privadas nas conversas dos pacientes (opção C, só se o Pablo pedir depois), grupos, anexos e áudio na primeira entrega, aprovação de ação destrutiva pelo Chatwoot.

## 5. Como funciona para o Pablo

### Fluxo 1 · Ligar

1. No Chatwoot (uma vez): criar a caixa de entrada do tipo **API** chamada "Zuri", com só o Pablo como membro, e colar no campo "Webhook URL" o endereço que a Zuri mostra. Criar um atendente "Zuri" (papel atendente, não administrador), membro só dessa caixa, e copiar a chave de acesso dele.
2. Na Zuri, Configurações › Integrações › Chatwoot › **Conversar comigo pelo Chatwoot**: escolher a caixa "Zuri" na lista, colar a chave e o segredo de assinatura, confirmar com a senha.
3. A Zuri cria o contato "Zuri" e a conversa única, e manda um código de 8 caracteres nela. O Pablo responde com o código pela própria conta. A Zuri grava o id da conta de atendente que respondeu, igual ao vínculo do Telegram, e pede **Confirmar esta conta** no app, com senha recente.

### Fluxo 2 · Dia a dia

O Pablo abre a conversa "Zuri" no Chatwoot e escreve como escreveria no Telegram. A resposta chega na mesma conversa, como mensagem do contato "Zuri". Se a Zuri propõe algo destrutivo, a resposta diz "Aprove no app ou no Telegram" e traz o link do app.

### Fluxo 3 · Alguém mais escreve

Se outro atendente escrever na conversa "Zuri" (um administrador do Chatwoot enxerga todas as caixas), a Zuri não responde nada ali. O Pablo recebe um aviso no app e no Telegram: "Alguém que não é você escreveu na conversa Zuri do Chatwoot", sem o texto. Três avisos em 24 h desligam o canal sozinho até o Pablo religar.

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
4. **Busca de volta:** `GET /api/v1/accounts/{conta}/conversations/{conversa}/messages` com a chave do atendente "Zuri" e pega a mensagem pelo id. Só o que voltou dessa busca é usado; o corpo do retorno é descartado. Um corpo forjado com segredo vazado ainda não consegue inventar texto, porque o texto vem do Chatwoot.
5. Autor da mensagem buscada = id da conta do Pablo do vínculo. Senão, conta como estranho (fluxo 3).
6. Modo de bloqueio, teto por hora, canal ligado.
7. Texto entra na conversa do agente como mensagem do dono (é o próprio Pablo), e qualquer coisa que o agente leia por ferramenta continua indo em `<data>`.

### Envio da resposta

Uma chamada só, com caminho montado no código a partir dos ids do vínculo: mensagem `incoming` na conversa "Zuri" pela API da caixa (a caixa de API aceita mensagem do contato pela API do cliente, `/public/api/v1/inboxes/{identificador}/contacts/{contato}/conversations/{conversa}/messages`, ou pela API de aplicação com a chave do atendente; qual das duas funciona na versão do Pablo é suposição S1). Texto puro, sem formatação que o Chatwoot transforme em link ou menção (`disarmLinks`, como no Telegram). Sem redirecionamento, prazo de 10 s, sem rede privada (`mcp/guarded-fetch.ts`).

### Chaves e segredos

- A chave do atendente "Zuri" é **separada** da chave usada no pedido de avaliação: se uma vazar, a outra não escreve na caixa dos pacientes. O atendente "Zuri" é membro só da caixa "Zuri" e não é administrador.
- Chave, segredo de assinatura e identificador da caixa ficam cifrados no banco (`chatwoot-v1`), fora do backup e nunca no navegador; o cartão mostra só os 4 últimos caracteres.
- A Zuri não ganha token de entrada: a regra "sem acesso externo por API" continua. O que entra é um retorno assinado, como o do Telegram e o do Google Agenda.

### Arquivos, rotas, banco e ferramentas

Ficam para o plano de implementação, depois do OK. Estimativa: uma migration (vínculo do canal: caixa, conversa, contato, id da conta do Pablo, estado), um módulo `apps/agent/src/chatwoot/owner-channel.ts` que reaproveita a conversa do Telegram, a rota de retorno na lista do Worker e em `ROUTE_WORDS`. Nenhuma ferramenta nova do agente.

## 8. Custo e cotas do plano Free

- Cloudflare: cada mensagem do Pablo custa 1 requisição ao Worker, 2 subrequisições ao Chatwoot (busca e resposta) e os Neurons da conversa, os mesmos do Telegram, dentro dos 9.000 por dia que a Zuri reserva. Nada novo é ligado: sem KV, D1, Queues ou plano pago.
- Chatwoot: self-hosted no servidor do Pablo, sem custo por mensagem. A caixa "Zuri" não passa pela ponte do WhatsApp, então não há risco de bloqueio do número.

## 9. Segurança e privacidade

| Ameaça | Defesa |
| --- | --- |
| Paciente ou atendente pedindo coisas à Zuri | Só a conversa do vínculo, só o autor do vínculo, conferido na mensagem buscada pela API |
| Retorno forjado ou repetido | Chave no caminho, assinatura HMAC em tempo constante, janela de 5 min, `X-Chatwoot-Delivery` uma vez só, busca de volta |
| Segredo de assinatura vazado | Busca de volta impede texto inventado; trocar o segredo na tela invalida o antigo |
| Chave do atendente "Zuri" vazada | Só escreve na caixa "Zuri"; não lê nem escreve nas caixas de pacientes; revogar no Chatwoot e colar a nova |
| Administrador do Chatwoot escrevendo na conversa | Autor diferente: sem resposta, aviso ao Pablo, 3 avisos desligam |
| Servidor do Chatwoot invadido | É o mesmo poder de quem invade o celular do Pablo no Telegram: ver as respostas. Por isso destrutiva nunca é aprovada por aqui, e o link do app continua pedindo login |
| Injeção por conteúdo lido | Tudo que o agente lê continua em `<data>`; a mensagem do Pablo é a única instrução |
| Resposta virar link ou menção no Chatwoot | Texto puro com `disarmLinks` |
| Respostas ficam guardadas no servidor do Chatwoot | É o servidor do Pablo; o cartão avisa que o histórico fica lá |

## 10. Testes

Quando houver código: unitário da assinatura (certa, errada, sem `sha256=`, timestamp no limite de 5 min, n−1/n/n+1), entrega repetida, autor diferente, caixa e conversa diferentes, mensagem privada, `incoming`; integração no workerd com um Chatwoot falso (busca de volta devolvendo outro texto, outro autor, 401, 5xx, redirecionamento recusado); bloqueio; teto por hora; e2e do cartão e do vínculo; teste de orçamento de subrequisições.

## 11. Entrega

1. Esta PR: só o plano.
2. Com o OK: protótipo do cartão e do vínculo (regra de 12/11).
3. Com o protótipo aprovado: uma PR de código, depois da PR 1 do envio pelo Chatwoot (credencial e chamadas fixas).

## 12. Riscos

- A versão do Chatwoot pode mudar o formato da assinatura; a busca de volta segura o canal mesmo assim, e o teste de vínculo confere a assinatura antes de ligar.
- Administradores do Chatwoot sempre veem a conversa "Zuri" e as respostas dela. Se isso incomodar, a resposta é o Telegram.

## 13. Suposições

- S1: na versão do Pablo, a caixa de API aceita a mensagem da Zuri como `incoming` pela API do cliente ou pela de aplicação. Conferir no "Enviar teste" antes de ligar.
- S2: o "Webhook URL" da caixa de API manda as mensagens do atendente com a mesma assinatura `X-Chatwoot-Signature` do webhook da conta (o plano do pedido de avaliação confirmou essa assinatura no webhook da conta). Se não mandar, usar o webhook da conta filtrado pela caixa "Zuri".
- S3: o Pablo tem uma conta própria de atendente no Chatwoot, separada da de outros atendentes.

## 14. Entrevista com o Pablo

### Perguntas abertas

1. **Abrir a exceção:** a Zuri passa a conversar com você pelo Chatwoot, pela caixa própria "Zuri" (opção A)? Recomendo sim: o risco fica igual ao do Telegram e nenhum paciente fica ao alcance dela.
2. **Aprovações:** ação destrutiva continua só no app e no Telegram? Recomendo sim, porque outros administradores do Chatwoot veem a conversa.
3. **Notas nas conversas dos pacientes (opção C):** fica para depois, num plano próprio? Recomendo deixar para depois.
