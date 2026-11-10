# Plano · Modelos de interface

Situação: rodada 5 entregue (Sinal refinado), esperando o Pablo avaliar
Origem: pedido do Pablo em 09/11/2026 ("use a skill taste para criar 5 novos modelos de frontend para eu aprovar") ; na rodada 2, "Aperfeiçoe o modelo 4 - menta… inclua também a tela de login… avalie a skill ui-skills, se for segura, crie 3 novos modelos"; e, na rodada 4, "Crie 5 novos frontend, faça um rebranding completo… crie uma nova identidade visual, ícones e logomarca. Verifique as skills abaixo e crie 3 novos modelos com cada skill" (ui-ux-pro-max e open-design); na rodada 5, "Pegue o modelo 1. Sinal da rodada 3, e aplique nele as melhorias das skills de designer acima… Crie um modelo muito bonito, funcional, com excelente visualização e contraste"

Dependências: nenhuma para escolher. A implementação, se houver, vira PR própria.

## 1. Resumo

Na rodada 5 o Pablo escolheu partir do **Sinal** da rodada 3 e pediu para aplicar nele as melhorias das skills de design avaliadas (`ui-ux-pro-max` e `open-design`), com foco em beleza, função, leitura e contraste. O resultado é um modelo só, o **Sinal refinado**, com doze telas: as nove do sistema, a tela nova de **Contatos**, a tela nova **Estados das telas** (carregando, vazio, erro, sem conexão, confirmação e aviso com desfazer) e a de identidade visual (seção 2).

Na rodada 4 o Pablo pediu um rebranding completo: cinco identidades novas (logomarca, ícone do app, família de ícones, cores, letras e jeito de falar) e mais três modelos com cada uma das skills `ui-ux-pro-max` e `open-design`. São onze modelos, cada um com as nove telas e uma tela nova de identidade visual (seção 3). A tela de entrar de todos mostra só a marca e uma frase, sem pistas do sistema. As rodadas anteriores ficam abaixo como histórico.

Na rodada 3 o Pablo achou as interfaces anteriores feias e fora da função do sistema. Os três exemplos novos (Sinal, Painel e Caderno) foram refeitos do zero a partir das telas reais do app, conciliando a `taste-skill` e a `ui-skills` (seção 4). As rodadas 1 e 2 ficam abaixo como histórico.

Na rodada 2 o Pablo ficou com o Menta, que foi refinado e ganhou todas as telas do sistema e a de entrar, e chegaram três modelos novos feitos com a skill `ui-skills` (seção 5). A rodada 1, abaixo, trouxe cinco direções visuais para a Zuri, todas com a mesma organização aprovada em 03/11 (barra lateral com Nova conversa, Buscar, seções, Recentes e a conta no rodapé; gaveta no celular). O que muda entre elas é a cara: fonte, cores no claro e no escuro, espaçamento, cantos e o jeito de montar o Início e a Conversa.

Paletas e pares de fontes saíram do sorteio da skill `taste-skill` para "produto de IA, software, fintech e ferramenta" (avaliação de segurança em `docs/planos/skill-taste.md`). As cores foram ajustadas para os dois temas passarem no contraste.

Nada no app muda até o Pablo escolher. Vale lembrar que em 03/11 ele preferiu manter as cores atuais (Sinal); estes modelos são a nova rodada que ele pediu.

- Protótipo: `docs/planos/modelos-frontend/prototipo.html` (abra no navegador; a barra do topo troca modelo, tela e tema).
- Capturas: `docs/capturas/pr/modelos-frontend/`, nome `<modelo>-<inicio|conversa>-<computador|celular>-<claro|escuro>.png` (40 imagens).
- Acessibilidade: axe (WCAG 2.1 A/AA e boas práticas) sem nenhuma violação nas 40 combinações.

## 2. Rodada 5 · Sinal refinado

- Protótipo: `docs/planos/modelos-frontend/prototipo-v5.html` (a barra do topo troca a tela e o tema).
- Telas: Entrar, Início, Conversa, Tarefas, Notas, Agenda, **Contatos**, Automações, Memória, Configurações, **Estados das telas** e Identidade visual.
- Capturas: `docs/capturas/pr/modelos-frontend-v5/`, nome `sinal-<tela>-<computador|celular>-<claro|escuro>.png` (240 imagens de 60 vistas: as 13 telas e as vistas de dentro delas, entre elas o carregando, "Esqueci minha senha" e "Confira o seu e-mail", os painéis de perfil e de avisos, a nota nova, a memória e a conversa por voz, o assistente de automação, os fluxos, os módulos, as conexões, a ficha de contato com WhatsApp, o contato sem nome e o só com e-mail, as avaliações com a lista, os homônimos e os pedidos, as nove seções das configurações, o consumo por ano, o ajuste de um agente, o mês da agenda, a lista de conversas, a conversa anterior, o exemplo do link, a credencial do Chatwoot, os ajustes das avaliações (conectado e esperando o Google) e o modelo das respostas), e a comparação com a rodada 3 em `antes-depois-*.png`.
- Acessibilidade: axe (WCAG 2.1 e 2.2 A/AA e boas práticas) sem nenhuma violação nas 136 combinações, e nenhum erro de script.

O Sinal continua sendo o Sinal: a mesma marca (o ponto verde sobre a haste), a fonte Figtree, os neutros em zinco e o verde como cor de ação. O que mudou foi o acabamento, regra por regra.

### O que veio de cada skill

| Melhoria | De onde | Como ficou |
| --- | --- | --- |
| Contraste medido, não estimado | `ui-ux-pro-max` (prioridade 1) e `open-design` (`craft/color.md`) | Todo texto com 4,5:1 ou mais nos dois temas (texto de apoio: 6,6:1 no claro e 6,9:1 no escuro). Bordas de campo, caixas de seleção e chaves com 3:1, o mínimo para controles. A tela de identidade mostra o contraste de cada cor. |
| Verde só onde importa | `open-design` (no máximo duas cores de destaque por tela) | "Nova conversa" virou botão claro com ícone verde; links e "Abrir agenda" ficaram em grafite; os ícones dos cartões ficaram neutros. Sobram o botão de enviar, a ação principal da tela e o sinal da marca. |
| Escuro de verdade | `open-design` (nada de preto e branco puros; bordas brancas translúcidas) | Fundo #0c0c0e, superfícies #17171a, texto #f5f5f7, texto de apoio #b6b6bf e bordas a 11% de branco, para cada cartão se destacar do fundo. O verde do escuro (#4ade80) tem 10:1 sobre o grafite, e a aba aberta na lateral ganha um traço verde. |
| Letras com hierarquia | `open-design` (`craft/typography.md`) | Escala 13, 14, 16, 18, 22, 28, 34 e 40; três pesos (400, 500, 600); títulos grandes com espaçamento negativo; rótulos em maiúsculas com 0,06em; números em largura fixa; texto corrido com no máximo 65 caracteres por linha. |
| Toque e foco | `ui-ux-pro-max` (prioridades 1 e 2) | Alvos de 44 px no celular (a caixa de seleção tem 20 px de desenho e 44 px de toque); anel de foco largo nos campos; ao pressionar, o botão afunda 1 px sem mexer no resto. |
| Menu de baixo no celular | `ui-ux-pro-max` (navegação com até cinco itens) | Início, Conversa, Tarefas, Agenda e Mais, sempre à mão. O topo ficou com a marca, buscar, avisos e a conta. Barras fora da área que rola: nada fica escondido embaixo delas. |
| Todos os estados | `open-design` (`craft/state-coverage.md`) | Tela nova "Estados das telas": esqueleto ao carregar, vazio com uma ação, erro que diz o que houve e como tentar de novo, aviso de sem conexão, erro de campo embaixo do campo, confirmação de apagar e aviso com "Desfazer". |
| Sem cara de modelo pronto | `open-design` (`craft/anti-ai-slop.md`) | Nada de gradiente, emoji, roxo, cartão com borda colorida à esquerda ou número inventado. Os eventos da agenda perderam a faixa colorida e ganharam fundo suave. |
| Tela de entrar discreta | `open-design` (`login-flow`) e o pedido do Pablo de 13:37 | Só a marca, uma frase e o formulário; rótulos acima dos campos, mostrar senha, preenchimento automático do gerenciador de senhas. O desenho do lado esquerdo são as ondas do sinal. |
| O agora no seu dia | detalhe de produto | A linha vermelha das 08:12 aparece entre o que já passou e o que vem, no Início e na Agenda. |

### Ajustes pedidos pelo Pablo (09/11, 15:56)

- **Tema escuro com mais contraste:** fundo mais fundo, cartões e bordas mais visíveis, texto de apoio mais claro e o traço verde na aba aberta.
- **Agenda das 08:00 às 18:00:** é o intervalo padrão. Em "Mostrar" dá para escolher outro início e outro fim, e "Voltar para 08:00 até 18:00" desfaz. O que cai fora do intervalo não some: aparece nas linhas "Antes" e "Depois" (no celular, numa nota "Fora do horário").
- **Tela de Contatos:** lista com busca e as abas Pessoas, Clientes e Avaliações; ao lado, a pessoa escolhida com telefone, e-mail, aniversário, o que está na agenda com ela e o que a Zuri sabe sobre ela. Só leitura, como no app (vem do Google Contatos), com "Perguntar à Zuri sobre a Bia" e "Copiar telefone".
- **Lateral sem "Recentes".** A conta ficou só com o nome, sem "Configurações e tema".
- **Busca sem o atalho Ctrl + K** na caixa. A paleta de comandos continua no atalho, só não aparece escrita.

### Ajustes pedidos pelo Pablo (09/11, 16:37)

- **Agenda nas configurações:** área nova "Agenda" em Configurações. O horário que aparece (começa às, termina às) vira o padrão de quando a agenda abre, com uma barra de 24 horas que mostra o intervalo. Também ficam ali a visualização ao abrir, o primeiro dia da semana, mostrar ou não o fim de semana, o lembrete dos eventos novos e quais agendas do Google aparecem. Na tela Agenda, "Mudar o padrão" leva direto para essa área, e o botão de voltar desfaz só o que você mudou na hora.
- **Contatos melhor:** as três abas funcionam. Em Pessoas, a lista vem agrupada por letra, com busca, cor suave por pessoa e estrela nos favoritos. A ficha tem quatro atalhos (Perguntar à Zuri, Ligar, E-mail e Copiar telefone), o que vem pela frente com a pessoa (agenda, tarefas e aniversário), o que a Zuri sabe, onde a pessoa aparece (notas e conversas) e os dados, só leitura. Em Clientes, cada um mostra a etapa (novo contato, em conversa, cliente) e a linha do tempo. Em Avaliações, a nota média e cada avaliação com a resposta sugerida pela Zuri, para aprovar, editar ou descartar; nota baixa sempre espera você. No celular, a lista e a ficha são telas separadas, com voltar.
- **Carregando com animação:** uma linha verde corre no topo na hora; se passar de 300 ms, o esqueleto entra com um brilho que atravessa e o sinal da Zuri pulsa ao lado de "Buscando suas tarefas"; quando chega, cada linha entra no seu lugar, sem pular a tela. "Ver de novo" repete a animação. Com "Reduzir movimento", nada se mexe.

### Ajustes pedidos pelo Pablo (09/11, 18:03 e 18:23)

- **Rolagem no celular:** a barra de baixo e o perfil não andam mais junto com a página. A causa eram textos só para leitor de tela que escapavam do corte; agora só a área do conteúdo rola.
- **Carregando em todo lugar:** ao abrir cada tela pela primeira vez, ao trocar de semana na agenda e no botão Entrar.
- **Agenda:** saiu "Mostrar das 08:00 até 18:00"; o horário fica em Configurações › Agenda.
- **Contatos:** todos os campos do Google em grupos; "Telefone" com menu no computador e "Ligar" no celular; ícone do WhatsApp em todo celular; a avaliação de cada contato no Google (avaliou, editou, apagou) e o índice de recomendação.
- **Pedidos de avaliação:** as avaliações antigas são ligadas aos contatos antes de tudo; quem nunca avaliou recebe o link 8 dias depois da consulta, sempre em dia útil, com um toque seu no WhatsApp; um lembrete só; várias travas contra o envio repetido.
- **Notas:** "Nova nota" e salvamento automático. **Memória:** microfone em "Guardar uma memória". **Automações:** assistente "Criar automação" em 5 passos. **Perfil e avisos:** painéis no computador e folhas no celular.
- **Igual à develop:** as oito seções de Configurações, as abas de Tarefas, Escrever e Prévia nas notas, revisão de conflitos na memória, Rotinas e Fluxos, funil e retornos dos clientes, e os filtros e ações das avaliações.
- Desenho de cada item, a viabilidade do envio pelo Chatwoot e as decisões pendentes: [sinal-refinado-funcionalidades.md](sinal-refinado-funcionalidades.md).

### Ajustes pedidos pelo Pablo (09/11, 19:11 e 19:15)

- **Agenda:** a legenda diz só "Configurações › Agenda.", com link. A linha vermelha anda com o relógio, no Início e na Agenda, como no Google Agenda; a hora atual aparece na ponta e o compromisso em andamento ganha "Agora".
- **Tema:** no perfil e em Configurações › Conta, só os três ícones (claro, escuro e como o sistema), com o nome para leitor de tela.
- **Acesso pela API:** "Acesso remoto" virou "Acesso pela API", com "Nova chave de API" e os escopos "Só ler", "Ler e escrever" e "Só enviar eventos".
- **Modelos:** a lista de modelos da Cloudflare é conferida sozinha uma vez por dia (e em "Conferir agora"), avisando de modelo novo, modelo que vai sair e mudança de preço. Modelo novo só entra com um toque seu; se um modelo em uso sair, a Zuri volta ao padrão no dia e avisa.
- **Agentes:** "Ajustar" abre o painel de cada agente: temperatura, top_p, tamanho da resposta, "Estilo e tarefa", as regras fixas para ler e as versões salvas.
- **Perguntas de 19:15:** impressão digital do nome, origem do endereço e da foto (Google Contatos) em [sinal-refinado-funcionalidades.md](sinal-refinado-funcionalidades.md); envio pelo Chatwoot direto das automações da Zuri, sem n8n, em [envio-chatwoot-pela-zuri.md](envio-chatwoot-pela-zuri.md).

### Ajustes pedidos pelo Pablo (09/11, 19:34)

- **Pastas:** "Projetos" de tarefas e notas viraram "Pastas" no protótipo; a memória mantém a categoria "Projeto".
- **Microfones:** a animação de gravação da memória vale para todos os microfones, inclusive o campo da conversa no Início e na Conversa.
- **Chatwoot:** as três respostas do Pablo entraram em [envio-chatwoot-pela-zuri.md](envio-chatwoot-pela-zuri.md), que fica sem perguntas abertas.

### Ajuste pedido pelo Pablo (09/11, 20:02)

- **Nomes iguais:** o Google não entrega e-mail nem telefone de quem avalia, então a Zuri usa o telefone e o e-mail dos contatos para separar homônimos e para saber quem recebeu e abriu o link. Com homônimos, nunca liga sozinha e ninguém recebe pedido até a escolha do Pablo. Regra completa em [sinal-refinado-funcionalidades.md](sinal-refinado-funcionalidades.md), seção 8.1b; no protótipo, a avaliação da "Ana Souza".

### Ajustes pedidos pelo Pablo (09/11, 20:19)

- **Seu dia:** o que já passou e não pede nada vai para uma cortina recolhida ("4 já passaram"), que abre e fecha com animação curta (parada com "reduzir movimento"). Tarefa ou confirmação que passou da hora sem ser feita sobe para o topo, marcada como pendente, e o contador "N pendentes" fica ao lado da cortina. A lista se refaz a cada 30 segundos, junto com a linha vermelha, sem tirar o foco de quem está usando o teclado.
- **Fluxos prontos:** Automações ganhou a aba "Prontos" (e não "Workflows", que confundiria com a aba "Fluxos", onde ficam os fluxos que o Pablo monta). Ali entram os fluxos do n8n reescritos no código da Zuri: vêm desligados, pedem só as chaves, testam a conexão e começam sempre em ensaio, que roda junto com o n8n sem enviar nada. Plano completo em [modulos.md](modulos.md) (a aba virou "Módulos" às 21:51).
- **Clipe:** o botão de anexar saiu de todas as conversas, porque a develop não trata arquivo enviado pelo chat.
- **Todos os botões funcionam:** cada botão abre o diálogo, a lista ou o arquivo que promete (pastas, editor de fluxo, nova conexão, novo evento, visão de dia e de mês, códigos de recuperação, passkeys, chaves de API, todos os acessos, servidor MCP, backup, lixeira por tipo, funil, cliente, marca em SVG), com foco preso no diálogo, Esc e volta do foco a quem abriu. Ações que mexem em segurança pedem a senha, como no app.
- **Conferência com a develop e plano de incorporação:** a lista do que existe na develop e onde fica no protótipo, mais as 9 PRs de interface, estão em [novo-frontend-sinal.md](novo-frontend-sinal.md). Faltavam "Últimos envios" nos avisos (entrou) e as páginas de primeira configuração, bloqueio, aprovação pelo Telegram e 404, que entram na PR I do plano.
- **Etapa 26c (0.38.0):** a reorganização que entrou na develop hoje passou para o protótipo: Configurações com "Uso da IA" e "Modelos e limites" separados e os limites recolhidos, "Nova memória" num diálogo (com o microfone), menu "Mais opções" (⋯) em rotinas, fluxos e memórias com Apagar por último, lixeira aberta só com as tarefas ou só com as notas, Avisos na ordem nova e Conta sem o cartão "Sair deste aparelho".
- **Protótipo interativo no repositório:** `docs/planos/modelos-frontend/prototipo-interativo.html` é a mesma versão do link publicado, com navegação pelo endereço e tema do aparelho. O `prototipo-v5.html` continua sendo o das capturas.

### Ajustes pedidos pelo Pablo (09/11, 21:51)

- **Contatos a cada 5 min, com contagem:** o topo da lista mostra "Nada mudou às 08:08 · Próxima em 4:12", que conta de verdade, sincroniza ao chegar a zero e recomeça. O "cache" já existe no servidor (o Google só manda o que mudou e contato igual não é regravado); o plano acrescenta etiquetas lidas por hora e a tela recarregando só com mudança. Plano em [sincronizacao-contatos-avaliacoes.md](sincronizacao-contatos-avaliacoes.md).
- **Filtro por etiquetas:** já existia em Configurações. Agora o ícone de etiqueta no topo de Contatos abre a escolha das etiquetas sincronizadas (desmarcar tira as cópias da Zuri, nada muda no Google), e uma fileira de etiquetas filtra a lista na hora.
- **Mesmos campos do Google:** a ficha mostra nome, telefones, e-mails, endereço, aniversário, datas, relações, empresa, site, chat, etiquetas, campos personalizados e observações. O que estiver vazio entra em "Vazio no Google". Contato sem nome aparece pelo telefone ("Sem nome no Google") e contato sem telefone mostra Ligar e WhatsApp desligados.
- **Clientes:** saiu de Contatos. O CRM continua guardando os dados.
- **Avaliações com área própria:** item no menu lateral, com Visão geral (índice de recomendação, nota média, respondidas, tempo até responder, índice por mês, notas por estrela, funil dos pedidos e o que precisa de você, por 30 dias, 6 meses ou 12 meses), Avaliações e Pedidos. Leitura a cada 10 min com contagem.
- **Módulos e Conexões:** "Prontos" virou "Módulos". Automações tem quatro partes que aparecem no menu lateral: Rotinas, Fluxos, Módulos e Conexões. O Chatwoot é configurado uma vez em Conexões e os módulos só escolhem a conexão; mudar o endereço pede a chave de novo, e conexão em uso não pode ser removida. Plano em [modulos.md](modulos.md).
- **Saudação pela hora:** bom dia até 11:59, boa tarde até 17:59, boa noite depois.

### Ajustes pedidos pelo Pablo (09/11, 22:08)

- **Tela de entrar:** "Seu dia em ordem, sem esforço." e "Continue de onde parou."; o e-mail ficou sem o exemplo dentro do campo; o cartão "Verificação concluída" virou uma linha discreta que confere sozinha; "Esqueci minha senha" fica ao lado do rótulo da senha e abre a recuperação por e-mail, com a mesma resposta para qualquer e-mail. Detalhes em [novo-frontend-sinal.md](novo-frontend-sinal.md), seção 7.
- **Sugestões do Início:** saem do dia real (atrasadas, conta do dia, hora, segunda-feira, avaliação esperando). Plano com a IA só escolhendo e ordenando, nunca escrevendo o texto: [sugestoes-do-inicio.md](sugestoes-do-inicio.md).
- **Agenda:** o atalho do rodapé diz só "Configurações".
- **Consumo por período:** Dia, Semana, Mês e Ano, com teto diário tracejado, total, média, pico e tabela.
- **Cronograma:** [novo-frontend-sinal.md](novo-frontend-sinal.md), seção 11, com as 19 PRs na ordem.

### Ajustes pedidos pelo Pablo (10/11, 00:51 e 00:54)

- **Verificação de segurança:** tela própria no protótipo ("Entrar · verificação") com os seis estados: conferindo, concluída, pedir clique, não carregou (com "Recarregar a verificação"), não passou e espera. Cada exemplo abre a tela de entrar naquele estado.
- **Menu CRM:** Módulos e Conexões saíram de Automações para o item novo **CRM** no menu lateral; Conexões virou **Credenciais**. A lista dos fluxos do n8n e a ordem ficam em [modulos-crm.md](modulos-crm.md) (PR #247).
- **Tela de entrar:** "Sua agenda, suas tarefas e seus lembretes, em ordem." e "Entre para continuar de onde parou."; recuperação com o título "Criar uma senha nova". Favicon e título conferidos no código: todas as telas têm "Nome · Zuri", menos a página de erro, que entra na PR I.
- **Agenda:** Configurações › Agenda com horário e dias de trabalho, esconder eventos de dia inteiro e fora do horário; na Agenda, botões "Dia inteiro" e "Fora do horário" e uma linha que avisa quantos ficaram escondidos.
- **Contatos:** a faixa de etiquetas virou o botão "Etiqueta: Todas ▾" com uma lista que tem busca e contagem.
- **Avaliações:** aba **Como responder**, com dados do consultório, instruções (até 2.000 caracteres), o que fazer em cada nota, exemplos, palavras proibidas e um teste que gera o rascunho sem publicar.
- **Memória:** filtros à esquerda, lista agrupada por tipo, painel com "Ligada a", "Aparece em" e "Memórias próximas", e a visão **Mapa**, parecida com o grafo do Obsidian, sem IA nova.
- **Versão:** Configurações › **Sobre a Zuri** mostra a versão, a data e se a tela e o servidor estão na mesma versão; o menu do perfil perdeu "Agenda" e ganhou a linha "Versão 0.39.2", com ícone próprio, logo abaixo de "Avisos" (ajuste das 02:00).
- **Relatar no GitHub:** prévia de todos os campos que vão preenchidos na issue.
- **Nada escondido:** a varredura das 53 vistas nos dois tamanhos tirou toda faixa que rolava de lado (seções das Configurações no celular viraram uma lista, botões de Tarefas mostram o texto).
- **Frases descritivas** de todas as telas e seções revistas; tabela em [novo-frontend-sinal.md](novo-frontend-sinal.md), seção 7.
- **Cronograma:** capturas do README refeitas em cada PR de tela, e a etapa final de **pentest autônomo**, que só começa com tudo concluído e com a autorização do Pablo.
- **Respostas:** 2 (teto de 141 kB), 3 (preferência da Agenda), 5 (IA só escolhe as sugestões) e 7 (índice pelas estrelas) aprovadas; 6 (Clientes em segundo plano) fica para depois; 11 (fluxos do n8n) foi para o plano dos módulos do CRM.

### Ajustes pedidos pelo Pablo (10/11, 02:24 e 02:32)

- **Menu lateral:** três grupos (sem título: Início e Conversa; **Organizar**: Tarefas, Agenda, Notas, Memória e Automações; **Relacionamento**: Contatos, Avaliações e CRM) e ícones revistos, sem repetição: Conversa `messages-square`, Notas `notebook`, Automações `zap`, Contatos `book-user`, CRM `handshake`.
- **Exemplo do link:** em Avaliações › Pedidos, "Como funciona o link" abre o passo a passo: a mensagem com o link, o que acontece no toque e a linha do tempo do pedido (vista "Avaliações · exemplo do link").
- **Conversas:** lista das conversas recentes ao lado da conversa (no celular, no botão do cabeçalho), conversa antiga com aviso, e a regra de conversa nova todo dia à 0:00 (ajuste das 03:12; antes era 24 h depois da primeira mensagem), ligada por padrão em Configurações › Conta › Conversas (vistas "Conversa · lista" e "Conversa · anterior").
- **Chaves dos modelos pagos:** continuam como segredos do servidor; a tela mostra só o estado. Motivo em [novo-frontend-sinal.md](novo-frontend-sinal.md), seção 7.
- **Intervalo do Chatwoot:** a credencial ganhou "Intervalo entre mensagens" (de 30 s a 1 min por padrão, ajuste das 03:01) e CRM › Credenciais mostra a fila de envio (vista "CRM · credencial do Chatwoot"). A lógica do servidor está em [modulos-crm.md](modulos-crm.md), seção 6; a ordem dos módulos e o recebimento dos e-mails do Webdiet, no mesmo plano (PR #247).
- **Celular (02:32):** ícones de 32 px no canto das linhas de Módulos, Automações e "Precisa de você", com os botões embaixo, alinhados ao texto; abas em grade de colunas iguais (quatro abas em 2 × 2); selo de título na linha de baixo; fila de envio em três colunas; botões da Memória › Para revisar em grade; a lista de Notas ocupa a largura toda.

### Ajustes pedidos pelo Pablo (10/11, 02:45 e 03:01)

- **Avaliações:** descrição da área, abas com ícone (Visão geral, Avaliações, Pedidos, Ajustes), período na linha das abas, ícone em cada número e "Estrelas" no lugar de "Notas". A aba **Ajustes** tem **Conexão com o Google** (conta, permissão, acesso liberado pelo Google, perfil, teste da conexão, importação, publicação e o passo a passo do acesso) e **Como responder** (fatos do consultório, canal oficial, sigilo de atendimento de saúde, variação do começo e o modelo completo). Plano: [avaliacoes-conexao-e-respostas.md](avaliacoes-conexao-e-respostas.md).
- **Modelo das respostas:** adaptado do fluxo de respostas do CRM no n8n, sem dados pessoais. A conferência da documentação do Google achou três lacunas no código de hoje: o estado de análise da resposta, o texto original das avaliações traduzidas e o erro do Google Workspace.
- **Termos:** Rotinas (lembretes, resumos e rotinas da Zuri, antes "Automações"), Automações (as do CRM, vindas do n8n, antes "Módulos"), Fluxos (no CRM) e Credenciais.
- **Barra de cima no celular:** sai ao descer e volta ao subir.
- **Intervalo do Chatwoot (03:01):** padrão de 30 s a 1 min. Cabe com folga no plano grátis da Cloudflare. O teto também caiu de 10 min para 1 min (pedido das 03:22): "De" e "Até" só aceitam 30 s, 40 s, 45 s, 50 s e 1 min.
- **Conversa do dia (03:12):** a conversa nova começa todo dia à 0:00, no fuso do dono, em vez de 24 h depois da primeira mensagem.
- **Agenda (03:17):** abre no dia de hoje de verdade (o protótipo publicado usa a data do aparelho; as capturas ficam em 09/11 para não mudar), sem o título com a data da semana, e com a barra do celular em duas linhas arrumadas.

### Recomendação

Se o Pablo aprovar, o Sinal refinado vira o plano de [novo-frontend-sinal.md](novo-frontend-sinal.md): os tokens deste protótipo passam para o Tailwind do app, a Figtree entra como arquivo servido pelo Worker e a tela "Estados das telas" vira o padrão de carregando, vazio e erro de todas as telas.

## 3. Rodada 4 · Rebranding e seis modelos das skills

- Protótipo: `docs/planos/modelos-frontend/prototipo-v4.html` (a barra do topo troca modelo, tela e tema; os modelos estão agrupados por origem).
- Telas: Entrar, Início, Conversa, Tarefas, Notas, Agenda, Automações, Memória, Configurações e **Identidade visual** (logomarca, versões sobre fundo claro, escuro e da marca, ícone do app em 72, 48, 32 e 20 px, cores, letras, ícones e jeito de falar).
- Capturas: `docs/capturas/pr/modelos-frontend-v4/`, nome `<modelo>-<tela>-<computador|celular>-<claro|escuro>.png` (440 imagens), e uma folha de resumo por modelo em `resumo-<modelo>.png`.
- Acessibilidade: axe (WCAG 2.1 A/AA e boas práticas) sem nenhuma violação nas 440 combinações, e nenhum erro de script.
- Avaliação das skills: [skill-ui-ux-pro-max.md](skill-ui-ux-pro-max.md) e [skill-open-design.md](skill-open-design.md).

### Tela de entrar sem pistas

O Pablo apontou que a tela de entrar dizia demais ("No computador, no celular e no Telegram", "Depois, o código ou a passkey"). Nos onze modelos ela mostra só a logomarca, uma frase da marca, e-mail, senha, a verificação de segurança e "Esqueci minha senha". Nada sobre canais, segundo passo, tipo de sistema ou proteção. No app de verdade, a mesma limpeza saiu numa PR própria para a `develop`.

### O que vale para os onze

- O nome continua **Zuri**; o que muda é a identidade em volta dele.
- Logomarcas desenhadas à mão em SVG com o método da skill `brandkit` (inicial com significado, ação do produto, espaço negativo, geometria). Nenhuma foi gerada por IA paga.
- Cada modelo tem a sua família de ícones, todas de licença livre e copiadas como SVG: Lucide, Tabler Icons 3.31.0 e Phosphor 2.1.1 (regular, bold, light ou duotone).
- Cinco montagens de tela: **coluna** (conversa no centro e menu lateral), **topo** (menu em cima e o dia ao lado), **painel** (menu escuro e coluna "Agora"), **trilho** (menu estreito com ícone e nome) e **carta** (a Zuri escreve um bilhete, serifada).
- Continuam valendo as regras da rodada 3: um botão principal por tela, interface neutra com uma cor, texto de leitura de 16 px ou mais, cores do Tailwind, sem gradiente nem roxo, alvos de 44 px, foco visível.

### Identidades novas

| Modelo | Logomarca | Cores | Letras | Ícones | Montagem |
| --- | --- | --- | --- | --- | --- |
| 1 · Farol | Um Z cujo traço de cima termina numa luz | azul-noite `#172554`, âmbar `#fbbf24` só na luz, botão azul `#1e3a8a` | Manrope | Tabler, traço fino | topo |
| 2 · Trama | Três faixas que se cruzam por cima e por baixo, como tecido | terracota `#c2410c`, pedra escura `#1c1917` | Schibsted Grotesk | Phosphor bold | painel |
| 3 · Norte | Agulha de bússola num círculo; ícone do app redondo | azul `#1d4ed8`, ouro na ponta da agulha | Public Sans | Lucide 1,5 | trilho |
| 4 · Ninho | Um arco que abriga um ponto | mel escuro `#92400e`, papel `#fbfaf7` | Newsreader e Nunito Sans | Phosphor duotone | carta |
| 5 · Pulso | O Z num traço só, com uma batida no meio | rosa `#e11d48`, preto `#0a0a0a` | Sora | Phosphor regular | coluna |

### Modelos da skill `ui-ux-pro-max`

Saíram da busca local da skill (`--design-system` para "personal AI assistant productivity calm" e "AI chat assistant private minimal", e `--domain color` para "productivity assistant").

| Modelo | O que a skill sugeriu | Como ficou |
| --- | --- | --- |
| 6 · Suíço | Estilo Minimalism & Swiss: grade, preto e branco, sem sombra | Preto `#0a0a0a`, verde-azulado `#0f766e` só para agir, cantos de 2 a 4 px, Inter, Lucide de pontas retas, montagem topo |
| 7 · Fluxo | Flat Design com a paleta "Productivity Tool" (verde-azulado e laranja) e Plus Jakarta Sans | Verde-azulado `#0f766e` em foco e seleção, laranja `#ea580c` só no botão principal, fundo menta claro, montagem painel |
| 8 · Nativo | AI-Native UI: pouca moldura, conversa no centro; paleta roxa | O roxo virou azul-céu `#0369a1` pela regra do Zuri; Lexend nos títulos e Source Sans 3 no texto; montagem coluna |

### Modelos do `open-design`

Saíram dos sistemas de design genéricos do catálogo (nenhum com nome de marca) e da skill `login-flow`.

| Modelo | Sistema de origem | Como ficou |
| --- | --- | --- |
| 9 · Agêntico | `agentic`: conversa primeiro e tarefas delegadas | Menu azul-noite `#0b1020`, azul `#2563eb`; o Início mostra "Com a Zuri", com o que espera você, o que está agendado e o que já foi feito; montagem trilho |
| 10 · Espaçoso | `spacious`: muito respiro, creme e bronze | Fundo creme `#faf3df`, bronze `#8f5d24`, o dobro de espaço entre blocos, Phosphor light; montagem coluna |
| 11 · Refinado | `refined`: serifada e paleta de papel e cobre | Georgia nos títulos, Inter no texto, cobre `#9b5b32`, monograma em itálico num anel fino; montagem carta |

### Custo de implementar (rodada 4)

- **JS inicial:** nenhum modelo pede biblioteca nova. Trocar a família de ícones (Tabler ou Phosphor no lugar do Lucide) só vale se couber no teto de 139.700 B; os ícones usados entram um a um, como hoje.
- **Fontes:** uma ou duas famílias em `woff2`, servidas pelo Worker, fora do JS inicial. Refinado usa a Georgia do sistema nos títulos.
- **Marca:** a logomarca nova troca o `Logo`, o favicon e os ícones do PWA (gerados por `scripts/gerar-icones.ts`).
- **Montagem:** coluna e carta mexem pouco na moldura; topo e trilho trocam o menu lateral; painel acrescenta a coluna "Agora".
- Nenhum recurso novo da Cloudflare.

### Recomendação (rodada 4)

**Farol.** É a identidade com a ideia mais clara (a Zuri mostra o próximo passo), tem a paleta mais séria para usar o dia todo e o menu em cima deixa a tela inteira para o dia e a conversa. A segunda opção é o **Norte**, para quem prefere o menu estreito à esquerda e o ícone redondo no celular.

## 4. Rodada 3 · Sinal, Painel e Caderno

- Protótipo: `docs/planos/modelos-frontend/prototipo-v3.html` (a barra do topo troca modelo, tela e tema).
- Telas: Entrar, Início, Conversa, Tarefas, Notas, Agenda, Automações, Memória e Configurações.
- Capturas: `docs/capturas/pr/modelos-frontend-v3/`, nome `<modelo>-<tela>-<computador|celular>-<claro|escuro>.png` (108 imagens).
- Acessibilidade: axe (WCAG 2.1 A/AA e boas práticas) sem nenhuma violação nas 108 combinações.

### O que mudou no jeito de fazer

As rodadas anteriores partiram de paletas e montaram telas genéricas de painel. Esta partiu do que a Zuri faz de verdade, lido no código e nas telas atuais:

- **A Zuri age, mas pede licença.** O plano proposto ("Nada foi criado ainda. Revise e confirme"), a aprovação de ação destrutiva e a rotina que espera aprovação aparecem nos três modelos, e o Início tem "Precisa de você" com essas pendências.
- **O dia junta tudo.** Tarefas, eventos do Google Agenda e automações aparecem numa linha do tempo só, porque é assim que a dona vive o dia.
- **Conteúdo real do app:** E-mail, senha e verificação de segurança no Entrar (a passkey vem no segundo passo), as abas reais de Tarefas (Hoje, Próximas, Atrasadas, Concluídas, Todas), prioridades Urgente/Alta/Média/Baixa, tipos e estados da memória, os tipos de automação (Lembrete, Resumo das tarefas, Rotina da Zuri), as abas de Configurações e o menu com Agenda e Contatos.
- **A logomarca atual (o "i" com o sinal verde)** em todos, sem redesenhar.
- **Ícones do lucide de verdade** (os mesmos do app), não desenhados à mão.

### Como as duas skills foram conciliadas

| Regra | De onde vem | Como ficou |
| --- | --- | --- |
| Um sistema só: um botão principal por tela, um estilo de cartão, uma escala de cantos, um jeito de link | taste | Cada modelo tem um botão cheio, um secundário com borda e um discreto; um cartão; três raios |
| Interface 90 a 95% neutra, uma cor de destaque | taste e ui-skills | A cor só aparece no botão principal, no foco, nos links e no que a Zuri fez |
| Cores e sombras do Tailwind | ui-skills | Neutros zinc, slate e stone; destaques green-700, cyan-700 e blue-800; `shadow-sm` |
| Texto de leitura com 16 px ou mais, rótulos de 13 px sem caixa alta | taste | Corpo 16 a 20 px; nada abaixo de 13 px; sem rótulo em maiúsculas |
| Títulos com `text-balance`, texto com `text-pretty`, números com `tabular-nums` | ui-skills | Aplicado em todos |
| Sem gradiente, sem roxo, sem brilho | as duas | Nenhum |
| Animação só de `transform`/`opacity`, até 200 ms, parada com "reduzir movimento" | ui-skills | Botões sobem 1 px e afundam no clique em 150 ms |
| Alvos de 44 px, foco visível, `100dvh` e margem de área segura | as duas | Aplicado |
| Estado vazio com uma ação, confirmação antes de apagar | ui-skills | Mantidos do app atual |
| Sem caixa dentro de caixa dentro de caixa | taste | No máximo dois níveis |

Também foram evitados os vícios de página gerada apontados pelo `frontend-design`: fonte mono em rótulos pequenos, separador "·" entre dados, rótulos em maiúsculas acima de títulos e tudo cortado em cartões iguais.

### 1 · Sinal (recomendado)

- **Ideia:** a marca atual levada a sério. Conversa primeiro; o verde só aparece onde a Zuri age.
- **Fonte:** Figtree (títulos 600, corpo 400).
- **Cores:** claro branco com neutros zinc, destaque `green-700` `#15803d`. Escuro `zinc-900` `#18181b`, destaque `green-400` `#4ade80`.
- **Cantos:** 10, 12 e 16 px; o campo da conversa com 22 px.
- **Início:** saudação com o resumo do dia numa frase, campo grande para falar com a Zuri e três ideias, "Precisa de você" (plano e rotina esperando) e "Seu dia" numa linha do tempo com tarefas, eventos e automações.
- **Conversa:** a Zuri fala sem balão, com o sinal ao lado; as suas mensagens em balão cinza; ferramentas usadas aparecem como "Consultou a agenda"; plano e aprovação em cartão.
- **Entrar:** painel escuro com a frase da marca e os três pontos de segurança, formulário ao lado.

### 2 · Painel

- **Ideia:** a Zuri como secretária do dia. Menu escuro e uma coluna "Agora" à direita em todas as telas, com o próximo compromisso, o que precisa de você e as automações de hoje.
- **Fonte:** IBM Plex Sans (técnica, números bem alinhados).
- **Cores:** claro `slate-50` com cartões brancos, menu `slate-900`, destaque `cyan-700` `#0e7490`. Escuro `slate-900`, destaque `cyan-400` `#22d3ee`.
- **Cantos:** 6 e 8 px, cartões com `shadow-sm`.
- **Início:** barra de pedido à Zuri, agenda de hoje em grade de horas (eventos em bloco, tarefas marcadas no horário, linha do agora) ao lado das tarefas de hoje e dos próximos dias.
- **Conversa:** lista de conversas ao lado, mensagens com nome e hora, como um registro.
- **Tarefas:** tabela com Tarefa, Projeto, Prazo e Prioridade.
- **Entrar:** painel escuro com uma prévia real do dia ("Hoje, segunda") e uma pergunta da Zuri.
- No celular a coluna "Agora" some e o "Precisa de você" entra no Início.

### 3 · Caderno

- **Ideia:** a Zuri escreve, você lê. O texto da Zuri, as notas e as memórias em serifa de leitura; o resto da interface em sem serifa.
- **Fontes:** Literata (leitura e títulos) e Source Sans 3 (interface).
- **Cores:** claro branco com neutros quentes, destaque azul tinta de caneta `blue-800` `#1e40af`. Escuro `#1c1b19`, destaque `blue-300` `#93c5fd`.
- **Cantos:** 6, 8 e 10 px; quase sem caixas.
- **Início:** a data como título e um bilhete da Zuri com o resumo do dia e links para a nota e o plano; campo "Responder à Zuri"; Tarefas de hoje e Na agenda lado a lado.
- **Conversa:** como documento: suas mensagens com uma linha à esquerda, a resposta da Zuri em serifa.
- **Entrar:** uma coluna só, sem painel, com "Que bom te ver de novo. Deixei o resumo do dia pronto."

### Custo de implementar (rodada 3)

- **JS inicial:** nenhum pede biblioteca nova. O Painel pede a coluna "Agora" (componente novo, mas leve e com dados que o Início já busca).
- **Fontes:** cada modelo traz `woff2` servidas pelo Worker, fora do JS inicial: Sinal uma família (Figtree), Painel uma (IBM Plex Sans), Caderno duas (Literata e Source Sans 3). Dá para usar a fonte do sistema em qualquer um e manter o resto.
- **Estrutura:** Sinal é o que menos mexe (mesma organização, Início reescrito). Painel muda a moldura (terceira coluna). Caderno muda mais a tipografia que a estrutura.
- Nenhum recurso novo da Cloudflare.

### Recomendação (rodada 3)

**Sinal.** É o que mais conversa com a marca e com o app de hoje, deixa a conversa no centro, que é o que a Zuri é, e mostra logo no Início o que precisa da dona. Se a ideia for ter o dia sempre à vista enquanto conversa, a segunda opção é o **Painel**.

## 5. Rodada 2 · Menta refinado e três modelos da `ui-skills`

O Pablo escolheu seguir com o **Menta** e pediu para melhorar, com todas as telas e a de entrar. Pediu também três modelos novos pela skill `ui-skills`, que foi avaliada como segura para usar como texto (`docs/planos/skill-ui-skills.md`, commit `97dea9e7`).

- Protótipo: `docs/planos/modelos-frontend/prototipo-v2.html` (a barra do topo troca modelo, tela e tema).
- Telas: Início, Entrar, Conversa, Tarefas, Notas, Agenda, Automações, Memória e Configurações.
- Capturas: `docs/capturas/pr/modelos-frontend-v2/`, nome `<modelo>-<tela>-<computador|celular>-<claro|escuro>.png` (144 imagens).
- Acessibilidade: axe (WCAG 2.1 A/AA e boas práticas) sem nenhuma violação nas 144 combinações.

### Menta refinado

O que mudou em relação à rodada 1:

- **Cantos concêntricos.** Cartão de 24 px, campo de 16 px, botões e menu em pílula. O raio de dentro sempre menor que o de fora, para não parecer encaixado à força.
- **Menta só como preenchimento.** Texto verde-menta sobre branco não passa no contraste; agora a menta é fundo (botão principal, item ativo, ícones dos atalhos) e os links usam o verde escuro `#0a7041` no claro.
- **Início.** Saudação e resumo do dia num bloco cinza, campo para falar com a Zuri e três sugestões; logo abaixo, três atalhos (Nova tarefa, Nova nota, Agenda de hoje); Hoje e Próximos dias em cartões sem borda.
- **Menu.** Contagem de tarefas e compromissos ao lado de cada seção, em números de largura fixa.
- **"Atrasada"** com ícone e texto em laranja escuro, nunca só pela cor.
- **Conversa.** Balões redondos com o canto do lado de quem fala mais fechado; cartões de ação (lembrete criado, nota criada) dentro da resposta.
- **Entrar.** Painel menta à esquerda com a frase da marca e o formulário à direita: senha, Entrar, Entrar com passkey e Recuperar o acesso. No celular o painel vira só o logo no topo.
- **Outras telas.** Tarefas com abas em pílula, Notas com lista e editor lado a lado, Agenda por dia com faixa de cor, Automações em cartões com chave liga/desliga e "Rodar agora", Memória com busca e categoria em etiqueta, Configurações com menu de seções e Aparência (tema e "reduzir movimento").
- Fonte: Outfit e DM Mono, como na rodada 1.

### Os três modelos da `ui-skills`

Os três seguem a `baseline-ui` à risca: cores e sombras padrão do Tailwind, fonte do sistema, um só destaque por tela, sem gradiente, sem roxo e sem brilho, títulos com `text-balance`, números com `tabular-nums`, animação só de `transform`/`opacity` em 150 ms e desligada com "reduzir movimento", `100dvh` e margens de área segura no celular, escala fixa de `z-index`, botões só com ícone com nome para leitor de tela.

#### Zinco

- **Ideia:** neutro e denso, cara de ferramenta de trabalho. Linhas finas, cartões só com borda.
- **Cores:** claro `zinc-50` `#fafafa`, texto `zinc-900`, destaque `emerald-700` `#047857`. Escuro `zinc-950` `#09090b`, destaque `emerald-400` `#34d399`.
- **Cantos:** 12 px nos cartões, 8 px nos campos e botões.
- **Entrar:** painel cinza com borda à esquerda, formulário à direita.

#### Pedra

- **Ideia:** quente e calmo. Menu no mesmo fundo da página, cartões brancos com sombra pequena (`shadow-sm`), laranja só no botão principal e nos links.
- **Cores:** claro `stone-100` `#f5f5f4`, cartões brancos, destaque `orange-700` `#c2410c`. Escuro `stone-950` `#0c0a09`, destaque `orange-400` `#fb923c`.
- **Cantos:** 16 px nos cartões, 10 px nos campos e botões.
- **Entrar:** painel escuro (claro no tema escuro) com a frase da marca.

#### Ardósia

- **Ideia:** menu lateral sempre escuro, conteúdo claro, mais largo (1.120 px). O mais "painel de controle" dos três.
- **Cores:** claro `slate-50` `#f8fafc`, menu `slate-900` `#0f172a`, destaque `sky-700` `#0369a1`. Escuro `slate-950` `#020617`, destaque `sky-400` `#38bdf8`.
- **Cantos:** 8 px nos cartões, 6 px nos campos e botões.
- **Entrar:** painel `slate-900` à esquerda.

### Custo de implementar (rodada 2)

- **Menta:** fontes Outfit e DM Mono como `woff2` servidas pelo Worker, fora do JS inicial (uns 60 a 90 KB). Dá para ficar com a fonte do sistema e manter o resto.
- **Zinco, Pedra e Ardósia:** custo zero de fonte e de biblioteca. As cores já existem no Tailwind do app; a troca é de tokens em `apps/web/src/styles.css` e da montagem do Início, da Conversa e da tela de entrar.
- Nenhum pede biblioteca nova nem recurso da Cloudflare.

### Recomendação (rodada 2)

**Menta refinado**, que é a direção que o Pablo escolheu e agora cobre o sistema todo com contraste em dia. Se ele preferir algo mais sóbrio e sem fonte extra, a segunda opção é o **Pedra**, o mais confortável para usar o dia todo dos três novos.

## 6. Rodada 1 · Os cinco modelos

### 1 · Lima

- **Ideia:** painel de controle calmo. Escuro é o tema principal; o verde-lima conversa com o sinal verde da marca atual.
- **Tipografia:** Red Hat Display nos títulos (peso 500), Red Hat Text no corpo, IBM Plex Mono em datas e números.
- **Cores:** escuro fundo `#0f0f0f`, superfície `#1a1a1a`, texto `#f4f4f0`, destaque `#dafa9c`. Claro fundo `#f5f5ef`, texto `#14160f`, destaque `#d2f584` com texto de link `#3c560d`.
- **Espaçamento e cantos:** cantos de 10 px, listas em linhas finas, sem cartões.
- **Início:** saudação grande, uma faixa em mono com "3 tarefas para hoje · 1 atrasada · próxima automação 07:30", campo largo para falar com a Zuri, Hoje e Próximos dias lado a lado.
- **Conversa:** sem balões. A Zuri fala com uma linha lima à esquerda; a sua mensagem fica num contorno à direita.

### 2 · Cobalto

- **Ideia:** ferramenta de trabalho precisa, estilo painel. Cartões, busca sempre à vista no topo.
- **Tipografia:** Instrument Sans (títulos 500), DM Mono para horários.
- **Cores:** claro fundo `#eef0f3`, cartões brancos, destaque cobalto `#1f2de6`. Escuro fundo `#0b0d12`, destaque `#7d93ff`.
- **Espaçamento e cantos:** cantos retos de 6 px, grade de três colunas no computador.
- **Início:** cartão "Falar com a Zuri", cartão de resumo com o número grande de tarefas, Hoje e Próximos dias em cartões.
- **Conversa:** balões: os seus em cobalto, os da Zuri em cartão com borda.

### 3 · Petróleo

- **Ideia:** leitura tranquila, como um diário. Uma coluna só, texto maior.
- **Tipografia:** Onest (títulos 400, mais leves), JetBrains Mono nos horários.
- **Cores:** claro papel `#f7f9f8`, texto `#10292d`, títulos e destaque petróleo `#06525c`. Escuro `#061a1d`, títulos `#94dcd5`.
- **Espaçamento e cantos:** coluna de 760 px no centro, cantos de 12 px, bastante ar entre blocos.
- **Início:** a Zuri resume o dia numa frase ("Hoje são três tarefas, uma delas atrasada…"), depois o campo e "O seu dia" numa linha do tempo.
- **Conversa:** como documento: blocos separados por linha, sem balões, texto da Zuri em 17 px.

### 4 · Menta

- **Ideia:** amigável e leve, para o dia a dia. Cantos bem redondos, botões em pílula.
- **Tipografia:** Outfit (geométrica), DM Mono nos horários.
- **Cores:** claro branco `#ffffff` com cinza `#f4f4f3`, destaque menta `#a1ffcb` com texto escuro `#0a2a19`; links `#0a7041`. Escuro `#111312`, a mesma menta.
- **Espaçamento e cantos:** cantos de 20 a 28 px, item ativo do menu em pílula menta.
- **Início:** cartão grande "Em que posso ajudar hoje?" com o campo, três atalhos (Nova tarefa, Nova nota, Agenda de hoje) e as listas em cartões.
- **Conversa:** balões redondos: os seus em menta, os da Zuri em cinza.

### 5 · Floresta

- **Ideia:** mais editorial e firme. A conversa fica sempre ao lado no computador.
- **Tipografia:** Epilogue (grotesca um pouco condensada, títulos 500), JetBrains Mono nas datas.
- **Cores:** escuro verde-preto `#161c1a`, texto osso `#e3e2da`, destaque `#9fc7b8`. Claro osso `#f1f0ea`, texto `#161c1a`, destaque `#2f5e50`.
- **Espaçamento e cantos:** cantos de 4 px, divisórias finas, títulos de seção sublinhados com traço forte.
- **Início:** três números grandes (tarefas hoje, atrasada, compromissos amanhã), listas abaixo e a conversa rápida numa coluna à direita (no celular ela some e fica no menu).
- **Conversa:** lista de conversas à esquerda e a conversa à direita, como um e-mail.

## 7. O que vale para todos

- Mesmos textos e dados de exemplo (a dona "Ana", nada real), em pt-BR, "a Zuri" no feminino, sem citar infraestrutura.
- Alvos de toque de 44 px, foco visível na cor do destaque, texto de leitura com 16 px ou mais, "Pular para o conteúdo", pontos que piscam param com "reduzir movimento".
- Claro e escuro em todos.
- Ícones no traço do lucide, que o app já usa.

## 8. Custo de implementar (rodada 1)

- **JS inicial:** nenhum dos modelos pede biblioteca nova. A troca é de CSS (tokens em `apps/web/src/styles.css`) e de montagem das telas Início e Conversa, que já são carregadas à parte.
- **Fontes:** hoje o app usa a fonte do sistema. Cada modelo traz arquivos `woff2` da sua família e da mono (o Lima tem uma família a mais, a Red Hat Display para títulos), uns 60 a 120 KB, servidos pelo próprio Worker e fora do JS inicial. Nada é buscado no Google na hora de abrir. Dá para ficar com a fonte do sistema e levar só cores e montagem.
- **Floresta** é o que mais mexe na estrutura (conversa fixa ao lado e lista de conversas própria). **Lima** e **Cobalto** são os que menos mexem.
- Sem custo na Cloudflare.

## 9. Recomendação (rodada 1)

**Lima.** É o que mais conversa com a marca atual (verde, escuro forte), muda pouco a estrutura e traz a faixa de estado do dia, que é útil. Se a ideia for algo mais leve para usar o dia todo no claro, a segunda opção é **Petróleo**.

## 10. Próximo passo

O Pablo aprova um dos modelos da rodada 4 (ou uma mistura, por exemplo "logomarca do Farol com a montagem do Norte"). Aí sai um plano de implementação pela skill `planejar`, com testes, axe, capturas antes e depois e o teto de JS conferido.
