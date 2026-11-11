# Plano · Contatos a cada 5 min, Avaliações a cada 10 min e a área de Avaliações

Situação: plano. Pedido do Pablo em 09/11/2026, 21:51. O protótipo da rodada 5 já mostra tudo (`docs/planos/modelos-frontend/prototipo-v5.html`).

## 1. Resumo

O pedido é viável e cabe no plano gratuito. A parte mais cara (o "cache") já existe: a Zuri só pede ao Google o que mudou e só regrava o contato que mudou. O que falta é encurtar os intervalos, mostrar a contagem regressiva, ler mais campos do Google, mudar onde as etiquetas são escolhidas e dar às Avaliações uma área própria com o índice de recomendação.

| Pedido | Hoje na develop | O que muda |
| --- | --- | --- |
| Contatos a cada 5 min | A cada 1 hora, mais o botão | 5 min, pelo mesmo alarme único |
| Avaliações a cada 10 min | A cada 15 min | 10 min |
| Contagem regressiva | Não há | "Próxima em 4:12" em Contatos, Avaliações e Configurações |
| Cache: não regravar sem dado novo | Já existe: token de sincronização do Google (só o que mudou) e `etag` por contato (pula quem não mudou) | Etiquetas lidas 1 vez por hora em vez de a cada leitura; a tela só recarrega quando algo mudou |
| Sincronizar só as etiquetas escolhidas | Já existe (etapa 19b), em Configurações › Integrações | Botão de etiquetas no topo de Contatos, contagem por etiqueta e filtro rápido na lista |
| Mesmos campos do Google Contatos | Nome, apelido, telefones, e-mails, aniversário, datas, empresa, etiquetas, campos personalizados, observações | Mais endereço, site, relações e chat; campo vazio tratado em todos |
| Tirar "Clientes" de Contatos | Aba Clientes (CRM da etapa 22b) | A aba sai; os dados ficam (seção 4) |
| Avaliações com área própria | Aba dentro de Contatos | Item próprio no menu lateral: Visão geral, Avaliações e Pedidos |

## 2. Contexto no sistema

- Contatos: `apps/agent/src/google/contacts.ts` (sincronização, trava no banco, `syncToken`, `etag`, até 10 páginas por despertar, teto de 5.000), `contacts-store.ts`, migration 23. A constante `HOUR_MS` marca a próxima leitura em `done()`.
- Avaliações: `apps/agent/src/reviews/service.ts` (leitura a cada 15 min, marca d'água com 1 h de folga, `orderBy=updateTime desc`, para de paginar no que já leu), migrations 26 e 27, `docs/avaliacoes-google.md`.
- CRM: `apps/agent/src/crm/`, eventos do n8n em `/api/crm/events/:key`, migration 25.
- Regras: P4 (não gravar o que não mudou; `setAlarm` conta uma escrita), P8 (um alarme só), P10 (sem log no caminho comum), P13 (retenção).
- Decisões que valem: avaliação ↔ contato (09/11, 20:02), Chatwoot (09/11, 19:34), interface em pt-BR e sem citar infraestrutura.

## 3. Objetivo e critérios de aceite

1. Contatos lê o Google a cada 5 min e Avaliações a cada 10 min, sem passar de 3% de nenhuma cota diária do Free (seção 8).
2. Uma leitura sem novidade não regrava contato nem avaliação e não faz a tela recarregar. Teste de orçamento: zero linhas em `zur_contacts` e `zur_reviews` numa leitura sem mudança.
3. A tela mostra "Próxima em m:ss", que chega a zero, mostra "Sincronizando…" e recomeça quando o servidor avisa.
4. Escolher etiquetas no topo de Contatos copia só os contatos delas; desmarcar some com as cópias na próxima leitura; nada muda no Google.
5. A ficha do contato mostra todos os campos que o Google tiver. Campo vazio não quebra nada nem aparece como linha em branco: entra na lista "Vazio no Google".
6. Contato sem nome aparece pelo telefone ou e-mail; sem telefone, os botões Ligar e WhatsApp aparecem desligados com "Sem telefone".
7. Contatos não tem mais a aba Clientes. Nenhum dado do CRM é apagado.
8. Avaliações tem item próprio no menu lateral (e na folha "Mais" do celular), com índice de recomendação, nota média, respondidas, tempo até responder, notas por estrela e funil dos pedidos, por período (30 dias, 6 meses, 12 meses).

## 4. Escopo

Dentro: intervalos, contagem, leitura das etiquetas por hora, recarga só com mudança, campos novos, ficha com campos vazios, botão de etiquetas em Contatos, rota e tela de Avaliações com as métricas.

Fora: escrever no Google (continua só leitura), foto do contato (seção 6 do [desenho das funcionalidades](sinal-refinado-funcionalidades.md)), envio dos pedidos (plano do [Chatwoot](envio-chatwoot-pela-zuri.md)).

**Clientes:** a aba sai de Contatos, como o Pablo pediu. O CRM continua recebendo os eventos do n8n e guardando os dados; nada é apagado (regra 5 do `AGENTS.md`). O cliente ligado a um contato passa a aparecer na ficha desse contato quando a ligação CRM ↔ contato (pendência da 22c) entrar. Se o Pablo quiser parar de receber os eventos, é desligar a chave dos eventos em Integrações.

## 5. Como funciona para o Pablo

**Contatos.** No topo da lista: "Google Contatos · 6 etiquetas · 18 contatos" e, embaixo, "Nada mudou às 08:08 · Próxima em 4:12". O ícone de etiqueta (ou o texto "6 etiquetas") abre a lista de etiquetas do Google com o número de contatos de cada uma; marcar e salvar decide o que a Zuri copia. Abaixo, uma fileira de etiquetas filtra a lista na hora ("Todas", "Consultório 9", "Família 2"…). O botão de atualizar sincroniza agora.

**Ficha.** Os grupos seguem a ordem do Google Contatos: nome (nome, nome do meio, sobrenome, apelido), telefones, e-mails, endereço, aniversário, datas especiais, relações, empresa e cargo, site, chat, etiquetas, campos personalizados e observações. Embaixo, "Vazio no Google: Endereço, Site, Chat."

**Avaliações.** Item próprio no menu, logo abaixo de Contatos, com o número das que esperam você. Três abas:

- **Visão geral:** período, quatro números (índice de recomendação com a variação, nota média, respondidas, tempo até responder), índice por mês, notas por estrela, funil dos pedidos (receberam o link → abriram → avaliaram) e as que precisam de você. Cada gráfico tem "Ver em tabela".
- **Avaliações:** a lista e a avaliação aberta, como hoje.
- **Pedidos:** a fila dos pedidos de avaliação e a ligação com os contatos.

No topo: "Perfil da Empresa no Google · Consultório, Curitiba", "Nada novo às 08:07 · Próxima em 8:47", "Conferir agora" e "Pausar respostas".

### Textos visíveis

Novos no catálogo (`pt-BR-contacts.ts`, `pt-BR-reviews.ts` e `en`): "Próxima em {tempo}", "Sincronizando…", "Nada mudou às {hora}", "Nada novo às {hora}", "Conferido às {hora}", "Etiquetas sincronizadas", "Vazio no Google", "Sem nome no Google", "Sem telefone", "Índice de recomendação", "Nota média", "Respondidas", "Tempo até responder", "Notas", "Pedidos de avaliação", "Ver em tabela", "Visão geral". Passam pela `humanizer:humanizer`.

## 6. Regras de negócio e limites

| Regra | Valor |
| --- | --- |
| Intervalo dos contatos | 5 min (constante `CONTACTS_EVERY_MS`, não configurável na tela) |
| Intervalo das avaliações | 10 min (`REVIEWS_EVERY_MS`) |
| Lista de etiquetas do Google | 1 vez por hora, ao abrir a escolha de etiquetas e ao salvar |
| Botão "Sincronizar agora" / "Conferir agora" | 1 por minuto; antes disso, 429 com "Tente de novo em {s} s" |
| Falhas seguidas | Espera dobra a partir do intervalo, até 6 h (como hoje); a contagem mostra a espera real |
| Tela escondida | A contagem para quando a aba do navegador fica escondida e volta certa pelo horário do servidor |
| Índice de recomendação | 5 estrelas recomenda, 4 é neutro, 1 a 3 não recomenda; índice = % que recomenda − % que não, de −100 a 100. O texto da tela explica que é uma estimativa a partir das estrelas |
| Períodos das métricas | 30 dias (por semana), 6 meses e 12 meses (por mês) |

## 7. Desenho técnico

### Arquivos

| Arquivo | Mudança |
| --- | --- |
| `apps/agent/src/google/contacts.ts` | `CONTACTS_EVERY_MS = 5 min` em `done()`; espera das falhas parte do intervalo; `readLabels` só se passou 1 h, se a escolha mudou ou se o dono abriu a escolha; `PERSON_FIELDS` com `addresses,urls,relations,imClients`; `ContactData` com os campos novos, todos opcionais |
| `packages/shared/src/contacts*.ts` | Schemas Zod dos campos novos com padrão vazio, limites de tamanho e de quantidade (até 10 por campo) |
| `apps/agent/src/reviews/service.ts` | Intervalo de 10 min; nada muda na marca d'água |
| `apps/agent/src/reviews/metrics.ts` (novo) | Contagens por estrela e por mês, respondidas e mediana do tempo de resposta, numa consulta agregada |
| `apps/agent/src/api/…` | `GET /api/reviews/metrics?period=30d\|6m\|12m`; `nextSyncAt` no estado de contatos e avaliações |
| `apps/web/src/pages/contacts/*` | Sem a aba Clientes; topo com etiquetas e contagem; ficha com todos os campos |
| `apps/web/src/pages/reviews/*` (novo) | Rota `/avaliacoes/:aba?`, com Visão geral, Avaliações e Pedidos; `/contatos/avaliacoes` redireciona |
| `apps/web/src/components/SyncCountdown.tsx` (novo) | Um temporizador só para a tela toda, parado com a aba escondida |

### O "cache" (o que já existe e o que entra)

1. **Google só manda o que mudou.** Contatos usam o `syncToken` da People API; Avaliações leem por `updateTime` decrescente e param no que já leram. Uma leitura sem novidade custa 1 chamada por recurso.
2. **Quem não mudou não é regravado.** Contato com o mesmo `etag` é pulado (já existe). Avaliação com o mesmo `updateTime` e o mesmo resumo (hash do texto, da nota e da resposta) também.
3. **Etiquetas por hora.** Hoje a lista de etiquetas é lida em toda sincronização. Passa a 1 vez por hora: a filiação de um contato a uma etiqueta já vem no próprio contato pelo `syncToken`, então ninguém escapa.
4. **A tela só recarrega com mudança.** A versão da área (`zur_area_versions`) sobe só quando um contato ou avaliação foi gravado ou apagado, nunca pela linha de estado da sincronização. A contagem regressiva sai do `nextSyncAt` que a tela já tem.
5. **Mudou a lista de campos, uma leitura completa.** O `syncToken` vale para um conjunto de campos; ao acrescentar campos, a primeira leitura depois do deploy é completa (`full_needed = 1`), em partes de 10 páginas por despertar, e as seguintes voltam a ser só do que mudou.

### Campos vazios e falhas que a ficha antecipa

| Caso no Google | O que a Zuri faz |
| --- | --- |
| Sem nome | Mostra o 1º telefone, senão o 1º e-mail, senão "Sem nome"; avatar com ícone |
| Sem telefone | Ligar e WhatsApp desligados com "Sem telefone"; o resto funciona |
| Telefone em formato estranho | Mostra como veio; WhatsApp só para celular brasileiro reconhecido |
| E-mail inválido | Mostra como texto, sem link de e-mail |
| Aniversário sem ano, ou só com ano | Mostra dia e mês; só ano fica fora dos lembretes |
| Endereço com partes faltando | Junta só as partes presentes; endereço só com `formattedValue` usa ele |
| Campo com texto enorme | Corta em 2.000 caracteres (observações) e 200 nos demais |
| Mais de 10 itens num campo | Guarda os 10 primeiros e avisa "e mais N no Google" |
| Campo novo que o Google criar | Ignorado pelo schema; não quebra a leitura |
| Contato apagado no Google | Some na próxima leitura, como hoje |

### Rotas e contratos

- `GET /api/contacts/status` e `GET /api/reviews/status` ganham `nextSyncAt` (ISO) e `lastResult` (`unchanged` \| `changed` \| `failed`).
- `GET /api/reviews/metrics?period=…` → `{ period, ratings: [n5,n4,n3,n2,n1], byBucket: [{ key, promoters, neutrals, detractors }], replied, medianReplyMinutes, requests: { sent, opened, reviewed } }`. Só números. (Como ficou na PR S11: `byBucket` virou `buckets`, `requests` vem `null` até existirem pedidos, e a migration 35 criou um índice. Veja "Diferenças da S11" em [implementacao-frontend-sinal.md](implementacao-frontend-sinal.md).)
- `POST /api/contacts/sync` e `POST /api/reviews/check`: 1 por minuto; 429 `RATE_LIMITED` com `retryAfter`.

### Banco

Nenhuma migration: os campos novos vão no JSON `data` de `zur_contacts`; as métricas saem de `zur_reviews` com o índice que já existe por perfil e data (conferir no plano da PR; se faltar, migration de acréscimo só com o índice).

### Agendamentos, IA e integrações externas

Tudo no alarme único (P8). Contatos e Avaliações são agendados com 2 min 30 s de diferença, para não caírem no mesmo despertar e não somarem subrequisições. Nenhuma IA nova: a triagem das avaliações continua só para as avaliações novas.

## 8. Custo e cotas do plano Free

| Cota | Por dia, depois da mudança | Limite Free | Uso |
| --- | --- | --- | --- |
| Despertares do objeto | 288 (contatos) + 144 (avaliações) = 432 | 100.000 pedidos | 0,4% |
| Chamadas ao Google sem novidade | 288 + 24 (etiquetas) + 144 = 456 | People API: 90 leituras por minuto por usuário; Business Profile: 300 por minuto | folga grande |
| Linhas escritas sem novidade | cerca de 6 por despertar (estado + alarme + o que o SDK grava) ≈ 2.600 | 100.000 | 2,6% |
| Subrequisições por despertar | até 14 (contatos) ou 14 (avaliações), nunca juntas | 50 | 28% |
| Neurons | nenhum novo | 9.000 | 0 |

Nenhum recurso pago, nenhum custo fora da Cloudflare.

## 9. Segurança e privacidade

- Continua só leitura no Google; o escopo `contacts.readonly` não muda.
- Campos novos passam por `cleanText`/`cleanBlock` e pelo schema antes de gravar; nada de contato vai para log (P10).
- Endereço, relações e chat entram no prompt só quando o dono pergunta daquele contato, dentro de `<data>`.
- O botão de sincronizar tem limite por minuto, para ninguém usar a sessão para gastar a cota do Google.
- As métricas são só números; nenhum texto de avaliação sai pela rota de métricas.

## 10. Testes

- Unidade: intervalos, espera das falhas, etiquetas por hora, contato sem nome, sem telefone, campos com tamanho e quantidade acima do teto, aniversário sem ano, endereço parcial, índice de recomendação (casos com 0 avaliações, só 4 estrelas, só negativas).
- Orçamento: leitura sem novidade grava zero linhas em `zur_contacts`/`zur_reviews` e não sobe a versão da área.
- Integração (workerd): troca da lista de campos força uma leitura completa e depois volta ao incremental.
- E2e: contagem chega a zero e recomeça (relógio simulado do Playwright), escolher etiquetas, filtro rápido, ficha com campos vazios, Avaliações pelo menu e pela folha "Mais", período das métricas, "Ver em tabela". axe nos dois temas e tamanhos.

## 11. Entrega

| PR | O que entra | Depende de |
| --- | --- | --- |
| 1 · servidor | Intervalos, etiquetas por hora, recarga só com mudança, `nextSyncAt`, limite do botão, campos novos e leitura completa única | — |
| 2 · servidor | Métricas das avaliações | — |
| 3 · interface | Contatos sem Clientes, etiquetas no topo, contagem, ficha completa | PR 1 e a PR G do [novo frontend](novo-frontend-sinal.md) |
| 4 · interface | Área de Avaliações no menu | PR 2 e a PR B (casca) |

## 12. Riscos

- **Leitura completa depois do deploy (campos novos).** Até 5.000 contatos em partes de 10 páginas a cada 5 min: termina em cerca de 25 min. Mitigação: o aviso "Atualizando todos os contatos" na tela até terminar.
- **Google demorar a listar uma avaliação.** Já coberto pela folga de 1 h na marca d'água.
- **Quem desmarca uma etiqueta sem querer perde as cópias.** Mitigação: o diálogo diz quantos contatos saem antes de salvar; marcar de novo traz de volta na próxima leitura.

## 13. Suposições

- O Pablo tem até alguns milhares de contatos nas etiquetas escolhidas (teto de 5.000).
- Um perfil de empresa, com dezenas de avaliações por mês.

## 14. Entrevista com o Pablo

1. A aba Clientes sai e o CRM continua recebendo os eventos em segundo plano? **Resposta do Pablo (10/11, 00:51): não, isso fica para depois.** A aba Clientes sai de Contatos; a parte de clientes será desenhada mais tarde, dentro do menu novo **CRM**. Nada é apagado (regra 5). O recebimento de eventos que já existe na develop fica como está até esse plano; quem decide desligar é o Pablo, pela chave dos eventos em Integrações.
2. O índice de recomendação estimado pelas estrelas (5 recomenda, 4 neutro, 1 a 3 não) serve como o "NPS" do consultório? Recomendação: sim, com o texto explicando a conta. Um NPS de verdade (nota de 0 a 10) pediria uma pergunta própria no pedido de avaliação. **Resposta do Pablo (10/11): sim.** Ele perguntou como saber quem abriu o link. Resposta registrada:

   - **Link pessoal.** Cada pedido leva um endereço curto da própria Zuri com um código aleatório só daquele pedido (`/a/<código>`, tabela `zur_review_links` do [plano do Chatwoot](envio-chatwoot-pela-zuri.md)). Quem toca é levado para a página de avaliação do Google. Nesse caminho, a Zuri anota "abriu" com data e hora. O código não diz nada sobre a pessoa e vale por 30 dias.
   - **Pré-visualização do WhatsApp não conta.** O WhatsApp abre o link sozinho para montar a prévia. A Zuri ignora esse acesso pelo agente de usuário do robô de prévia e só conta a abertura que segue até o Google.
   - **Entregue e lido.** O Chatwoot avisa a situação da mensagem (`message_updated`: enviada, entregue, falhou). "Lido" depende do WhatsApp não oficial repassar o recibo; quando não vem, a Zuri não inventa.
   - **Onde aparece.** Em Avaliações › Pedidos, cada linha mostra Enviado, Entregue, Abriu o link e Avaliou, com a hora. A Visão geral mostra o funil (receberam → abriram → avaliaram). Na ficha do contato, a linha do tempo do pedido.
   - **Limite honesto.** Quem copia o endereço do Google e avalia por outro caminho aparece como "não abriu"; a ligação com a avaliação continua pelas regras da seção 8.1b do desenho das funcionalidades.
