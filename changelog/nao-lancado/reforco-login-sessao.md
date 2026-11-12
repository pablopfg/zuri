### Segurança

- **Sessão presa a onde foi aberta.** Copiar o cookie da sessão não basta mais. Se o pedido vier de outro navegador ou de outro país, a Zuri encerra a sessão e avisa você. Se só a rede mudar (do Wi-Fi para os dados do celular, por exemplo), a sessão continua, a mudança aparece em Acessos e as ações sensíveis pedem a senha de novo naquela rede. Rede que a Zuri ainda não conhecia gera um aviso de segurança. Uma sessão aceita até 5 redes.
- **Teto diário de senhas erradas.** 5 senhas erradas em 24 horas bloqueiam aquela rede até a mais antiga completar um dia. As redes em que você entrou nos últimos 30 dias ficam de fora, então errar a senha em casa não tranca você.
- **Sem acesso por token.** A Zuri não aceita mais nenhum pedido com token: só o navegador com a sua sessão entra. Qualquer pedido com o cabeçalho `Authorization` recebe 401.

### Alterado

- Saíram o cartão **Acesso remoto** de Configurações › Segurança, as rotas `/api/remote` e o comando `/tokens` do bot do Telegram (o menu do bot é atualizado sozinho).

### Atualização

- Migration 36 (`session_binding`): quatro colunas novas em `zur_sessions`. Só acréscimo. Sessões abertas antes da atualização são encerradas no primeiro pedido: é só entrar de novo.
- As tabelas `zur_remote_tokens` e `zur_remote_failures` ficam no banco, sem uso. Tokens criados antes deixam de funcionar.
- ⚠ Se algum script ou automação sua usava um token `zur_pat_`, ele para de funcionar com esta versão.
