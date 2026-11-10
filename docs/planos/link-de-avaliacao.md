# Plano · Link de avaliação do Google e endereço curto do pedido

- **Tipo:** ajuste (parte do pedido de avaliação)
- **Pedido por:** Pablo, em 10/11/2026
- **Situação:** rascunho, espera as respostas da seção 14

## 1. Resumo

O pedido de avaliação leva um endereço curto da própria Zuri (`zuri.exemplo.com.br/a/k7Q2mX9p`). Quem toca é levado à página de avaliação do perfil no Google, e a Zuri anota que aquele pedido foi aberto. Para isso funcionar faltam três coisas no sistema: saber qual é o link de avaliação do perfil, ter a rota pública que redireciona e ter a tela onde o Pablo confere e ajusta. Este plano descreve as três. A fila de envio e o Chatwoot continuam no [plano do envio](envio-chatwoot-pela-zuri.md).

## 2. Contexto no sistema

| Área | Onde | O que faz hoje |
| --- | --- | --- |
| Perfis do Google | `apps/agent/src/reviews/service.ts`, tabela `zur_review_locations` | Lista os perfis da conta com `readMask: "name,title"` e guarda o nome de cada um. O **nome real da empresa já vem do Google**; "Consultório Exemplo" existe só nos dados de exemplo |
| Avaliações | `apps/agent/src/reviews/`, migrations 26 e 27 | Lê, prepara rascunho e publica com aprovação |
| Rota pública com portão próprio | `apps/agent/src/crm/events.ts` | Exemplo de rota fora da sessão, com limite por minuto e resposta igual para certo e errado |
| Endereço público | variável `PUBLIC_URL` | Usada nos links que a Zuri monta |
| Link pessoal | [sincronizacao-contatos-avaliacoes.md](sincronizacao-contatos-avaliacoes.md), [envio-chatwoot-pela-zuri.md](envio-chatwoot-pela-zuri.md) | Decidido em 10/11: código sorteado por pedido, vale 30 dias, prévia do WhatsApp não conta. Tabela `zur_review_links` planejada, ainda sem código |
| Tela | protótipo, Avaliações › Ajustes › "Pedidos e link" | Campo do link, endereço curto, mensagem e "Quando pedir" |

Decisões que valem aqui: a Zuri só escreve a contatos para pedir avaliação (09/11); nada de serviço pago; nenhum dado pessoal no endereço.

## 3. Objetivo e critérios de aceite

| Nº | Critério | Origem |
| --- | --- | --- |
| CA1 | A Zuri busca sozinha o link de avaliação do perfil escolhido e mostra de onde ele veio | Pablo |
| CA2 | O Pablo pode colar o link à mão; só entra endereço https do Google | Pablo |
| CA3 | Sem link válido, nenhum pedido entra na fila e a tela diz o que falta | Pablo |
| CA4 | `/a/<código>` leva só à página de avaliação guardada, nunca a outro endereço | segurança |
| CA5 | A abertura é anotada uma vez por pedido, com data e hora; robô de prévia não conta | decisão de 10/11 |
| CA6 | Código vencido, errado ou repetido demais não revela nada: leva à mesma página do Google ou devolve 404, sem dizer qual | segurança |
| CA7 | O cabeçalho de Avaliações mostra o nome do perfil que veio do Google | Pablo |

## 4. Escopo

**Entra:** leitura do link no Google, campo manual, validação, rota `/a/:code`, registro de abertura, tela "Pedidos e link", mensagem modelo com `{link}`, testes e documentação.

**Não entra:** a fila de envio e o cliente do Chatwoot (plano próprio), encurtador de uso geral (o endereço curto só serve ao pedido de avaliação) e contagem de cliques por pessoa além de "abriu".

## 5. Como funciona para o Pablo

### Fluxo 1 · Conferir o link (uma vez)

1. Avaliações › Ajustes › **Pedidos e link**.
2. O campo "Link de avaliação do perfil no Google" já vem preenchido, com a linha "Puxado do perfil … em …".
3. **Abrir para conferir** abre o link numa aba nova. É a página onde a pessoa dá as estrelas.
4. Se o Google não entregar o link, o campo fica vazio com o aviso "Cole o link de 'Pedir avaliações' do seu perfil". O Pablo cola e salva.
5. **Buscar no perfil** lê de novo no Google, sem esperar a próxima leitura.

### Fluxo 2 · O pedido

1. Na hora do envio, a Zuri sorteia o código, guarda `código → pedido` e troca `{link}` na mensagem por `PUBLIC_URL/a/<código>`.
2. A pessoa toca. A Zuri anota "abriu" e responde com um redirecionamento para o link guardado.
3. Em Avaliações › Pedidos, a linha do pedido passa de "Entregue" para "Abriu o link".

### Textos visíveis

No catálogo (`pt-BR-reviews.ts` e `en`), passados pela `humanizer:humanizer`. A tela não cita Cloudflare, Worker nem nome de API. Rótulos do protótipo: "Link de avaliação", "Endereço curto de cada pedido", "Buscar no perfil", "Abrir para conferir", "Mensagem do pedido", "Quando pedir".

## 6. Regras de negócio e limites

| Regra | Valor | No limite |
| --- | --- | --- |
| De onde vem o link | Do perfil no Google; o que o Pablo colar vence o do Google | Sem nenhum dos dois, pedidos pausados com aviso |
| Endereços aceitos | https, sem usuário, sem porta, host exatamente `g.page`, `search.google.com`, `www.google.com` ou `maps.app.goo.gl`, até 300 caracteres | Fora disso: "Só vale endereço do Google" |
| Um link por perfil | Cada perfil lido (até 3) tem o seu | Pedido usa o do perfil ligado à consulta; com um perfil só, o dele |
| Código | 10 caracteres de `A–Z a–z 2–9` sem os parecidos (cerca de 57 bits), sorteado com `crypto.getRandomValues`, único | Colisão: sorteia de novo |
| Validade | 30 dias depois do envio | Vencido: leva ao Google sem anotar |
| Abertura | Conta a primeira; as seguintes só redirecionam | — |
| Robô de prévia | Agente de usuário de prévia (WhatsApp, Telegram, Facebook, Slack e afins) e pedido `HEAD` não contam | Devolve uma página mínima sem redirecionar |
| Limite por origem | 30 por minuto por IP na rota `/a/` | Acima: 429 |
| Mensagem | Até 500 caracteres, precisa de `{link}`; `{primeiro_nome}` é opcional | Sem `{link}`: não salva |
| Período da visão geral | Últimos 30 dias como padrão | — |

## 7. Desenho técnico

### Arquivos

- `apps/agent/src/reviews/service.ts`: `readMask` passa a `name,title,metadata`; guarda `metadata.newReviewUri` quando vier e passar na validação.
- `apps/agent/src/reviews/link.ts` (novo): validação do endereço, sorteio do código, montagem do endereço curto.
- `apps/agent/src/api/review-link.ts` (novo): rota pública `GET /a/:code`.
- `packages/shared`: schema Zod do link e da mensagem, constantes (`REVIEW_LINK`: tamanho do código, validade, hosts).
- `apps/web`: seção "Pedidos e link" em Avaliações › Ajustes.

### Rotas e contratos

| Rota | Quem chama | Resposta |
| --- | --- | --- |
| `GET /a/:code` | qualquer pessoa, sem sessão | 302 para o link guardado; 404 igual para código que não existe |
| `GET /api/reviews/link` | dono | link do Google, link manual, de onde veio, data da leitura |
| `PUT /api/reviews/link` | dono, com senha recente | grava ou limpa o link manual |
| `POST /api/reviews/link/refresh` | dono | lê de novo no Google |

A rota `/a/` fica antes do portão de sessão, como a de eventos do CRM. Ela continua valendo com o modo de bloqueio ligado, porque só redireciona e não lê dado nenhum do dono.

### Banco

Próxima migration livre: conferir na hora. Só acréscimo.

- `zur_review_locations`: colunas `review_uri` (do Google) e `review_uri_manual`, as duas podendo ser nulas.
- `zur_review_links`: `code` (chave), `request_id`, `location`, `created_at`, `expires_at`, `opened_at`. Sem nome, telefone ou e-mail. Fica fora do backup, como os ids do Chatwoot.

### Ferramentas do agente

Nenhuma. A conversa não cria nem lê links.

### Agendamentos, IA e integrações externas

A leitura do link pega carona na listagem de perfis que já existe; não há chamada nova por despertar. Uma limpeza diária apaga códigos vencidos há mais de 60 dias. Nenhuma IA.

## 8. Custo e cotas do plano Free

| Item | Uso | Folga |
| --- | --- | --- |
| Requisições | Uma por toque no link; com o teto de 20 pedidos por dia, dezenas por dia | Longe das 100.000 |
| Linhas escritas | 1 ao criar o código, 1 na primeira abertura | Desprezível |
| Chamadas ao Google | Nenhuma a mais (mesma listagem, campo a mais) | Igual a hoje |
| JS da tela | Seção dentro de uma tela já carregada sob demanda | Fora do JS inicial |

Nenhum recurso novo da Cloudflare.

## 9. Segurança e privacidade

| Risco | Proteção | Teste |
| --- | --- | --- |
| Redirecionamento aberto | O destino nunca vem do endereço pedido; sai só do banco, e só entra no banco se passar na lista de hosts | Código com `?next=`, link manual para outro host, host parecido (`g.page.exemplo.com.br`), `http`, com usuário e senha |
| Adivinhar códigos | 57 bits, limite por IP, resposta igual para certo e errado | 31 pedidos seguidos, tempo de resposta parecido |
| Vazar quem é a pessoa | O código não deriva de nada do contato; a rota não devolve nome nem estado | Resposta sem corpo além do 302 |
| Prévia contar como abertura | Lista de agentes de prévia e `HEAD` | Um caso por agente |
| Injeção pelo campo manual | Zod, tamanho, `URL` do navegador e do Worker, nunca vira HTML | Campo com script, espaços, quebras de linha |
| Link trocado por engano | Salvar pede senha recente e fica no registro de segurança | — |

A mensagem diz como parar de receber ("responder SAIR"), como o plano do envio pede.

## 10. Testes

- Unidade: validação do endereço (lista de hosts, casos de borda), sorteio e unicidade do código, troca de `{link}`.
- Integração: `/a/:code` certo, vencido, inexistente, prévia, `HEAD`, limite, modo de bloqueio; leitura do Google com e sem `metadata`; link manual vencendo o do Google.
- Interface (Playwright, com axe): campo preenchido, campo vazio com aviso, erro de endereço, salvar, celular e tema escuro.
- Segurança: os casos da seção 9.

## 11. Entrega

Uma PR, depois da fila de envio (PR 3 do [plano dos módulos](https://github.com/pablopfg/zuri/pull/247)) e junto com o pedido de avaliação (PR 5), porque o link só tem uso com o pedido. Atualiza `docs/avaliacoes-google.md`, o changelog e as capturas da tela.

## 12. Riscos

| Risco | Como tratar |
| --- | --- |
| O Google não devolver `newReviewUri` para o perfil | Campo manual e aviso na tela (CA2, CA3) |
| O domínio da Zuri mudar | O endereço curto usa `PUBLIC_URL`; links antigos param. Avisar na tela ao trocar o domínio |
| WhatsApp marcar o domínio como suspeito | Fora do controle da Zuri; a tela permite mandar o link do Google direto se o Pablo preferir (pergunta 2) |

## 13. Suposições

- O campo `metadata.newReviewUri` vem na mesma listagem de perfis, pedindo `metadata` no `readMask`. Conferir na documentação do Google e num perfil de verdade antes de codar.
- O primeiro deploy já definiu `PUBLIC_URL` com o domínio final.

## 14. Entrevista com o Pablo

### Perguntas abertas

1. **Se o Google entregar o link, o campo fica travado ou editável?** Recomendação: editável, com o do Google como padrão e um botão para voltar a ele.
2. **Se o endereço curto falhar (domínio fora do ar), a Zuri manda o link do Google direto?** Recomendação: não mandar nada e avisar você, para não perder a contagem de quem abriu sem você saber.
3. **O link do perfil também aparece para copiar à mão (para colar numa conversa sua)?** Recomendação: sim, um botão "Copiar" ao lado do campo. Esse não conta abertura.
