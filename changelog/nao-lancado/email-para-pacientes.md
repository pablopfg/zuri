### Adicionado

- Configurações › Integrações ganha **E-mail para pacientes**: o e-mail sai pelo seu Gmail (só a permissão de enviar, sem senha guardada) ou pelo servidor SMTP de outro provedor (465 ou 587, sempre com TLS). Dá para escolher o nome do remetente e o "Responder para", ver como o paciente recebe e mandar um teste para você. Até 100 e-mails por dia. A confirmação de consulta por e-mail chega numa próxima entrega.

### Segurança

- A senha de app fica cifrada, presa ao servidor e ao usuário, e nunca volta para a tela. Mudar para onde o e-mail sai pede a senha recente e gera aviso de segurança. Servidor com IP ou de rede interna é recusado, e a senha nunca sai antes do TLS.

### Atualização

- A migration 44 cria a tabela do e-mail para pacientes. Nada muda nos dados que já existem.
