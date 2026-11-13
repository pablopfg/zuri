// What only the server says about the owner's conversation in the Chatwoot: the lines
// Zuri writes there, the notices and the API errors. Never in the interface's download (rule P11).
export const ptBRChatwootServer = {
  // What Zuri writes in the "Zuri" conversation (plain text, as the contact).
  "chatwoot.owner.codeMessage": "Para conectar, responda aqui, com a sua conta, o código que aparece no app da Zuri. Ele vale por {minutes} minutos.",
  "chatwoot.owner.codeReceived": "Código recebido. Confirme no app da Zuri para eu começar a responder por aqui.",
  "chatwoot.owner.test": "Teste da configuração. Pode ignorar esta mensagem.",
  "chatwoot.owner.busy": "Ainda estou respondendo a mensagem anterior. Mande esta de novo em um instante.",
  "chatwoot.owner.limit": "Chegamos a {n} mensagens nesta hora, o limite daqui. Continue no app ou no Telegram.",
  "chatwoot.owner.long": "A mensagem passou de {n} caracteres. Divida em partes menores.",
  "chatwoot.owner.failed": "Não consegui responder agora. Tente de novo em instantes.",
  "chatwoot.owner.timeout": "A resposta demorou demais e parou. Tente de novo com um pedido menor.",
  "chatwoot.owner.stopped": "A resposta foi interrompida no app.",
  "chatwoot.owner.pending": "Isso precisa da sua aprovação, que acontece no app ou no Telegram: {link}",
  "chatwoot.owner.truncated": "A resposta continua no app: {link}",
  "chatwoot.owner.recreated": "A conversa anterior sumiu, então abri esta. Pode escrever aqui.",

  // Notices.
  "notice.chatwoot.stranger.title": "Alguém que não é você escreveu na conversa Zuri do Chatwoot",
  "notice.chatwoot.stranger.body": "A Zuri não respondeu nem leu o texto. Três mensagens assim em 24 horas desligam a conversa. Veja em Configurações › Chatwoot.",
  "notice.chatwoot.recreated.title": "A conversa Zuri do Chatwoot foi aberta de novo",
  "notice.chatwoot.recreated.body": "A conversa ou o contato Zuri sumiram no Chatwoot, e a Zuri abriu outra conversa na mesma caixa. Ela continua respondendo só a você.",
  "notice.chatwoot.paused.title": "A Zuri parou de responder no Chatwoot",
  "notice.chatwoot.paused.body": "Algo mudou na caixa Zuri do Chatwoot. Abra Configurações › Chatwoot para ver o motivo e o que fazer.",
  "notice.security.chatwoot_owner_linked.title": "Conversa com a Zuri no Chatwoot ligada",
  "notice.security.chatwoot_owner_linked.body": "A Zuri passou a responder a uma conta de atendente do Chatwoot. Se não foi você, desligue em Configurações › Chatwoot e troque a senha.",
  "notice.security.chatwoot_owner_changed.title": "Caixa da Zuri no Chatwoot mudada",
  "notice.security.chatwoot_owner_changed.body": "Os segredos da caixa Zuri foram trocados ou a caixa foi reparada. Se não foi você, desligue em Configurações › Chatwoot e troque a senha.",
  "notice.security.chatwoot_owner_unlocked.title": "Leitura da Zuri no Chatwoot destravada",
  "notice.security.chatwoot_owner_unlocked.body": "A Zuri volta a responder na caixa do Chatwoot por 12 horas. Se não foi você, desligue em Configurações › Chatwoot e troque a senha.",

  // Errors.
  "error.chatwootOwner.step": "O Chatwoot não aceitou um dos passos. Veja o motivo na tela.",
  "error.chatwootOwner.notAdmin": "Esta chave não é de administrador da conta. Use a chave de um administrador.",
  "error.chatwootOwner.notYou": "A chave mudou de dono no meio da configuração. Comece de novo.",
  "error.chatwootOwner.exists": "O Chatwoot já está configurado. Use Reparar ou Desligar e esquecer.",
  "error.chatwootOwner.testing": "Já tem um teste rodando. Espere ele terminar.",
  "chatwoot.owner.locked": "A leitura está travada: passaram {hours} h sem uso. Destrave no app para eu voltar a responder: {link}",
  "error.chatwootOwner.missing": "O Chatwoot ainda não está configurado.",
  "error.chatwootOwner.sealed": "A Zuri não consegue abrir o acesso guardado da caixa. Desligue e configure de novo.",
  "error.chatwootOwner.state": "Esta ação não vale agora. Atualize a página.",
  "error.chatwootOwner.repairFirst": "Antes de ligar, toque em Reparar ou no botão do aviso da pausa.",
} as const;
