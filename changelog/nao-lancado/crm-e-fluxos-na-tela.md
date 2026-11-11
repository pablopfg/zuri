### Adicionado

- Em Contatos › Clientes, no cartão "Avisos do CRM", você escolhe a hora do aviso de aniversários e quantos avisos de cliente novo quer por dia (de 1 a 20). Os padrões continuam 9 h e 20.
- No cartão dos eventos do n8n, você define quantos eventos a Zuri aceita por hora (de 10 a 300) e por dia (de 50 a 1.000).
- Em CRM › Fluxos, o cartão "Configurações dos fluxos" reúne o que antes era fixo: intervalo mínimo entre execuções (de 5 a 60 minutos), intervalo mínimo com passo de IA (de 30 a 1.440), execuções por dia (de 10 a 500), chamadas por execução (de 5 a 40), uso de IA por dia (de 100 a 3.000 Neurons), tentativas de uma chamada que falhou (de 1 a 3) e falhas seguidas até pausar um fluxo (de 2 a 10). Os padrões são os valores de antes.
- Os fluxos ligados dividem 2.000 horários por dia, e a tela mostra quantos estão ocupados. É isso que deixa o intervalo descer até 5 minutos sem gastar mais do que a cota gratuita já previa: o fluxo que não couber na conta não liga.

### Alterado

- Cada dia tem um aviso de aniversários só, mesmo que a hora mude no meio do dia.
- O que gasta cota (execuções, chamadas, uso de IA, tentativas, eventos) tem como máximo o valor que já era fixo. Você pode baixar, nunca passar dele.
- O selo "Desligado por falhas" de um fluxo segue o número de falhas que você escolheu.
- O backup leva a hora do aviso de aniversários e o número de avisos de cliente novo. Um backup antigo não mexe neles.

### Corrigido

- A tela CRM › Fluxos parava ("Esta tela parou") quando era a primeira tela aberta e havia um fluxo com horário diário ou semanal. Os textos do horário agora chegam junto com a tela.

### Segurança

- Cada mudança nessas configurações fica no registro de atividade, com os nomes dos campos alterados.

### Atualização

- Migration 34: colunas `reminder_time`, `new_client_notices`, `events_per_hour`, `events_per_day` e `reminded_day` em `zur_crm_settings` e a tabela `zur_flow_settings`. Ela é aplicada sozinha na primeira requisição e mantém os valores de hoje.
