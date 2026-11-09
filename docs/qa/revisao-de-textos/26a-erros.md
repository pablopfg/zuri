# Revisão das mensagens de erro (etapa 26a)

Critério do plano: toda mensagem de erro do catálogo diz o que houve e o que fazer. Cada chave de erro do catálogo (as `error.*` e as que o inventário classifica como erro: motivos de falha em `web.*.problem.*`, títulos de aviso de falha) foi lida no pt-BR (o inglês acompanha o sentido) e caiu numa destas classes:

- diz o que fazer: 146
- motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela: 58
- explica a regra ou o limite, e o que continua funcionando; não há ação do dono: 31
- o item mudou ou saiu; não há o que fazer: 28

As mensagens sem ação na primeira passada foram lidas uma a uma: as que tinham uma ação possível ganharam o que fazer nesta PR (memória repetida, item que não volta da lixeira, rotina pendente, backup inválido, Telegram sem código, gravação de áudio, servidor MCP fora do ar ou com endereço errado) e as que sobraram descrevem uma regra fixa (por exemplo, "Só as rotinas da Zuri usam ferramentas externas") ou um limite com a hora em que ele volta.

| Chave | Texto (pt-BR) | Classe |
| --- | --- | --- |
| `error.internal` | Não deu para concluir agora. Seus dados estão seguros; tente de novo em instantes. | diz o que fazer |
| `web.accessLog.reason.failed` | verificação recusada | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `error.aiLimit.requests` | Você chegou ao limite diário de pedidos à IA. Ele renova à meia-noite UTC (21h em Brasília). Tarefas, notas e memórias continuam funcionando; o limite muda em Configurações > IA. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `error.aiLimit.neurons` | A IA chegou ao teto de uso do dia, que mantém a Zuri dentro da cota grátis. Ele renova à meia-noite UTC (21h em Brasília). Tarefas, notas e memórias continuam funcionando. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `error.aiLimit.audio` | Você chegou a 1 hora de áudio transcrito hoje. O limite renova à meia-noite UTC (21h em Brasília); até lá, escreva a mensagem. | diz o que fazer |
| `error.aiQuotaExhausted` | A cota grátis de IA acabou por hoje. Tarefas, notas e memórias continuam funcionando; a IA volta quando a cota renovar. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `error.aiAborted` | A resposta foi interrompida. Mande a mensagem de novo para continuar. | diz o que fazer |
| `error.aiTimeout` | A IA demorou demais para responder. Tente de novo. | diz o que fazer |
| `error.aiBusy` | A IA está ocupada agora. Tente de novo em instantes. | diz o que fazer |
| `error.aiModelUnavailable` | O modelo de IA escolhido não está disponível. Escolha outro em Configurações > IA. | diz o que fazer |
| `error.aiUnavailable` | A IA não conseguiu responder. Tente de novo. | diz o que fazer |
| `error.aiRequestRejected` | A IA não aceitou este pedido. Tente uma mensagem mais curta ou com outras palavras. | diz o que fazer |
| `error.aiLimit.usd` | Os modelos pagos chegaram ao teto de gasto que você escolheu para hoje (US$ {max}). Ele renova à meia-noite UTC (21h em Brasília); o valor muda em Configurações > IA. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `error.aiPaidBackground` | Fluxos e respostas automáticas usam só os modelos grátis. Escolha um modelo grátis como principal ou como reserva em Configurações > IA. | diz o que fazer |
| `error.aiNoCredit` | A empresa do modelo pago recusou por falta de crédito. Recarregue na conta dela e toque em “Já recarreguei” em Configurações > IA. | diz o que fazer |
| `error.aiKeyRefused` | A empresa do modelo pago recusou a chave cadastrada. Confira a chave e toque em “Tentar de novo” em Configurações > IA. | diz o que fazer |
| `web.ai.invalid` | Use um número inteiro de {min} a {max}. | diz o que fazer |
| `error.conversationNotFound` | Esta conversa não existe mais. | o item mudou ou saiu; não há o que fazer |
| `error.chatBusy` | Já há uma resposta sendo escrita. Espere ela terminar ou toque em Parar. | diz o que fazer |
| `error.voiceBusy` | Já há um áudio sendo transcrito. Espere ele terminar. | diz o que fazer |
| `error.actionNotFound` | Esta proposta não existe mais. | o item mudou ou saiu; não há o que fazer |
| `error.actionExpired` | Esta proposta expirou. Peça de novo se ainda quiser. | diz o que fazer |
| `error.actionHandled` | Esta proposta já foi resolvida. | o item mudou ou saiu; não há o que fazer |
| `error.actionTargetGone` | O item não existe mais, então nada foi feito. | o item mudou ou saiu; não há o que fazer |
| `error.actionTargetChanged` | O item mudou depois da proposta, então nada foi feito. Peça de novo para ver a versão atual. | diz o que fazer |
| `error.planNotFound` | Este plano não existe mais. | o item mudou ou saiu; não há o que fazer |
| `error.planExpired` | Este plano expirou. Peça um novo se ainda quiser. | diz o que fazer |
| `error.planCancelled` | Este plano foi descartado. Peça um novo se ainda quiser. | diz o que fazer |
| `error.planConfirmed` | Este plano já foi confirmado. | o item mudou ou saiu; não há o que fazer |
| `error.planChanged` | O plano mudou desde que você abriu. Recarregue para ver a versão atual. | diz o que fazer |
| `error.planTaskAdded` | Dá para mudar ou tirar tarefas do plano, mas não acrescentar. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `error.storageLimit.conversations` | Você chegou ao limite de conversas. Apague as que não precisa mais para começar novas. | diz o que fazer |
| `error.storageLimit.messages` | Você chegou ao limite de mensagens. Apague conversas antigas para continuar. | diz o que fazer |
| `web.chat.voice.failed` | Não deu para gravar o áudio. Confira se o navegador pode usar o microfone e tente de novo. | diz o que fazer |
| `web.chat.approval.status.failed` | Não foi feito | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.chat.approval.problem.changed` | O item mudou depois da proposta. | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.chat.approval.problem.gone` | O item não existe mais. | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.chat.approval.problem.failed` | Não deu para aplicar a mudança. Tente de novo. | diz o que fazer |
| `web.integrations.problem.auth` | O servidor recusou o acesso. Confira o token. | diz o que fazer |
| `web.integrations.problem.timeout` | O servidor demorou demais para responder. Tente reconectar daqui a pouco. | diz o que fazer |
| `web.integrations.problem.unavailable` | Não deu para falar com o servidor. Confira o endereço ou tente mais tarde. | diz o que fazer |
| `web.integrations.problem.blocked` | O servidor tentou levar a Zuri para outro endereço, e ela recusou. | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.integrations.problem.redirect` | O servidor respondeu com um redirecionamento. Use o endereço final dele. | diz o que fazer |
| `web.integrations.problem.too_large` | A resposta do servidor passou do tamanho permitido. | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.integrations.problem.protocol` | Este endereço não parece um servidor MCP compatível. Confira o endereço na documentação do serviço. | diz o que fazer |
| `web.integrations.problem.dns` | Não deu para achar este endereço na internet. Confira se ele está certo. | diz o que fazer |
| `web.integrations.problem.private_address` | Este endereço aponta para uma rede particular. A Zuri só conecta a serviços públicos. | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.integrations.problem.credential_unreadable` | O token guardado não pode mais ser lido. Edite o servidor e informe o token de novo. | diz o que fazer |
| `web.integrations.problem.no_tools` | O servidor não ofereceu nenhuma ferramenta compatível. Não há o que ligar por enquanto. | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.integrations.problem.truncated` | O servidor tem muitas ferramentas; só as primeiras 100 aparecem. | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.integrations.problem.signin` | Falta entrar na conta do serviço para a Zuri usar este servidor. Se o botão Entrar no serviço não aparecer, toque em Reconectar. | diz o que fazer |
| `web.integrations.problem.oauth` | A entrada no serviço não deu certo. Tente de novo; se repetir, o serviço pode não aceitar apps novos. | diz o que fazer |
| `web.integrations.tool.problem.schema_too_large` | Incompatível: entrada grande demais | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.integrations.tool.problem.schema_too_deep` | Incompatível: entrada complexa demais | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.integrations.tool.problem.schema_not_object` | Incompatível: formato de entrada | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.integrations.tool.problem.schema_unsupported` | Incompatível: formato de entrada | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.google.problem.revoked` | O Google recusou o acesso da Zuri. Conecte de novo para voltar a ver a agenda. | diz o que fazer |
| `web.google.problem.credential_unreadable` | A Zuri não conseguiu ler o acesso guardado. Conecte de novo. | diz o que fazer |
| `web.contacts.problem.reconnect` | A Zuri perdeu o acesso aos contatos. Ligue os contatos de novo e permita na página do Google. | diz o que fazer |
| `web.contacts.problem.api_disabled` | A People API está desligada no projeto do Google Cloud. Ligue-a em APIs e serviços › Biblioteca e toque em "Sincronizar agora". | diz o que fazer |
| `web.contacts.problem.scope` | O Google não deixa a Zuri ler os contatos. Ligue os contatos de novo e marque a permissão na página do Google. | diz o que fazer |
| `web.contacts.problem.too_many` | As etiquetas escolhidas passam de 5.000 contatos. Escolha menos etiquetas para a Zuri continuar. | diz o que fazer |
| `web.contacts.problem.unavailable` | O Google não respondeu nas últimas tentativas. A Zuri tenta de novo sozinha. | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `error.unauthorized` | Entre para continuar. | diz o que fazer |
| `error.forbidden` | Você não tem permissão para fazer isso. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `error.httpsRequired` | Use uma conexão segura (HTTPS). | diz o que fazer |
| `error.websocketNotSupported` | Este endereço não aceita WebSocket. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `error.accessRequired` | Acesso não autorizado. Entre pelo endereço protegido para continuar. | diz o que fazer |
| `error.hostNotAllowed` | Este endereço não atende a Zuri. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `error.notFound` | Isso não existe ou já saiu daqui. Confira o endereço. | diz o que fazer |
| `error.notConfigured` | A Zuri ainda não foi configurada por completo. Veja o guia de instalação. | diz o que fazer |
| `error.validationFailed` | Alguns dados não estão certos. Confira os campos e tente de novo. | diz o que fazer |
| `error.invalidCredentials` | E-mail ou senha incorretos. Confira e tente de novo. | diz o que fazer |
| `error.csrfFailed` | Pedido recusado por segurança. Recarregue a página e tente de novo. | diz o que fazer |
| `error.recentAuthRequired` | Digite a sua senha de novo para continuar. | diz o que fazer |
| `error.passwordChangeRequired` | Troque a sua senha para continuar. | diz o que fazer |
| `error.rateLimited` | Muitas tentativas. Espere um pouco e tente de novo. | diz o que fazer |
| `error.turnstileRequired` | Confirme a verificação de segurança e tente de novo. | diz o que fazer |
| `error.turnstileFailed` | A verificação de segurança não passou. Tente de novo. | diz o que fazer |
| `error.turnstileUnavailable` | Não deu para confirmar a verificação contra robôs agora. Tente de novo em instantes. | diz o que fazer |
| `error.turnstileNotConfigured` | A entrada está fechada: falta configurar a verificação contra robôs. Veja o guia de instalação. | diz o que fazer |
| `error.breachCheckUnavailable` | Não deu para conferir a senha nas listas de vazamentos agora. Tente de novo em instantes. | diz o que fazer |
| `error.serviceUnavailable` | Um serviço necessário não respondeu. Tente de novo em instantes. | diz o que fazer |
| `error.bodyTooLarge` | O envio é grande demais. Mande menos coisa de uma vez. | diz o que fazer |
| `error.clientAddressMissing` | Não foi possível confirmar a sua conexão. Tente de novo pelo endereço de sempre. | diz o que fazer |
| `error.conflict` | Isso não pode ser feito agora. Atualize a tela e tente de novo. | diz o que fazer |
| `error.storageFull` | O armazenamento da Zuri está cheio. Esvazie a lixeira ou apague o que não precisa mais para guardar coisas novas. | diz o que fazer |
| `error.storageLimit.tasks` | Você chegou ao limite de tarefas. Apague as concluídas que não precisa mais para criar novas. | diz o que fazer |
| `error.storageLimit.notes` | Você chegou ao limite de notas. Apague as que não precisa mais para criar novas. | diz o que fazer |
| `error.storageLimit.projects` | Você chegou ao limite de projetos. Apague os que não precisa mais para criar novos. | diz o que fazer |
| `error.projectMissing` | Este projeto não existe mais. Escolha outro. | diz o que fazer |
| `error.taskNotFound` | Esta tarefa não existe mais. | o item mudou ou saiu; não há o que fazer |
| `error.noteNotFound` | Esta nota não existe mais. | o item mudou ou saiu; não há o que fazer |
| `error.projectNotFound` | Este projeto não existe mais. | o item mudou ou saiu; não há o que fazer |
| `error.trashGone` | Este item não está mais na lixeira. | o item mudou ou saiu; não há o que fazer |
| `error.trashBroken` | Este item não pode ser restaurado. Crie de novo se precisar dele. | diz o que fazer |
| `error.trashAlreadyBack` | Este item já foi restaurado. | o item mudou ou saiu; não há o que fazer |
| `error.storageLimit.memories` | Você chegou ao limite de memórias. Apague as que não precisa mais para guardar novas. | diz o que fazer |
| `error.memoryNotFound` | Esta memória não existe mais. | o item mudou ou saiu; não há o que fazer |
| `error.memoryCycle` | Uma memória não pode substituir a si mesma nem uma das versões que vieram depois dela. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `error.memoryDuplicate` | Já existe uma memória atual com este texto. Edite a que já existe. | diz o que fazer |
| `error.memoryReviewGone` | Esta revisão já foi resolvida. | o item mudou ou saiu; não há o que fazer |
| `error.memorySame` | O texto novo é igual ao atual. Para corrigir um erro de digitação, use Editar. | diz o que fazer |
| `error.automationNotFound` | Esta automação não existe mais. | o item mudou ou saiu; não há o que fazer |
| `error.flowNotFound` | Este fluxo não existe mais. | o item mudou ou saiu; não há o que fazer |
| `error.flowDraftNotFound` | Esta sugestão de fluxo não existe mais. | o item mudou ou saiu; não há o que fazer |
| `error.crmClientNotFound` | Este cliente não existe mais. | o item mudou ou saiu; não há o que fazer |
| `error.crmStageNotFound` | Esta etapa do funil não existe mais. | o item mudou ou saiu; não há o que fazer |
| `error.crmClientLimit` | Você chegou ao limite de 5.000 clientes. Apague alguns para adicionar outros. | diz o que fazer |
| `error.crmTagLimit` | Você chegou ao limite de 200 etiquetas diferentes. Reaproveite uma que já existe. | diz o que fazer |
| `error.crmUnknownClient` | Esse cliente ainda não está no CRM. Mande primeiro um evento com o nome dele. | diz o que fazer |
| `error.flowLimit` | Você chegou ao limite de {limit} fluxos. Apague um para criar outro. | diz o que fazer |
| `error.flowRunning` | Este fluxo já está rodando. Espere ele terminar. | diz o que fazer |
| `error.flowRunsLimit` | Os fluxos já rodaram {limit} vezes hoje. A conta zera à meia-noite UTC (21h em Brasília). | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `error.flowSite` | Use um endereço https sem senha, sem IP, na porta 443 e que não seja o da própria Zuri. | diz o que fazer |
| `error.flowSitesLimit` | Os monitores acompanham no máximo {limit} sites, somando todos os fluxos. Tire um site de algum monitor para pôr outro. | diz o que fazer |
| `error.flowMethodNotAllowed` | Esta conexão não permite esse método. Libere-o na conexão antes. | diz o que fazer |
| `error.flowConnectionNotFound` | Esta conexão não existe mais. | o item mudou ou saiu; não há o que fazer |
| `error.flowConnectionLimit` | Você chegou ao limite de {limit} conexões. Apague uma para criar outra. | diz o que fazer |
| `error.flowConnectionInUse` | Um fluxo usa esta conexão. Tire-a do fluxo antes. | diz o que fazer |
| `error.flowConnectionOrigin` | Use um endereço https público. | diz o que fazer |
| `error.flowCredentialKey` | Guardar credenciais ainda não está disponível nesta instalação. Crie a conexão sem credencial. | diz o que fazer |
| `error.automationActiveLimit` | Você já tem 50 automações ativas. Pause ou apague uma antes de ligar outra. | diz o que fazer |
| `error.automationPendingLimit` | Já há 10 rotinas esperando a sua aprovação. Revise essas primeiro. | diz o que fazer |
| `error.automationPending` | Esta rotina ainda espera a sua aprovação. Aprove em Automações antes. | diz o que fazer |
| `error.automationNotPending` | Esta rotina já foi aprovada ou recusada. | o item mudou ou saiu; não há o que fazer |
| `error.automationChanged` | Esta rotina mudou depois que você abriu a tela. Confira o texto novo antes de aprovar. | diz o que fazer |
| `error.automationInPast` | Esse horário já passou. Escolha um momento no futuro. | diz o que fazer |
| `error.automationRunning` | Esta automação já está rodando. Espere terminar. | diz o que fazer |
| `error.automationQuietOnlyAi` | Só as rotinas da Zuri podem ficar quietas quando não há nada a avisar. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `error.storageLimit.automations` | Você chegou ao limite de 500 automações. Apague as que não usa mais. | diz o que fazer |
| `error.pushNotConfigured` | Os avisos no aparelho ainda não foram configurados nesta instalação. O passo a passo está no guia de configuração. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `error.pushNoDevice` | Nenhum aparelho recebe avisos ainda. Ligue primeiro neste navegador. | diz o que fazer |
| `error.pushDeviceLimit` | Até 3 aparelhos podem receber avisos. Remova um antes de adicionar este. | diz o que fazer |
| `error.noticeSecurityInsists` | Alertas de segurança não podem ser silenciados nem apagados enquanto insistem. Eles param sozinhos depois da última tentativa ou quando você confirma por outro canal. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `error.noticeAckBotOnly` | Só os alertas causados pelo bot se confirmam por aqui. Os outros param quando você confirma no Telegram. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `error.approveLockdown` | O modo de bloqueio está ligado: nada é aprovado nem destravado pelo bot. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `error.telegramNotConfigured` | O bot do Telegram ainda não foi configurado nesta instalação. O passo a passo está no guia de configuração. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `error.telegramUnavailable` | Não deu para falar com o Telegram agora. Tente de novo em alguns minutos. | diz o que fazer |
| `error.telegramNothingToConfirm` | Nenhuma conta do Telegram está esperando confirmação. Mande o código ao bot primeiro. | diz o que fazer |
| `error.telegramAdminMismatch` | Esta conta do Telegram não é a que foi autorizada nesta instalação. Use a conta autorizada. | diz o que fazer |
| `error.telegramNoLink` | Nenhuma conta do Telegram está conectada. Conecte em Configurações › Avisos. | diz o que fazer |
| `error.approveInvalid` | Este link não vale. Peça outro no bot do Telegram. | diz o que fazer |
| `error.approveUsed` | Este link já foi usado. Peça outro no bot do Telegram. | diz o que fazer |
| `error.approveExpired` | Este link venceu. Peça outro no bot do Telegram. | diz o que fazer |
| `error.approvalsLocked` | Muitas tentativas erradas. Tente de novo mais tarde. | diz o que fazer |
| `error.approvePasskeyMissing` | Nenhuma passkey deste endereço está cadastrada. Peça o código por e-mail no bot. | diz o que fazer |
| `error.approvePasskeyRefused` | A passkey não foi aceita. Peça outro link no bot do Telegram. | diz o que fazer |
| `error.mcpServerNotFound` | Este servidor não existe mais. | o item mudou ou saiu; não há o que fazer |
| `error.googleNotConfigured` | A Google Agenda ainda não foi configurada nesta instalação. O passo a passo está no guia de configuração. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `error.googleNotConnected` | Conecte a Google Agenda primeiro. | diz o que fazer |
| `error.googleRevoked` | O Google recusou o acesso. Conecte a Google Agenda de novo em Configurações › Integrações. | diz o que fazer |
| `error.googleRefused` | O Google recusou a conexão. Confira o ID e a chave do cliente e o endereço de redirecionamento no Google Cloud. | diz o que fazer |
| `error.googleUnavailable` | Não deu para falar com o Google agora. Tente de novo em um minuto. | diz o que fazer |
| `error.googleInvalid` | O Google não aceitou esse pedido. Confira os dados e tente de novo. | diz o que fazer |
| `error.googleRateLimited` | O Google está segurando os pedidos agora. Tente de novo em um minuto. | diz o que fazer |
| `error.googleNotFound` | Esse evento ou essa agenda não existe mais. | o item mudou ou saiu; não há o que fazer |
| `error.googleEventChanged` | O evento mudou no Google enquanto isso, então nada foi feito. Abra de novo e tente outra vez. | diz o que fazer |
| `error.googleState` | Este link de conexão venceu ou já foi usado. Comece de novo em Configurações › Integrações. | diz o que fazer |
| `error.googleDenied` | O Google não deu o acesso. Conecte de novo para tentar outra vez. | diz o que fazer |
| `error.googleScopes` | Marque as duas permissões na página do Google (ver as agendas e ver e editar os eventos) e conecte de novo. | diz o que fazer |
| `error.googleReadOnly` | A Zuri só pode ler essa agenda. Para editar, mude a permissão dela em Configurações › Integrações. | diz o que fazer |
| `error.googleFreeBusy` | Essa agenda só mostra horários livres e ocupados, então não tem eventos para ler. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `error.googleEventDate` | Confira as datas do evento. | diz o que fazer |
| `error.googleEventEnd` | O evento precisa terminar depois de começar. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `error.googleEventLong` | Esse evento é longo demais: até 14 dias com horário, até um ano se for de dia inteiro. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `error.mcpToolNotFound` | Esta ferramenta não existe mais. | o item mudou ou saiu; não há o que fazer |
| `error.mcpUrlInvalid` | Use o endereço completo de um serviço público, começando com https://, sem senha nem porta. | diz o que fazer |
| `error.mcpCredentialKeyMissing` | Servidores com token ainda não estão disponíveis nesta instalação. Siga o guia de configuração para liberar. | diz o que fazer |
| `error.mcpServerLimit` | Você já tem o máximo de servidores. Remova um antes. | diz o que fazer |
| `error.mcpTokenNeeded` | Informe o token deste servidor. | diz o que fazer |
| `error.mcpServerOff` | Ligue o servidor antes de conectar. | diz o que fazer |
| `error.mcpSignInExpired` | Essa entrada no serviço venceu ou já foi usada. Comece de novo em Configurações › Integrações. | diz o que fazer |
| `error.mcpToolUnavailable` | Esta ferramenta não pode ser ligada: o serviço não oferece mais ou ela é incompatível. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `error.mcpToolDestructive` | Esta ferramenta apaga ou sobrescreve, então sempre pede a sua aprovação. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `error.mcpRoutineOnly` | Só as rotinas da Zuri usam ferramentas externas. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `error.mcpToolLimit` | Você já tem o máximo de ferramentas ligadas. Desligue uma antes. | diz o que fazer |
| `error.backup.invalid` | Este arquivo não é um backup válido da Zuri. Nada foi importado; escolha um arquivo baixado na tela Dados. | diz o que fazer |
| `error.backup.newer` | Este backup veio de uma versão mais nova da Zuri. Atualize antes de importar. | diz o que fazer |
| `error.backup.key` | A chave do backup não é válida. Crie outra na tela Dados. | diz o que fazer |
| `error.backup.noBucket` | O backup automático não foi configurado nesta instalação. O passo a passo está no guia de configuração. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `error.googleApiDisabled` | A People API está desligada no projeto do Google Cloud. Ligue-a em APIs e serviços › Biblioteca e tente de novo. | diz o que fazer |
| `error.googleContactsScope` | Marque a permissão de ver os contatos na página do Google e tente de novo. | diz o que fazer |
| `error.googleContactsOff` | Os contatos do Google estão desligados. Ligue-os em Configurações › Integrações. | diz o que fazer |
| `error.googleContactsBusy` | A Zuri já está sincronizando os contatos. Espere um pouco e veja de novo. | diz o que fazer |
| `error.contactNotFound` | Este contato não está mais na Zuri. Ele pode ter saído das etiquetas escolhidas. | o item mudou ou saiu; não há o que fazer |
| `notice.flow.failed.title` | O fluxo {name} falhou | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `notice.flow.failed.body` | Ele parou num passo. O motivo está no histórico, em Automações › Fluxos. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `notice.contacts.problem.title` | Os contatos do Google pararam de sincronizar | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `error.googleBusinessScope` | Marque a permissão de gerenciar o perfil da empresa na página do Google e tente de novo. | diz o que fazer |
| `error.reviewsNotGranted` | Ligue as avaliações pela página do Google antes de escolher o perfil. | diz o que fazer |
| `error.reviewsLocation` | Escolha de 1 a 3 perfis da lista. | diz o que fazer |
| `error.reviewTemplate` | Alguma frase-modelo não passou nas regras das respostas. Confira as marcadas e tente de novo. | diz o que fazer |
| `error.reviewsOff` | As avaliações do Google estão desligadas. Ligue em Configurações › Integrações. | diz o que fazer |
| `error.reviewsCheckSoon` | As avaliações acabaram de ser lidas. Tente de novo daqui a um minuto. | diz o que fazer |
| `error.reviewsBusy` | A Zuri já está lendo as avaliações. Espere um pouco. | diz o que fazer |
| `error.reviewNotFound` | Essa avaliação não está mais aqui. | o item mudou ou saiu; não há o que fazer |
| `error.reviewHandled` | Essa avaliação já foi tratada. | o item mudou ou saiu; não há o que fazer |
| `error.reviewSuspicious` | Essa avaliação parece suspeita, então a Zuri não escreve rascunho para ela. Responda você ou deixe com a equipe. | diz o que fazer |
| `error.reviewsPaused` | As respostas estão pausadas. Retome para publicar. | diz o que fazer |
| `error.reviewsAutoLocked` | Publicar sozinha só libera depois que você aprovar 10 rascunhos sem mudar nada. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `error.reviewChanged` | Essa avaliação mudou desde o rascunho. A Zuri já leu de novo; confira o rascunho novo. | diz o que fazer |
| `error.reviewExpired` | Esse rascunho venceu depois de 72 horas. Peça um novo ou escreva a resposta. | diz o que fazer |
| `error.reviewRejected` | A resposta não passou nas regras: veja o que precisa mudar. | diz o que fazer |
| `error.reviewRemoved` | A avaliação foi apagada no Google, então nada foi publicado. | o item mudou ou saiu; não há o que fazer |
| `error.reviewAnswered` | Alguém já respondeu essa avaliação no Google, então nada foi publicado. | o item mudou ou saiu; não há o que fazer |
| `error.reviewUncertain` | O Google não confirmou a publicação. A Zuri confere na próxima leitura e avisa. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `error.reviewNotMine` | Essa resposta não foi publicada pela Zuri, então ela não apaga. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `notice.reviews.problem.title` | As avaliações do Google precisam de você | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `notice.reviews.problem.body` | Não consegui ler as avaliações do perfil. Veja o motivo em Configurações › Integrações. | diz o que fazer |
| `web.palette.failed` | A busca não respondeu. Os atalhos continuam aqui. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `web.automations.problem.missed` | o horário passou há mais de um dia, enquanto o sistema estava parado. | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.automations.problem.busy` | uma execução manual ainda estava rodando. | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.automations.problem.ai_budget` | o limite diário de rotinas da Zuri chegou. Mude em Configurações › IA. | diz o que fazer |
| `web.automations.problem.ai_limit` | o limite diário de IA chegou. Volta a rodar depois da meia-noite (UTC). | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.automations.problem.ai_unavailable` | a IA não respondeu a tempo. A próxima execução tenta de novo. | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.automations.problem.interrupted` | o sistema reiniciou no meio da execução. Ela não é repetida para não avisar duas vezes. | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.automations.problem.failed` | parou num erro. A próxima execução tenta de novo. | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.automations.problem.lockdown` | o modo de bloqueio estava ligado. A rotina volta quando você sair dele. | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.alerts.status.failed` | Falhou | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.alerts.push.failed` | Não deu para ligar as notificações neste navegador. Tente de novo daqui a pouco. | diz o que fazer |
| `web.approve.invalid` | Este link não foi reconhecido. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
| `web.agenda.problem` | A Zuri perdeu o acesso ao Google. Conecte de novo em Integrações para ver a agenda. | diz o que fazer |
| `web.flows.problem.missed` | o horário passou há mais de um dia | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.flows.problem.busy` | a execução anterior ainda estava rodando | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.flows.problem.lockdown` | o bloqueio estava ligado | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.flows.problem.runs_limit` | acabaram as 500 execuções do dia | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.flows.problem.calls_limit` | passou de 40 chamadas numa execução | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.flows.problem.items_limit` | passou de 200 itens | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.flows.problem.too_large` | a resposta passou de 256 KB | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.flows.problem.ai_limit` | acabou o limite de IA dos fluxos hoje | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.flows.problem.ai_unavailable` | a IA não respondeu | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.flows.problem.connection_missing` | a conexão foi apagada | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.flows.problem.method_not_allowed` | a conexão não permite esse método | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.flows.problem.path_not_allowed` | o caminho está fora dos que a conexão permite | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.flows.problem.credential` | a credencial da conexão não abriu; digite de novo | diz o que fazer |
| `web.flows.problem.blocked` | esse endereço não pode ser chamado | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.flows.problem.private_address` | o endereço aponta para uma rede interna | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.flows.problem.dns` | o nome do endereço não foi encontrado | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.flows.problem.redirect` | o serviço mandou para outro endereço, e a Zuri não segue | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.flows.problem.timeout` | o serviço demorou mais de 10 segundos | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.flows.problem.unavailable` | o serviço não respondeu | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.flows.problem.http_error` | o serviço respondeu com erro | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.flows.problem.not_json` | a resposta não veio em JSON | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.flows.problem.interrupted` | a execução foi interrompida | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.flows.problem.failed` | o passo parou num erro | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.flows.problem.google_access` | o Google não está conectado ou não deu permissão | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.flows.problem.calendar_missing` | a agenda está fechada para a Zuri ou só para leitura | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.flows.problem.contacts_off` | os contatos do Google estão desligados | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.flows.problem.invalid_date` | um item não tinha data válida, e nenhum evento foi criado | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.flows.problem.events_limit` | passou de 10 eventos numa execução, e nenhum foi criado | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.flows.problem.ai_check` | a resposta da IA trouxe um link ou contato que não estava nos dados, e nada foi enviado | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.reviews.breaker.refused` | A Zuri voltou a pedir sua aprovação em {when}: o Google recusou uma resposta. Para publicar sozinha de novo, ligue em Configurações › Integrações. | diz o que fazer |
| `web.reviews.guard.invalid` | o rascunho veio fora do formato | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.reviews.problem.reconnect` | O Google pediu para conectar de novo. Abra Configurações › Integrações › Google. | diz o que fazer |
| `web.reviews.problem.no_access` | O Google ainda não liberou o acesso à API do Perfil da Empresa para o seu projeto, ou a conta conectada não gerencia este perfil. A Zuri tenta de novo a cada 6 horas. | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.reviews.problem.api_disabled` | As APIs do Perfil da Empresa estão desligadas no seu projeto do Google Cloud. Ligue a My Business Account Management, a My Business Business Information e a Google My Business. | diz o que fazer |
| `web.reviews.problem.unavailable` | O Google não respondeu nas últimas leituras. A Zuri tenta de novo sozinha, com intervalos maiores. | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.reviews.card.template.failed` | Modelo {n}: {reasons} | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.agents.invalid.step` | Use um valor de {min} a {max}, em passos de {step}. | diz o que fazer |
| `web.agents.invalid.tokens` | Use um número inteiro de {min} a {max}. | diz o que fazer |
| `web.agents.invalid.prompt` | Até {max} caracteres, sem < nem > e sem caracteres invisíveis. | motivo ou título dentro de uma frase maior; a ação fica no texto em volta ou na tela |
| `web.backup.auto.failed` | A cópia de {date} falhou. A Zuri tenta de novo sozinha. | explica a regra ou o limite, e o que continua funcionando; não há ação do dono |
