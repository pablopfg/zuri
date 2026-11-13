<!-- versao: minor -->
### Adicionado

- **CRM › Envios** (`/crm/envios`): a fila de saída das mensagens que as automações mandam aos contatos pelo Chatwoot. Sai uma por vez, com a espera da credencial entre elas, e nada sai duas vezes.
- A situação da fila no topo (Enviando, Lenta, Parada, Pausada por você ou pelo bloqueio), com **Pausar envios**, **Retomar envios** e **Testar a credencial**.
- **Na fila agora**, **Se algo der errado** e o **Histórico** de hoje, 7 ou 30 dias, com a linha do tempo de cada envio e **Tentar de novo** para o que falhou.
- Avisos no sino e no Telegram quando a fila para, quando uma mensagem falha nas 3 tentativas e quando a fila fica 15 minutos sem andar.
- Em **Credenciais**, a linha do Chatwoot mostra quantas mensagens esperam e leva a Envios.

### Alterado

- A base "Envio pelo Chatwoot, com fila" de Automações ficou pronta. A automação de exemplo (só no ambiente local) manda as mensagens dela pela fila.

### Segurança

- Retomar a fila depois de uma parada por falha pede a senha recente. Pausar, retomar e tentar de novo entram no registro de atividade.
- O texto e o telefone de cada mensagem somem quando o envio termina, nunca aparecem na tela nem nas rotas e ficam fora do backup.

### Atualização

- Migration 40: cinco tabelas novas para a fila de envios. Começam vazias e nada do que existia muda.
