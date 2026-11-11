### Adicionado

- Em CRM, no cartão "Avisos do CRM", você escolhe a hora do aviso de aniversários. O padrão continua 9 h.
- Em CRM › Fluxos, o cartão "Configurações dos fluxos" reúne o que antes era fixo: intervalo mínimo entre execuções (de 5 a 60 minutos), intervalo mínimo com passo de IA (de 30 a 1.440), execuções por dia (de 10 a 500), chamadas por execução (de 5 a 40), uso de IA por dia (de 100 a 3.000 Neurons), tentativas de uma chamada que falhou (de 1 a 3) e falhas seguidas até pausar um fluxo (de 2 a 10). Os padrões são os valores de antes.
- Os fluxos ligados dividem 2.000 horários por dia, e a tela mostra quantos estão ocupados. É isso que deixa o intervalo descer até 5 minutos sem gastar mais do que a cota gratuita já previa: o fluxo que não couber na conta não liga.

### Alterado

- As sincronizações do Google (contatos e avaliações) aceitam intervalo a partir de 1 minuto, em vez de 5. Abaixo de 5 minutos, a leitura divide a conta do dia com a outra sincronização e com os fluxos ligados, para não gastar mais do que a cota gratuita já previa: as duas não cabem a cada minuto ao mesmo tempo (1 minuto numa pede 4 ou mais na outra), e a tela avisa quando o intervalo não cabe.
- Cada dia tem um aviso de aniversários só, mesmo que a hora mude no meio do dia.
- O que gasta cota (execuções, chamadas, uso de IA, tentativas) tem como máximo o valor que já era fixo. Você pode baixar, nunca passar dele.
- O selo "Desligado por falhas" de um fluxo segue o número de falhas que você escolheu.
- O backup leva a hora do aviso de aniversários. Um backup antigo não mexe nela.

### Corrigido

- A tela CRM › Fluxos parava ("Esta tela parou") quando era a primeira tela aberta e havia um fluxo com horário diário ou semanal. Os textos do horário agora chegam junto com a tela.

### Segurança

- Cada mudança nessas configurações fica no registro de atividade, com os nomes dos campos alterados.

### Atualização

- Migration 34: colunas `reminder_time` e `reminded_day` em `zur_crm_settings` e a tabela `zur_flow_settings`. Ela é aplicada sozinha na primeira requisição e mantém os valores de hoje.
