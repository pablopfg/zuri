### Adicionado

- CRM › Credenciais ganha o tipo **fzap (Pix pelo WhatsApp)**: o endereço https da instância e o token dela, cifrado e só de escrita. **Testar** lê o estado da sessão e diz se a instância está conectada e se está no modo WhatsApp Web, o único em que o Pix funciona. O envio do Pix chega com "Enviar Pix".

### Segurança

- O token da fzap fica num cofre com chave própria do tipo, nunca volta para a tela e nenhum fluxo pode usá-lo. Criar ou mudar a credencial pede a senha recente e gera aviso de segurança; trocar o endereço pede o token de novo.
