### Adicionado

- Você escolhe de quantos em quantos minutos a Zuri lê os contatos e as avaliações do Google, em Configurações › Integrações › Google: os campos "Sincronizar a cada (minutos)" e "Conferir a cada (minutos)", de 5 a 1.440 (um dia). O cartão mostra a hora da próxima leitura. Os padrões continuam 5 e 10 minutos.

### Alterado

- Um contato que o Google marca como alterado por algo que a Zuri não guarda (a foto, um grupo do próprio Google) é comparado com a cópia e não é mais regravado, nem faz a tela recarregar.
- Uma avaliação em que só a hora mudou no Google, com as mesmas estrelas e o mesmo texto, mantém a triagem e o rascunho. Antes, o rascunho era descartado e escrito de novo.

### Atualização

- Migration 33: colunas `sync_every_min` em `zur_contact_sync` e `check_every_min` em `zur_review_settings`. Ela é aplicada sozinha na primeira requisição e mantém os intervalos de hoje.
