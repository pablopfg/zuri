# Plano · Sinais da sincronização da Agenda (E5d)

Situação: aprovado em 13/11/2026 (protótipo v51, item 4 do ajuste 3b, aprovado pelo Pablo às 01:44 UTC; v52–v56 às 12:49 UTC). Uma pergunta ao Pablo (fila sem internet) segue com a recomendação enquanto ele não responde.
Origem: pedido do Pablo em 12/11/2026, à tarde (item 4 de "Ajustes pedidos depois da entrega 3", `docs/planos/sons-menu-e-agenda-editavel.md`)
Dependências: E5a (#329), E5b (#340) e E5c (#344), todas mescladas

## 1. Resumo

Hoje a Agenda tem uma linha discreta, "Em dia com o Google", que só sabe três estados: em dia, salvando e salvo. Quando o Google recusa uma mudança ou a internet cai, o aviso sai num toast e some da tela. A E5d troca a linha por um botão com ícone, cor e nome curto, que diz a situação de agora. O botão abre um painel com o que houve, o que fazer, as últimas mudanças feitas nesta visita e o que cada sinal quer dizer. É só de interface: nenhuma rota nova.

## 2. Contexto no sistema

- Linha de hoje: `Toolbar` em `apps/web/src/pages/agenda/AgendaPage.tsx` (`SYNC_TEXT`, `data-sync`).
- Mudanças: `useEventChanges` em `apps/web/src/pages/agenda/changes.ts`. Uma mudança por vez; em falha, o evento volta ao que era e um toast diz o motivo (`NETWORK`, `TARGET_CHANGED`, `NOT_FOUND`, o resto).
- Leitura: `useQuery(eventsKey(from, to))` com `refetchOnWindowFocus`; `dataUpdatedAt` diz quando o Google respondeu por último.
- Erros do Google: `apps/agent/src/google/errors.ts` (`RATE_LIMITED` para o 429, `CONFLICT` para a conexão revogada).
- Conexão revogada: a Agenda já troca a tela inteira por "Conectar de novo" quando `GET /google` traz `problem` (`web.agenda.problem`).

## 3. Objetivo e critérios de aceite

| Nº | Critério | Origem |
| --- | --- | --- |
| CA1 | A linha vira um botão com ícone, cor e nome curto, e o nome acessível "Sincronização com o Google: {sinal}. Ver detalhes". Cor nunca anda sozinha | protótipo, item 4 |
| CA2 | Sinais: Sincronizado (com a hora da conferência), Salvando…, Salvo no Google, Atualizando…, Sem internet, Falha ao salvar, Mudou no Google, Em pausa e Desatualizada | protótipo |
| CA3 | O painel mostra a situação de agora com o que fazer: Tentar de novo (sem internet, em pausa), Ver o evento (falha, mudou no Google), Atualizar agora (desatualizada e em dia) | protótipo |
| CA4 | "Últimas mudanças" lista até 5 mudanças desta visita, com a hora e se deram certo; sem nenhuma, diz isso | protótipo |
| CA5 | "O que cada sinal quer dizer" explica todos os sinais, mais "Conexão expirou" e "Só leitura" | protótipo |
| CA6 | Sem notícias do Google há mais de 15 minutos, ou com a última leitura falhando, o sinal é Desatualizada | protótipo |
| CA7 | Uma resposta de conexão revogada no meio da visita lê de novo a situação da conta, e a Agenda mostra "Conectar de novo" | protótipo ("Conexão expirou") |
| CA8 | pt-BR e en, teclado, leitor de tela, celular, tema escuro, axe sem violação séria | regras de interface |

## 4. Escopo

**Entra:** o botão, o painel, os estados, textos, testes, documentação e capturas.

**Fica fora (e onde vai parar):**

- Fila de mudanças sem internet: o protótipo mostra a mudança esperando na tela. A entrega mantém o comportamento de hoje (volta e "Tentar de novo"), por segurança, e pergunta ao Pablo (seção 14).
- "2 eventos novos vieram do Google" no histórico: pede comparar leituras, sem ganho para a decisão do dono; fica de fora.
- Vínculo a Contatos, Meet, financeiro e "Agendar" na ficha: entrega própria depois desta.

## 5. Como funciona para o Pablo

1. Na barra da Agenda, o botão mostra "Sincronizado". Ao mover um evento, vira "Salvando…" (girando), depois "Salvo no Google" (verde) por até um minuto e volta a "Sincronizado".
2. Se a internet cai: o evento volta ao que era, o toast diz isso e o botão fica "Sem internet" (âmbar). No painel, "Tentar de novo" manda a mesma mudança.
3. Se o Google recusa: "Falha ao salvar" (vermelho), com o motivo e "Ver o evento".
4. Se o evento mudou no Google: "Mudou no Google" (âmbar), com "Ver o evento"; a tela já lê a versão de lá.
5. Se o Google pede um intervalo (429): "Em pausa", com "Tentar de novo".
6. Sem leitura há mais de 15 minutos, ou com a leitura falhando: "Desatualizada", com "Atualizar agora".
7. O próximo envio que dá certo limpa o problema.

## 6. Regras de negócio e limites

- Prioridade do sinal: Salvando… > problema da última mudança > Atualizando… > Desatualizada > Salvo no Google (por até um minuto, como a linha de hoje) > Sincronizado.
- Desatualizada: `dataUpdatedAt` com mais de 15 minutos, conferido com o relógio de meio minuto da tela.
- O histórico fica só na memória da tela: some ao sair da Agenda. Até 5 linhas.

## 7. Desenho técnico

- `changes.ts`: `useEventChanges` devolve também `problem` (`offline`, `failed`, `changed`, `paused`, com o evento e a nova tentativa) e `log`. `CONFLICT` invalida `GOOGLE_STATUS_KEY`.
- `SyncSignal.tsx` (novo, na pasta da Agenda): `syncKind(...)` puro, o botão e o painel (`Dialog`).
- `AgendaPage.tsx`: o `Toolbar` recebe o sinal e o botão no lugar da linha. Marcar, apagar e criar um evento também entram em "Últimas mudanças", e um `CONFLICT` em qualquer pedido da Agenda (inclusive a leitura) lê de novo a situação da conta.

## 8. Custo e cotas do plano Free

- Sem rota nova, sem migration, sem escrita no banco. "Atualizar agora" é a mesma leitura de `/google/events` que o foco na aba já faz.
- JS inicial: a Agenda é carregada sob demanda. Medir com `npm run size` (teto 141,1 kB).

## 9. Segurança e privacidade

- Sem superfície nova. O título do evento e o motivo do erro entram como texto do React.

## 10. Testes

- Unitário: `syncKind` com cada prioridade e o limite de 15 minutos (n−1, n, n+1).
- e2e (`tests/e2e/agenda-sinais.spec.ts`): sinal em dia e painel com axe; salvar e ver "Salvo no Google" e o histórico; falha de rede com "Tentar de novo"; recusa do Google com "Ver o evento"; 409 de evento mudado; 429 em pausa; leitura antiga ou falhando como Desatualizada e "Atualizar agora"; conexão revogada; celular e inglês.

## 11. Entrega

Uma PR para a `develop`, com fragmento de changelog, README e `docs/google-agenda.md`, e capturas do botão e do painel.

## 12. Riscos

- O relógio de meio minuto da tela faz Desatualizada aparecer até 30 s depois dos 15 minutos. Aceito.

## 13. Suposições

- "Em pausa" sem tentativa automática: com a decisão 0 da seção 14, nada fica esperando; o dono tenta de novo.

## 14. Entrevista com o Pablo

1. Sem internet, a mudança espera numa fila (protótipo) ou volta ao que era com "Tentar de novo"? Recomendação: voltar, porque a fila pode gravar por cima de uma mudança feita no Google enquanto a internet estava fora. Pergunta feita em 13/11/2026; a entrega segue a recomendação até a resposta.
