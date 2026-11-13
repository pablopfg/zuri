<!-- versao: minor -->
### Adicionado

- **CRM › Credenciais** ganhou o tipo **Chatwoot**: endereço, número da conta, chave do agente, caixa de entrada e as duas esperas entre mensagens (envios em massa, de 5 a 600 segundos, padrão 30 a 60; mensagem a uma pessoa, de 1 a 30 segundos, padrão 2 a 5, sempre menor que a dos envios em massa). A caixa de entrada sai da lista que a chave salva enxerga. Nenhuma mensagem sai ainda: a fila de envio vem depois.
- "Nova credencial" pergunta o tipo antes: Chatwoot ou outro serviço (https).
- **Testar**, no menu de cada credencial, faz só uma leitura: no Chatwoot, conta as caixas que a chave enxerga; num serviço, chama o primeiro caminho com GET. Até 5 testes por minuto por credencial.
- A linha da credencial mostra o tipo e o fim da chave ("Chave terminada em 4f2a"), só para chaves de 12 caracteres ou mais.

### Alterado

- Mudar o endereço de uma credencial (ou o tipo de chave) agora pede a chave de novo, em vez de apagar a guardada sem avisar.
- Mudar só as esperas do Chatwoot não pede a senha, mas fica na atividade.

### Segurança

- Cada tipo de credencial cifra a chave com a sua própria derivação: uma chave guardada para o Chatwoot não abre como chave de fluxo, e o contrário também. Um fluxo nunca chama uma credencial do Chatwoot.

### Atualização

- Migration 38: a tabela de credenciais ganha o tipo (`http` para todas as que já existiam), as configurações do tipo e o fim da chave. Nada do que existia muda.
