### Adicionado

- **Configurações › Chatwoot**: converse com a Zuri por uma caixa só sua no Chatwoot. A Zuri cria sozinha a caixa "Zuri" (tipo API, com assinatura e HMAC obrigatória), deixa só você como membro, cria o contato e a conversa e mostra um código de vínculo no app. Você responde o código na conversa, com a sua conta de atendente, e confirma no app.
- A Zuri responde só à sua conta. Se outra pessoa escreve na conversa, ela não responde, não lê o texto e avisa você; três vezes em 24 horas desligam o canal.
- **Testar configuração** confere o endereço, a caixa, a HMAC, a conversa e a assinatura do retorno. O **teste completo** também confere o endereço de retorno, os membros e quem mais é administrador.
- **Reparar**, **Trocar os segredos**, **Conectar outra conta** e **Desligar e esquecer**. Se a conversa ou o contato somem no Chatwoot, a Zuri abre outra conversa sozinha, até 3 vezes por dia.
- A página explica o que cada tipo de chave do Chatwoot pode e qual a Zuri usa.
- Trava de leitura, igual à do bot do Telegram: depois das mesmas horas sem uso, a Zuri só responde com um link para destravar no app, por 12 horas.
- Integrações mostra o estado do Chatwoot e leva à página dele.

### Segurança

- A chave de administrador só passa pelo pedido que a usa (configurar, teste completo, reparar e trocar os segredos) e nunca fica guardada. Fica guardado, cifrado com derivação própria, só o identificador da caixa, os segredos dela e o contato.
- O endereço de retorno leva um token derivado do segredo da sessão, conferido no Worker antes de chegar ao objeto. A assinatura de cada aviso é conferida com o segredo da caixa (até 5 minutos de diferença), cada mensagem vale uma vez (pelo id dela, que vai assinado), e a mensagem é lida de novo no Chatwoot: o corpo do aviso nunca decide quem escreveu nem o que escreveu.
- O código de vínculo aparece só no app, nunca na conversa, que todo administrador da conta lê.
- Configurar, confirmar a conta, ligar de novo, destravar, reparar, trocar os segredos e desligar e esquecer pedem a senha digitada há pouco. Confirmar, destravar, reparar e trocar os segredos ficam na atividade de acesso com aviso de segurança.
- Até 30 mensagens por hora, como no Telegram. No modo de bloqueio, o canal fica mudo em qualquer estado.
