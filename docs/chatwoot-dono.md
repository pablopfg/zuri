# Chatwoot do dono

Converse com a Zuri pelo seu Chatwoot, como no Telegram. A Zuri cria uma caixa
só dela na sua conta e responde só à sua conta de atendente. Pacientes e outros
atendentes nunca recebem resposta, e a Zuri não entra na caixa do WhatsApp nem
lê as conversas de lá.

## Configurar

Em **Configurações › Chatwoot**, toque em **Configurar** e informe:

- o endereço do Chatwoot, só o domínio com `https://` (por exemplo,
  `https://chat.exemplo.com.br`);
- o número da conta, que aparece no endereço (`/app/accounts/1/…`);
- a sua chave de acesso, em **Perfil › Chave de acesso** no Chatwoot. Ela
  precisa ser de administrador da conta.

A Zuri mostra de quem é a chave ("Esta conta é você?"). Se for você, ela:

1. cria a caixa "Zuri", do tipo API, com o endereço de retorno da Zuri, assinatura
   e HMAC obrigatória, sem saudação nem pesquisa de satisfação;
2. deixa só você como membro da caixa;
3. cria o contato "Zuri" e a conversa, pela API pública da caixa;
4. avisa na conversa que vai chegar um código (o código em si aparece só no app);
5. descarta a chave de administrador.

Se um passo falha, a Zuri desfaz o que criou e diz o motivo. Depois, abra a
caixa "Zuri" no Chatwoot, responda com a sua conta o código que o app mostra (vale 10 minutos) e
toque em **Confirmar esta conta** no app. A partir daí, escreva na conversa
"Zuri" como no Telegram.

## O que cada chave pode

| Chave | O que ela pode | Uso na Zuri |
| --- | --- | --- |
| Administrador (a sua) | Cria caixas, muda membros, lê os segredos da caixa | Só na configuração, no teste completo, em Reparar e para trocar os segredos. Nunca fica guardada |
| Atendente | Só vê as caixas em que a pessoa é membro | Não serve para configurar |
| Bot (Agent Bot) | Mexe em conversas e envia mensagens | Não é preciso |
| Plataforma (Super Admin) | Cria contas e usuários na instalação inteira | Nunca |
| Identificador da caixa + HMAC do contato | Escreve e lê como o contato "Zuri", só na caixa "Zuri" | É o que fica guardado, cifrado |

## Teste e manutenção

- **Testar configuração** confere se o Chatwoot responde por https sem
  redirecionamento, se a caixa existe, se a HMAC é obrigatória, se a conversa
  continua lá e se o aviso de uma mensagem de teste volta com a assinatura
  certa (espera até 30 segundos).
- **Teste completo** pede a chave de administrador de novo e também confere o
  endereço de retorno, os membros da caixa, se você ainda é administrador e
  quem mais é administrador (eles veem todas as caixas).
- **Trocar os segredos** pede ao Chatwoot um segredo de assinatura e um token de
  HMAC novos. Os antigos param de valer na hora.
- **Reparar** confere a caixa, o retorno, os membros, o contato e a conversa e
  refaz só o que falta. Serve também quando o endereço do Chatwoot mudou.
- **Conectar outra conta** mostra um código novo no app; até você confirmar a
  conta nova, a Zuri não responde a ninguém.
- **Destravar por 12 horas** aparece quando a trava de leitura fechou (veja
  abaixo) e pede a sua senha.
- **Desligar e esquecer** apaga o que a Zuri guardou. A caixa "Zuri" fica no
  Chatwoot: apague lá se quiser.

## Quando algo some ou muda

| O que houve | O que acontece |
| --- | --- |
| Conversa ou contato "Zuri" apagados | A Zuri abre outra conversa e avisa você, até 3 vezes por dia |
| Caixa apagada ou endereço mudou | O canal pausa; toque em Reparar |
| Segredos trocados no Chatwoot ou HMAC desligada | O teste pausa o canal; toque em Trocar os segredos ou Reparar |
| Outra pessoa escreveu na conversa | Sem resposta e um aviso, sem o texto; três vezes em 24 horas pausam o canal |
| Você trocou o número do celular | Nada muda: você conversa pelo Chatwoot, na sua conta |

## Limites

Até 30 mensagens por hora, como no Telegram (passou disso, a Zuri avisa uma vez
por hora), e 8.000 caracteres por mensagem. A resposta vai em
até 3 blocos de 4.000 caracteres; o resto fica na conversa do app. O que precisa
de aprovação você aprova no app ou no Telegram, nunca pelo Chatwoot. No modo de
bloqueio, a Zuri não responde nada.

## Trava de leitura

É a mesma do bot do Telegram, com as mesmas horas (12 por padrão, em
Configurações › Integrações › Telegram). Depois dessas horas sem usar a conversa,
a Zuri só responde com um link para destravar no app. Assim, quem entrar na sua
conta do Chatwoot não lê as suas notas, memórias e agenda. A saída do modo de
bloqueio fecha a trava de novo.

O que a Zuri responde fica guardado no Chatwoot, e outros administradores da
conta conseguem ler.

Detalhes de segurança: [docs/seguranca.md](seguranca.md#chatwoot-do-dono).
