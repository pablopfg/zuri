# Plano · Intervalo das sincronizações

Origem: pedido do Pablo em 11/11/2026. Ele quer escolher, em Configurações, de quantos em quantos minutos cada sincronização roda, e quer que uma sincronização sem mudança não regrave o que já está guardado. Antes ele fazia essa comparação com um cache no Redis.

## 1. Resumo

Dois campos novos em Configurações › Integrações › Google: o intervalo dos contatos e o das avaliações, de 5 a 1.440 minutos. A comparação antes de gravar, que a PR S09 (#286) já fazia quase toda, ganha os dois casos que faltavam. Nenhum recurso novo da Cloudflare.

## 2. Contexto no sistema

Sincronizações periódicas que existem hoje:

| O quê | Intervalo antes | Vira configuração |
| --- | --- | --- |
| Contatos do Google (`apps/agent/src/google/contacts.ts`) | 5 min, fixo | Sim |
| Avaliações do Google (`apps/agent/src/reviews/service.ts`) | 10 min, fixo | Sim |
| Lista de etiquetas dos contatos | 1 hora, e ao abrir a escolha | Não: é parte da leitura dos contatos |
| Google Agenda | Não há leitura periódica: o Google avisa a cada mudança | Não se aplica |
| Fluxos, monitor de sites, rotinas, backup | Cada item já tem o horário que o dono escolheu | Já é |

O que a S09 já compara: o Google entrega só as diferenças (`syncToken`), contato com o mesmo `etag` não é regravado, etiqueta igual não é regravada, avaliação com a mesma hora, nota e texto não é regravada, e leitura sem novidade grava 3 linhas de estado fora dos gatilhos de tela.

O que faltava:

1. Contato com `etag` novo e conteúdo igual (o Google muda o `etag` por foto, grupo do sistema ou campo que a Zuri não pede) era regravado inteiro, umas 13 linhas, e a tela recarregava.
2. Avaliação com hora nova e mesmas estrelas e texto era tratada como editada: o rascunho era descartado e a IA escrevia outro.

## 3. Objetivo e critérios de aceite

1. O dono salva o intervalo dos contatos e o das avaliações, em minutos inteiros de 5 a 1.440; fora disso, 400 e nada gravado.
2. Cada leitura que termina bem marca a próxima pelo intervalo do dono.
3. Trocar o intervalo move a próxima leitura para a última mais o novo intervalo, nunca para o passado; nova tentativa depois de falha mantém a hora dela.
4. O estado devolve `syncEveryMinutes`, e a tela mostra o campo, o limite e a hora da próxima leitura.
5. Contato com `etag` novo e conteúdo igual grava só o `etag` e não sobe o número da tela; qualquer mudança no que a Zuri guarda (nome, dados, chave de telefone, etiquetas) regrava.
6. Avaliação só com hora nova guarda a hora e mantém triagem, rascunho e proposta; estrelas ou texto diferentes seguem como edição.
7. Bancos existentes continuam em 5 e 10 minutos depois da migration.

## 4. Escopo

Dentro: os itens acima, testes, documentação. Fora: intervalo da lista de etiquetas, da Agenda e dos itens que já têm horário próprio; os tetos de publicação das avaliações e de Neurons, que não mudam; a reorganização de Configurações em cinco grupos (S16), que só muda o lugar do cartão.

## 5. Como funciona para o Pablo

Em Configurações › Integrações › Google, o bloco Contatos ganha "Sincronizar a cada (minutos)" e o bloco Avaliações ganha "Conferir a cada (minutos)", cada um com "Salvar intervalo" e a linha "Próxima leitura: …". Valor fora de 5 a 1.440 deixa o botão desligado. Salvou: "Intervalo salvo".

## 6. Regras e limites

- Piso de 5 minutos: a conferência das avaliações espera 2 min 30 s depois de uma leitura dos contatos para as duas não dividirem o mesmo despertar. Com menos de 5 minutos nos contatos ela ficaria sem vez.
- Teto de 1.440 minutos (um dia).
- A espera depois de falha do Google segue dobrando de 5 (contatos) e 10 minutos (avaliações) até 6 horas, qualquer que seja o intervalo: o aviso de "Google fora do ar" continua chegando em pouco mais de uma hora.
- Valor fora da faixa numa linha do banco (backup antigo, linha danificada) é lido como o limite mais próximo.

## 7. Desenho técnico

- `packages/shared`: limites em `CONTACT_LIMITS` e `REVIEW_LIMITS`, `syncEveryMinutes` nos estados, `contactSettingsSchema` ganha o campo e `reviewIntervalSchema` é novo.
- Banco: migration 33, `zur_contact_sync.sync_every_min` (padrão 5) e `zur_review_settings.check_every_min` (padrão 10), fora dos gatilhos de área.
- Rotas: `PATCH /api/google/contacts/settings` aceita `syncEveryMinutes`; `PATCH /api/reviews/interval` é nova, com sessão e CSRF, só com as avaliações ligadas (409 desligadas), sem senha recente (não muda o que é publicado), fora da lista dos tokens remotos e fora do modo de bloqueio.
- Comparação: fica no SQLite do próprio objeto. Um cache à parte (KV ou Redis) seria um recurso a mais, com custo e com uma segunda cópia para manter igual; a cópia que já existe é a referência. Contatos: `sameKept` compara nome mostrado, dados, chaves de busca e etiquetas. Avaliações: nota, texto, primeiro nome e anonimato.
- Tela: `SyncIntervalForm.tsx`, usado pelas duas seções, carregado junto com o cartão do Google (fora do JS inicial).

## 8. Custo no plano Free

Pior caso, as duas a cada 5 minutos: 576 despertares por dia, perto de 11.000 linhas gravadas (11% da cota) e 62.000 lidas (1,2%), e 576 chamadas ao Google. O padrão não muda (432 despertares). Contato com `etag` novo e dados iguais: 1 linha em vez de 13. Nada marcado com ⚠️.

## 9. Segurança e privacidade

Entrada validada com Zod (inteiro, faixa fechada, corpo estrito). O intervalo não alcança os tetos de publicação nem o nível das avaliações. Nenhum dado de contato ou avaliação vai para log. Manter o rascunho de uma avaliação só com hora nova não publica nada a mais: a aprovação continua presa à versão (que inclui a hora) e a avaliação é relida no Google antes de publicar. Achado da auditoria (SEC-A6-01, baixo, corrigido): uma edição que só põe um caractere invisível no mesmo texto some na limpeza e passaria por "só a hora mudou"; o texto bruto do Google entra na comparação, e essa edição segue para a equipe sem rascunho. Na aprovação vale a mesma regra: só a hora nova devolve `TARGET_CHANGED` e mantém o rascunho, para o dono aprovar a versão atual.

## 10. Testes

`apps/agent/test/sync-intervals.test.ts` (intervalo, limites n−1/n/n+1, troca, falha, linha danificada, comparação de contato e de avaliação), `google-contacts-routes.test.ts` e `reviews-routes.test.ts` (rotas), `migrations.test.ts` (32 → 33), `free-tier-budget.test.ts` (medidas), e2e em `google-contatos.spec.ts` e `avaliacoes.spec.ts` com axe.

## 11. Riscos

- Outra PR pegar a migration 33 antes: renumerar antes do merge.
- O Pablo querer menos de 5 minutos: pede mudar a regra dos 2 min 30 s entre as duas leituras; fica como pergunta, com a recomendação de manter 5.
- Resposta do Pablo (11/11/2026, 16:44 UTC): mínimo de 1 minuto. Feito na PR das configurações do CRM e dos fluxos, com a conta do dia que mantém a cota (`docs/planos/crm-e-fluxos-na-tela.md`, regra 4). Onde este plano diz "de 5 a 1.440", vale "de 1 a 1.440".
