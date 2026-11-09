# Plano · Sugestões do Início a partir do uso real

Situação: plano. Pedido do Pablo em 09/11/2026, 22:08: as sugestões embaixo da caixa do Início ("Organizar a semana", "O que tenho amanhã?", "Me lembre de pagar a luz") devem mudar conforme o uso e a demanda reais, se possível com a IA.

## 1. Resumo

Dá, e com segurança, se a IA **escolher** em vez de **escrever**. A recomendação:

1. **Regras fixas, a cada abertura do Início, sem IA.** A Zuri olha o que já sabe (tarefas atrasadas, conta para pagar hoje, agenda de amanhã, avaliação esperando, dia da semana e hora) e monta até 3 sugestões a partir de um catálogo fechado de frases com lacunas. Custo zero de Neurons, resposta instantânea, nada inventado.
2. **O uso ensina a ordem.** Cada vez que o Pablo toca numa sugestão, a Zuri conta um ponto para aquele **tipo** de sugestão (nunca guarda o texto). Tipos mais usados sobem; tipos ignorados por 14 dias descem.
3. **A IA entra uma vez por dia, dentro do resumo da manhã que já roda.** Ela recebe a lista de tipos possíveis e o contexto do dia (dentro de `<data>`) e devolve só **ids do catálogo e a ordem**, num JSON validado por Zod. Nunca texto livre para a tela.

Tocar numa sugestão só preenche a caixa. Nada é enviado nem feito sem o Pablo apertar Enter, como hoje.

## 2. Contexto no sistema

- Início: `apps/web/src/pages/HomePage.tsx` e `pages/home/HomeBody.tsx`; as três frases hoje são fixas no catálogo de i18n.
- Dados que já existem: tarefas e prazos (`productivity`), agenda (`google/events.ts`), avaliações (`reviews`), aniversários (`contacts`), conversas recentes.
- Rotinas com IA no alarme único; resumo da manhã já chama a IA uma vez por dia (etapa 10).
- Regra 4 do `AGENTS.md`: conteúdo guardado entra no prompt como dado.

## 3. Objetivo e critérios de aceite

1. As sugestões mudam com o dia e a hora: de manhã "Organizar a semana" (segunda) ou "O que tenho hoje?", à tarde "O que falta para hoje?", à noite "O que tenho amanhã?".
2. Com tarefa atrasada, aparece "Reagendar o que atrasou"; com conta para hoje, "Me lembre de pagar a luz às 17:30" (hora meia hora antes do prazo); com avaliação de nota baixa, "Responder a avaliação do Pedro".
3. No máximo 3, sem repetir, sem texto acima de 48 caracteres.
4. Nenhum texto escrito pela IA aparece na tela. Teste: resposta da IA com texto livre, link ou id fora do catálogo é descartada e valem as regras.
5. Sem IA (cota batida, modelo fora, bloqueio), as regras sozinhas funcionam.
6. Tocar preenche a caixa e põe o foco nela; nada é enviado.

## 4. Escopo

Dentro: catálogo de tipos, regras, contador por tipo, ordenação diária pela IA no resumo da manhã, rota de leitura, interface.

Fora: sugestões em outras telas, sugestões que executam algo, texto livre gerado pela IA.

## 5. Como funciona para o Pablo

Nada para configurar. Embaixo da caixa do Início aparecem até 3 sugestões do dia. Em Configurações › Conta, uma chave "Sugestões no Início" liga e desliga (ligada por padrão) e "Esquecer o que aprendi" zera os contadores.

### Textos visíveis

Catálogo `pt-BR-home.ts` (e `en`), com lacunas preenchidas pelo servidor a partir de dados já escapados: "Organizar a semana", "O que tenho hoje?", "O que falta para hoje?", "O que tenho amanhã?", "Reagendar o que atrasou", "Me lembre de pagar {conta} às {hora}", "Responder a avaliação de {nome}", "Ideias de presente para {nome}", "Resumo da semana". Nomes e títulos vêm dos dados do Pablo e são cortados em 20 caracteres.

## 6. Regras de negócio e limites

| Tipo | Quando aparece | Prioridade base |
| --- | --- | --- |
| `late` Reagendar o que atrasou | Há tarefa atrasada | 1 |
| `bill` Me lembre de pagar {conta} | Tarefa de pagar com prazo hoje, mais de 30 min à frente | 2 |
| `week` Organizar a semana | Segunda ou domingo à noite | 3 |
| `today` / `rest` / `tomorrow` | Pela hora (antes das 12, até as 18, depois) | 4 |
| `review` Responder a avaliação | Avaliação esperando, nota baixa primeiro | 2 |
| `gift` Ideias de presente | Aniversário de contato nos próximos 14 dias | 5 |
| `summary` Resumo da semana | Sexta à tarde | 5 |

Ordem final: prioridade base, ajustada pelo uso (cada toque soma, cada 14 dias sem toque subtrai) e pela ordem da IA quando houver. Contadores: no máximo 1 escrita por toque, agrupada (P4).

## 7. Desenho técnico

| Arquivo | O que tem |
| --- | --- |
| `packages/shared/src/home-suggestions.ts` | Ids do catálogo, schema da resposta da IA (`{ order: SuggestionId[] }`, até 6) e dos parâmetros |
| `apps/agent/src/home/suggestions.ts` | Regras, preenchimento das lacunas, ordenação |
| `apps/agent/src/api/home.ts` | `GET /api/home/suggestions` → `[{ id, text }]` (até 3); `POST /api/home/suggestions/:id/used` (204) |
| Migration de acréscimo | `zur_suggestion_stats(id TEXT PRIMARY KEY, uses INTEGER, last_used_at INTEGER)`, no máximo uma linha por tipo |
| Resumo da manhã | Uma chamada a mais **dentro** da mesma rotina, só se sobrar cota, com saída JSON curta |

### Por que a IA não escreve o texto

A IA lê tarefas, agenda e avaliações, e qualquer um desses pode trazer texto de terceiros (uma avaliação, um título de evento recebido). Se ela escrevesse a frase da tela, um texto plantado poderia virar uma sugestão enganosa ("Me lembre de mandar a senha para…"). Escolhendo só ids de um catálogo fechado, o pior caso é uma ordem ruim.

## 8. Custo e cotas do plano Free

Regras: nenhum Neuron, uma leitura agregada ao abrir o Início (as mesmas consultas do "Seu dia"). IA: no máximo uma chamada curta por dia dentro do resumo da manhã, cerca de 20 a 40 Neurons, só se houver folga no teto diário. Escritas: 1 por toque numa sugestão.

## 9. Segurança e privacidade

- Nenhum texto livre da IA na tela; saída validada por Zod; id fora do catálogo descartado.
- Lacunas preenchidas no servidor com dados já limpos e cortados; a tela usa texto, nunca HTML.
- Contadores guardam só o tipo, nunca o texto nem o assunto.
- No bloqueio, só as regras rodam.

## 10. Testes

- Unidade: cada regra com relógio fixo (manhã, tarde, noite, segunda, sexta), limite de 3, corte de 48 caracteres, contadores.
- Segurança: resposta da IA com texto, HTML, link, id inventado ou mais de 6 itens é ignorada.
- E2e: tocar preenche a caixa e não envia; desligar a chave some com as sugestões. axe.

## 11. Entrega

Uma PR de servidor e interface juntas, depois da PR C (Início) do [novo frontend](novo-frontend-sinal.md).

## 12. Entrevista com o Pablo

1. A IA só escolhe e ordena, sem escrever o texto? Recomendação: sim, pelo motivo da seção 7.
