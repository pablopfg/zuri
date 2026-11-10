# Plano · Pedido de avaliação enviado pela Zuri, pelo Chatwoot

Pedido do Pablo em 09/11/2026, 19:15: o link de avaliação sai pela própria Zuri, numa automação, usando o Chatwoot, sem passar pelo n8n. Este plano levanta o que é preciso, diz se é viável e divide a entrega em PRs. Complementa a seção 8 de [sinal-refinado-funcionalidades.md](sinal-refinado-funcionalidades.md).

## 1. Resumo

É viável e cabe no plano gratuito da Cloudflare. A Zuri já sabe chamar um serviço de fora com segurança: o passo "Chamar um serviço" dos fluxos usa uma conexão com endereço fixo, métodos e caminhos liberados, credencial cifrada e bloqueio de rede privada e de redirecionamento. O Chatwoot entra como uma integração própria, com só as 4 chamadas necessárias, e o pedido de avaliação vira um tipo novo de automação.

Respostas do Pablo (09/11, 19:34):

1. **Regra do projeto:** liberada a exceção. A Zuri continua sem enviar nada a contatos, menos o pedido de avaliação desta automação.
2. **Caixa do WhatsApp:** é uma caixa do tipo **API** no Chatwoot, ligada a uma API não oficial do WhatsApp. Não há modelo aprovado nem cobrança da Meta; a mensagem sai como texto comum. O risco que fica é o bloqueio do número, tratado nos limites da seção 6.
3. **Chatwoot:** instalado no servidor do Pablo (self-hosted), na versão mais recente. Precisa de endereço https público para a Zuri alcançar.

## 2. Contexto no sistema

| O que já existe | Onde | Uso aqui |
| --- | --- | --- |
| Conexões de fluxo: endereço https fixo, métodos GET/POST/PUT/PATCH, prefixos de caminho, credencial cifrada ("flows-v1"), sem rede privada nem redirecionamento, 10 s por chamada | `apps/agent/src/flows/connections.ts`, `mcp/guarded-fetch.ts`, `mcp/url.ts` | A integração do Chatwoot reaproveita essa proteção, com caminhos fixos no código |
| Automações com aprovação, prioridade e histórico | `apps/agent/src/automations/` (etapas 9 e 10) | Tipo novo "Pedido de avaliação" |
| Avaliações do Google lidas a cada 15 min, com histórico | `apps/agent/src/reviews/` (19c e 19d) | Saber quem já avaliou |
| Nível automático depois de 10 aprovações e disjuntor | 19d | Mesmo jeito de ganhar confiança no envio |
| Eventos assinados vindos de fora | `/api/crm/events/:key` (22b) | Modelo para o endereço de retorno do Chatwoot |
| Modo de bloqueio | `auth.lockdown` | Nada sai durante o bloqueio |

## 3. Objetivo e critérios de aceite

- Quem nunca avaliou recebe uma única mensagem com o link, 8 dias depois da consulta, sempre em dia útil, e no máximo um lembrete.
- Ninguém recebe duas vezes: nem com duas abas abertas, nem se o Worker reiniciar no meio do envio, nem com o mesmo telefone em dois contatos.
- A IA nunca escreve a mensagem. O texto é um modelo fixo que só troca o primeiro nome e o link.
- Começa pedindo a sua aprovação a cada dia. O modo automático só fica disponível depois de 10 aprovações sem mudança, e desliga sozinho em caso de problema.
- Um botão desliga tudo na hora, e nada sai durante o modo de bloqueio.

## 4. Escopo

Entra: integração Chatwoot em Configurações › Integrações; tipo de automação "Pedido de avaliação"; fila, travas e histórico; endereço de retorno do Chatwoot (situação da mensagem e "não quero receber"); aprovação na tela e no Telegram.

Fica de fora: conversar com o contato pela Zuri, responder mensagens, campanhas, qualquer outro tipo de mensagem e envio por outro canal.

## 5. Como funciona para o Pablo

### Fluxo 1 · Ligar o Chatwoot

Configurações › Integrações › Chatwoot: endereço do Chatwoot, número da conta e chave de acesso (pede a senha). A Zuri lista as caixas de entrada; você escolhe a do WhatsApp. Em seguida, "Enviar teste para mim" manda a mensagem para o seu próprio número.

### Fluxo 2 · Criar a automação

Automações › Criar automação › **Pedido de avaliação**:

1. **Quando:** todo dia útil, às 09:00. Pula sábado, domingo, feriados nacionais e os seus "dias sem expediente".
2. **Quem:** consulta há 8 dias (o número pode mudar), nunca avaliou, não pediu para não receber.
3. **Mensagem:** o texto, com `{primeiro_nome}` e `{link}`. Aparece uma prévia. Como a caixa é de API, não há modelo da Meta para escolher.
4. **Envio:** "Perguntar antes" (padrão) ou "Automático" (liberado depois de 10 aprovações). Limite por dia (padrão 20) e intervalo entre mensagens (padrão de 30 segundos a 1 minuto, sorteado a cada envio, para não parecer disparo em massa).
5. **Revisar.**

### Fluxo 3 · Dia a dia

Às 09:00 chega um aviso: "3 pedidos de avaliação prontos". A lista mostra nome, data da consulta e telefone. Você tira quem quiser e toca em "Enviar 3". A Zuri envia um a cada 30 segundos a 1 minuto e marca cada um como enviado, com falha ou "Não quer receber". O mesmo vale pelo Telegram, com `/aprovar`.

### Textos visíveis

Seguem o catálogo `pt-BR-reviews.ts` e `pt-BR-automations.ts`. Os novos são escritos no plano de cada PR e passam pelo humanizer.

## 6. Regras de negócio e limites

| Regra | Valor |
| --- | --- |
| Dias depois da consulta | 8 (de 3 a 30) |
| Dia útil | Segunda a sexta, menos os feriados nacionais (calculados no código, sem chamar API) e os dias sem expediente |
| Horário | Das 09:00 às 18:00, no fuso da conta; o que sobrar fica para o próximo dia útil |
| Mensagens por dia | Até 20 (de 1 a 50) |
| Intervalo | 1 mensagem a cada 30 segundos a 1 minuto (sorteado; pedido do Pablo, 10/11, 03:01), no alarme único do objeto. O intervalo é da **credencial** do Chatwoot (campos "De" e "Até", de 30 s a 1 min; teto reduzido de 10 min para 1 min a pedido do Pablo, 10/11, 03:22), vale para todos os módulos que usam a mesma caixa e segue a fila única descrita em [modulos-crm.md](modulos-crm.md), seção 6 (pedido do Pablo, 10/11, 02:24) |
| Lembrete | Um só, 7 dias depois, também em dia útil |
| Quem recebe | Só quem nunca avaliou, sem avaliação pendente de confirmação e sem "não quero receber" |
| Disjuntor | Desliga o modo automático e pausa o envio com: 2 falhas seguidas do Chatwoot, recusa da chave (401/403), mensagem marcada como falha pela ponte do WhatsApp, 3 respostas "não quero receber" no mesmo dia |
| Bloqueio | Nada sai durante o modo de bloqueio |

## 7. Desenho técnico

### Chamadas ao Chatwoot

Só estas, com caminhos fixos no código (não configuráveis):

| Para quê | Chamada |
| --- | --- |
| Testar e listar caixas | `GET /api/v1/accounts/{conta}/inboxes` |
| Achar o contato pelo telefone | `GET /api/v1/accounts/{conta}/contacts/search?q=<+55…>` |
| Criar o contato, se não existir | `POST /api/v1/accounts/{conta}/contacts` (`inbox_id`, `name`, `phone_number` em E.164) |
| Abrir a conversa | `POST /api/v1/accounts/{conta}/conversations` (`inbox_id`, `contact_id`, `source_id`) |
| Achar a conversa que já existe | `GET /api/v1/accounts/{conta}/contacts/{id}/conversations` |
| Enviar a mensagem | `POST /api/v1/accounts/{conta}/conversations/{id}/messages` com `content`, `message_type: outgoing` e `private: false` |

Autenticação pelo cabeçalho `api_access_token`. Recomendação: criar no Chatwoot um agente "Zuri", com acesso só à caixa do WhatsApp, e usar a chave dele.

Na caixa de API, quem entrega no WhatsApp é a ponte que o Chatwoot chama quando sai uma mensagem; a Zuri não fala com a ponte nem guarda nada dela. Para não duplicar contato nem conversa na ponte, a Zuri procura primeiro o contato pelo telefone e usa a conversa aberta que ele já tem nessa caixa. Só cria contato ou conversa quando não existe, e o "Enviar teste para mim" confere esse caminho de ponta a ponta antes de qualquer paciente.

São no máximo 4 chamadas por mensagem (procurar, achar a conversa ou criar, enviar). Com 20 mensagens por dia, ficam 80 subrequisições por dia, uma mensagem por despertar do alarme, longe do teto de 50 por invocação do plano Free.

Modelos da Meta (`template_params`) ficam fora: a caixa é de API. Se um dia a caixa mudar para a API oficial, isso volta como PR à parte, com o custo ⚠️ para aprovar.

### Retorno do Chatwoot

Endereço próprio, `/api/chatwoot/events/:key`, com uma chave aleatória no caminho (como os eventos do CRM), fora das sessões e dos tokens de API. A versão do Chatwoot que o Pablo usa assina os webhooks: `X-Chatwoot-Signature` é `sha256=` mais o HMAC-SHA256 de `timestamp + "." + corpo cru`, com `X-Chatwoot-Timestamp` e `X-Chatwoot-Delivery` (correção de 10/11, vinda do plano [modulos-crm.md](modulos-crm.md)). A Zuri confere a assinatura com o segredo guardado na credencial (comparação em tempo constante, janela de 5 minutos no timestamp, `X-Chatwoot-Delivery` visto uma vez só) e recusa o que não bater. Mesmo assinado, o aviso é só sinal: a Zuri confere a mensagem pela API antes de mudar qualquer estado. Eventos usados:

- `message_updated`: situação da mensagem (enviada, entregue ou falhou).
- `message_created` vindo do contato, numa conversa aberta pela Zuri: se o texto for "não quero", "parar" ou "sair", a pessoa vira "Não quer receber". Qualquer outra resposta só gera um aviso para você. A Zuri não responde nada.

### Envio sem repetir

1. Cada pedido tem uma chave única (contato + tipo + número da tentativa) e uma linha na tabela de pedidos.
2. Antes de chamar o Chatwoot, a linha passa de "pronto" para "enviando" numa transação. Outra aba ou outro despertar não pega a mesma linha.
3. Antes de enviar, a Zuri confere de novo: avaliação nova, sugestão pendente, "não quero receber", telefone já usado e limite do dia.
4. Se o Worker cair entre o envio e a resposta, a linha fica "a conferir". No despertar seguinte, a Zuri lê as mensagens da conversa (`GET …/conversations/{id}/messages`) e só reenvia se a mensagem não estiver lá. É o mesmo cuidado da publicação das avaliações (19c).

### Banco

Próxima migration livre: 31 (conferir na hora). Tabelas novas: `zur_review_requests` (fila, estado, chave única, datas, ids do Chatwoot, sem o texto da mensagem), `zur_chatwoot` (endereço, conta, caixa, credencial cifrada com o rótulo "chatwoot-v1") e `zur_review_links` (código aleatório do link pessoal → pedido). Ficam fora do backup: a credencial e os ids do Chatwoot.

### Ferramentas do agente

Nenhuma ferramenta nova na conversa. A IA não envia, não escreve a mensagem e não muda a fila. Pedir "manda o link para a Carla" na conversa vira uma proposta que abre a tela da fila.

## 8. Custo e cotas do plano Free

Na Cloudflare: zero. Usa o Durable Object e o alarme que já existem, sem IA e sem recurso novo. São cerca de 80 subrequisições por dia.

Fora da Cloudflare: sem custo por mensagem, porque a caixa é de API com uma API não oficial do WhatsApp (resposta do Pablo, 09/11 19:34). O preço é o risco de bloqueio do número quando muitas mensagens saem para quem não escreveu antes. O limite de 20 por dia, o intervalo variável e o envio só para quem já foi atendido reduzem esse risco, sem zerar.

## 9. Segurança e privacidade

- **Credencial:** cifrada, digitada com a senha, nunca volta ao navegador e só é aberta para assinar uma chamada ao endereço salvo.
- **Saída fixa:** endereço https público, sem redirecionamento, sem rede privada e só os caminhos da tabela acima. Não é HTTP livre.
- **Mensagem:** a IA não escreve. O primeiro nome é limpo (só letras, até 20 caracteres) e o link é gerado pela Zuri.
- **Retorno:** nunca é tratado como ordem. Tudo que chega é conferido pela API, e o texto do contato entra só como dado num aviso.
- **Desligar e bloquear:** um botão "Pausar envios" para tudo; o modo de bloqueio e o `/bloquear` do Telegram também param.
- **LGPD:** a mensagem diz de quem é e como parar de receber. "Não quero receber" vale para sempre e só você desfaz.
- **Regras do Google:** todos recebem o mesmo link, nada de pedir só a quem parece satisfeito.
- **Auditoria completa** nesta entrega, como nas etapas que mexem com saída para a internet.

## 10. Testes

Unidade: calendário de dias úteis (feriados móveis de 2026 a 2030), escolha da fila, chave única, travas, disjuntor e interpretação do "não quero". Integração no workerd com um Chatwoot falso: envio, erro 401, 429 e 5xx, queda no meio do envio, retorno falso. Teste de orçamento: subrequisições por despertar. E2e: criar a automação, aprovar a lista, pausar. Segurança: caminho fora da lista recusado, redirecionamento recusado, retorno com chave errada recusado, nada sai durante o bloqueio.

## 11. Entrega

| PR | O que entra | Depende de |
| --- | --- | --- |
| 1 | Fila sem envio: ligar avaliações aos contatos (impressão digital do nome), data da consulta pela agenda ou pelo CRM, calendário de dias úteis, estados e envio com um toque pelo WhatsApp (opção A) | Nova interface aprovada |
| 2 | Integração Chatwoot: cartão em Integrações, credencial cifrada, listar caixas, "Enviar teste para mim" | PR 1 |
| 3 | Automação "Pedido de avaliação" com envio pela Zuri, "Perguntar antes", retorno do Chatwoot e aprovação pelo Telegram | PR 2 (regra de 02/11 liberada em 09/11) |
| 4 | Modo automático depois de 10 aprovações, com disjuntor | PR 3 em uso |

Cada PR segue o fluxo do projeto: plano detalhado, QA, auditoria e capturas.

## 12. Riscos

- **Contato ou conversa duplicados na ponte do WhatsApp:** a Zuri cria o contato num formato diferente do que a ponte usa. Mitigação: procurar pelo telefone e reaproveitar a conversa antes de criar, e o teste para o seu número antes de qualquer paciente.
- **Mudança da API numa versão nova do Chatwoot:** como o servidor segue a versão mais recente, uma chamada pode mudar. Mitigação: poucas chamadas, fixas no código, testes contra um Chatwoot falso e o disjuntor, que pausa e avisa na primeira resposta estranha.
- **Bloqueio do número na API não oficial.** Mitigação: limite diário, intervalo e só quem já foi atendido.
- **Avaliação ligada ao contato errado.** Mitigação: na dúvida, a pessoa fica fora da fila.
- **Chatwoot fora do ar.** Mitigação: tenta de novo no próximo despertar, desliga depois de 2 falhas e avisa você.

## 13. Suposições

- O Chatwoot tem endereço https público. Se estiver só na rede interna, a Zuri não alcança, por regra de segurança.
- A caixa do WhatsApp no Chatwoot é a mesma caixa de API que o consultório já usa.
- A data da consulta está na agenda Pessoal (com o telefone na descrição) ou chega pelos eventos do CRM.

## 14. Entrevista com o Pablo

### Respostas (09/11, 19:34)

1. Exceção à regra de 02/11: **sim**, liberada, só para o pedido de avaliação. Começa em "Perguntar antes".
2. Caixa do WhatsApp: **caixa de API** no Chatwoot, com API não oficial. Sem modelo da Meta e sem custo por mensagem; fica o risco de bloqueio do número.
3. Chatwoot: **self-hosted, versão mais recente.**

Sem perguntas abertas. O plano detalhado de cada PR sai pela skill `planejar` quando a nova interface for aprovada.
