// The pt-BR texts of the parts of the signed-in frame that come on demand: the
// password confirmation before a sensitive change (also on the lockdown screen),
// the two-step reminder, the account panel and the theme choice. Most visits
// show none of them, so they stay out of the first load (rule P11).
export const ptBRShell = {
  "web.confirm.title": "Confirme que é você",
  "web.confirm.body": "Para mudar algo sensível, digite a sua senha de novo. A confirmação vale por 15 minutos.",
  "web.confirm.submit": "Confirmar",
  "web.confirm.useCode": "Usar o código do aplicativo",
  "web.confirm.usePassword": "Usar a senha",
  "web.mfaReminder.body": "A verificação em duas etapas está desligada. Ligue para proteger a sua conta.",
  "web.mfaReminder.short": "Duas etapas desligadas",
  "web.mfaReminder.action": "Ligar agora",
  "web.mfaReminder.later": "Dispensar por {days} dias",
  "web.account.profile": "Conta e perfil",
  "web.account.security": "Segurança",
  "web.account.notices": "Avisos",
  "web.account.version": "Versão",
  "web.theme.label": "Tema",
  "web.theme.system": "Como o sistema",
  "web.theme.light": "Claro",
  "web.theme.dark": "Escuro",
} as const;
