# Plano · S22, sugestões do Início pelo dia real (P5)

## 1. Resumo

As três ideias fixas embaixo do campo do Início viram até três sugestões tiradas do dia do Pablo: o que atrasou, a conta para pagar hoje, a avaliação esperando resposta, a semana na segunda e a pergunta certa para a hora. Regras fixas escolhem; os toques e, uma vez por dia, a IA só mudam a ordem. A IA nunca escreve o texto: devolve ids de um catálogo fechado, conferidos por Zod. Tocar numa sugestão só preenche o campo.

Base: [sugestoes-do-inicio.md](sugestoes-do-inicio.md) (resposta do Pablo de 10/11, 00:51: a IA só escolhe e ordena) e a função `sugestoes()` do protótipo.

## 2. Contexto no sistema

- Início: `apps/web/src/pages/home/HomeBody.tsx` (`Ask`), textos em `packages/shared/i18n/pt-BR-home.ts`.
- Tarefas: `zur_tasks` com o índice de abertas por prazo; avaliações: `zur_reviews` (`first_name`, `anonymous`, `rating`, `state`).
- Especialistas: `apps/agent/src/specialists/contract.ts` (`runSpecialist`, `<data>`, JSON por Zod); perfis em `packages/shared/src/agents.ts`.
- Teto diário de Neurons: `usage.room(aiLimits())` em `zuri-agent.ts` (P7).

## 3. Objetivo e critérios de aceite

| # | Critério | Teste |
| --- | --- | --- |
| CA1 | Muda com a hora: hoje de manhã, o que falta à tarde, amanhã à noite; semana na segunda e domingo à noite | `home-suggestions.test.ts` › follows the hour, week |
| CA2 | Atraso, conta (meia hora antes do prazo, só se ainda à frente) e avaliação esperando (nota baixa primeiro) | `home-suggestions.test.ts` › late and bill, bill passed, review; `reviews-home.test.ts` |
| CA3 | No máximo 3, sem repetir, até 48 caracteres; nomes neutralizados e cortados em 20 | `home-suggestions.test.ts` › at most three |
| CA4 | Nenhum texto da IA na tela: texto livre, link, id inventado, repetido ou mais de 6 é descartado | `home-suggestions.test.ts` › drops an answer (7 casos); e2e › blanks as data |
| CA5 | Sem IA (sem cota, bloqueio, modelo pago, falha) as regras funcionam; falha não tenta de novo no dia | `home-suggestions.test.ts` › never tries again |
| CA6 | Tocar preenche o campo, põe o foco e não envia | e2e `nova-ui.spec.ts` › fills the field |
| CA7 | Toque conta só o tipo, uma vez por minuto; 14 dias sem toque tiram um ponto | `home-suggestions.test.ts` › taps; `home-routes.test.ts` |
| CA8 | Custo medido | `free-tier-budget.test.ts` › home page's suggestions |

## 4. Escopo

Dentro: catálogo de 7 tipos (`late`, `bill`, `review`, `week`, `today`, `rest`, `tomorrow`), regras, contador por tipo, ordem diária pela IA, `GET /api/home/suggestions`, `POST /api/home/suggestions/:id/used`, interface do Início e o agente "Sugestões do Início" em Configurações › Assistente.

Fora: "Ideias de presente" e "Resumo da semana" (não estão no protótipo), chave "Sugestões no Início" e "Esquecer o que aprendi" (não estão no protótipo; ver seção 11), sugestões em outras telas.

## 5. Como funciona para o Pablo

Nada para configurar. Até três sugestões embaixo do campo; tocar copia o texto para o campo e o cursor fica nele. Enquanto carregam, o espaço fica guardado; com erro, a linha some e o resto do Início segue.

## 6. Regras de negócio e limites

| Tipo | Quando | Prioridade |
| --- | --- | --- |
| `late` | Tarefa aberta com prazo passado | 1 |
| `bill` | Tarefa "Pagar …"/"Pay …" com prazo hoje e o lembrete (prazo − 30 min) ainda à frente | 2 |
| `review` | Avaliação esperando o Pablo, nota mais baixa primeiro, só o primeiro nome | 2 |
| `week` | Segunda o dia todo, domingo a partir das 18:00 | 3 |
| `today`/`rest`/`tomorrow` | Antes das 12, até as 18, depois | 4 |

Ordem: prioridade − toques/2 (até 6 toques, um sai a cada 14 dias sem toque) − bônus da IA (até meio ponto pelo lugar na ordem dela); empate pela ordem do catálogo.

## 7. Desenho técnico

| Arquivo | O que tem |
| --- | --- |
| `packages/shared/src/home-suggestions.ts` | Ids, tetos, tipos da resposta e schema da resposta da IA |
| `apps/agent/src/home/suggestions.ts` | Regras, contador, ordem do dia |
| `apps/agent/src/specialists/home-order.ts` | Regras fixas do agente `home_order` |
| `apps/agent/src/api/home.ts` | As duas rotas |

Sem migration: contador e ordem do dia são duas linhas de `zur_settings` (`home_suggestion_uses`, `home_suggestion_order`), fora do backup, como o catálogo da S21.

## 8. Custo e cotas do plano Free

Leitura comum: 9 linhas, nada gravado. Primeira leitura do dia: até 45 linhas lidas e 6 gravadas (marca do dia antes da chamada, chamada curta de até 60 Neurons em segundo plano com contagens limitadas a 20). Toque: 1 escrita, no máximo uma por minuto por tipo.

## 9. Segurança e privacidade

A IA recebe só contagens e ids em linhas `<data>`: nenhum título, nome ou texto do Pablo. A resposta passa por Zod estrito. Nomes nas lacunas passam por `neutralize` e corte de 20 caracteres; a tela usa texto, nunca HTML. Bloqueio, modelo pago ou falta de folga no teto: só as regras.

## 10. Testes

Unidade com relógio fixo, rotas, orçamento e e2e (preencher sem enviar, lacunas como texto, erro sem sugestões, axe).

## 11. Entrega

Uma PR. As diferenças em relação ao plano antigo ficam em "Diferenças da S22" no plano do Sinal.
