# Plano · Levar o Sinal refinado para o app

Situação: plano. Pedido do Pablo em 09/11/2026, 20:19; revisto com os pedidos das 21:51 e 22:08 (seção 11, cronograma) e com os de 10/11, 00:51 e 00:54 (menu CRM, Credenciais, verificação de segurança, versão, memória em mapa, "Como responder" das avaliações, agenda só no horário de trabalho, nada escondido no celular, pentest final). Base: o protótipo da rodada 5 (`docs/planos/modelos-frontend/prototipo-v5.html`), o desenho das funcionalidades ([sinal-refinado-funcionalidades.md](sinal-refinado-funcionalidades.md)) e a develop de 09/11.

## 1. Resumo

O Sinal refinado entra no app em **9 PRs de interface**, uma área por vez, sem mudar a API. As funcionalidades novas que pedem servidor (pedidos de avaliação, homônimos, Chatwoot, módulos e conexões, catálogo de modelos, campos e sincronização dos contatos, área de Avaliações, sugestões do Início, consumo por hora e por mês) vêm em PRs próprias, cada uma com o seu plano, e a interface delas entra junto.

Duas travas mandam na ordem:

1. **Teto do JS inicial (139,9 kB).** A develop está em 139.858 B: sobram 42 bytes. Cores, fonte e espaçamento são CSS e não pesam no JS. A casca nova (menu de baixo no celular, painéis de perfil e avisos) pesa. A PR B mede antes e pede ao Pablo, com o número, o teto novo ou a economia equivalente.
2. **Testes e2e.** Eles acham os elementos pelo papel e pelo nome acessível (`tests/e2e/ui-helpers.ts`). Toda PR mantém esses nomes ou atualiza os testes no mesmo commit; nenhum teste é pulado.

## 2. Contexto no sistema

- Interface em `apps/web/src/`: casca `components/AppShell.tsx`, peças em `components/ui.tsx`, tema em `lib/theme.ts` e `components/ThemeSwitcher.tsx`, paleta `components/CommandPalette.tsx`, avisos `components/NotificationCenter.tsx`, telas em `pages/`.
- Rotas (`App.tsx`): `/`, `/conversa/:id?`, `/tarefas`, `/notas/:id?`, `/agenda`, `/contatos/:aba?`, `/automacoes/:aba?`, `/memoria`, `/configuracoes/:tab?`, `/acessos`, mais entrar, primeiro acesso, segundo passo, recuperação, troca de senha, bloqueio, `/aprovar` e 404.
- Textos em `packages/shared/i18n/` (pt-BR por tela e `en`); a CI falha se faltar tradução.
- Tela ao vivo por `/api/live` e `zur_area_versions`.
- Regras: `.claude/rules/` (i18n, capturas, performance P1–P14, readme), teto em `scripts/check-bundle-size.ts`.
- Decisões que valem: tela de entrar só com a marca e uma frase (09/11, 13:37); nenhum texto cita infraestrutura nem método de entrada; "Pastas" no lugar de "Projetos" (09/11, 19:34); exceção do Chatwoot (09/11, 19:34).

## 3. Objetivo e critérios de aceite

1. Cada tela do app fica igual à do protótipo, nos dois temas, no computador (1440 px) e no celular (390 px).
2. Todo botão faz o que diz. Botão de algo que ainda não existe no servidor não aparece; não há botão que só mostra um aviso.
3. Nenhuma funcionalidade da develop some (tabela da seção 4).
4. axe sem violações em todas as telas; Lighthouse ≥ 95; teclado e leitor de tela em cada fluxo.
5. JS inicial dentro do teto aprovado pelo Pablo.
6. e2e, typecheck, lint e testes verdes em cada PR; capturas novas na descrição.

## 4. Escopo

### O que a develop tem e onde fica no protótipo

A varredura de 09/11 comparou as rotas, os cartões de Configurações e os componentes da develop com o protótipo, já com a etapa 26c (versão 0.38.0): IA em duas seções, "Nova memória" num diálogo, menu "Mais opções" (⋯) nas linhas, lixeira filtrada pelo tipo e a ordem nova dos Avisos.

| Da develop | No protótipo | Entra na PR |
| --- | --- | --- |
| Início (saudação, "Precisa de você", seu dia, próximos dias) | Sim, com a cortina do que passou e as pendências; saudação pela hora (bom dia até 11:59, boa tarde até 17:59, boa noite depois) | C |
| Conversa (lista, voz, cartões de plano, aprovações) | Sim; sem o clipe, que não existe no servidor | D |
| Tarefas (abas, pastas, prioridade, lixeira) | Sim; abas filtram, o diálogo de Pastas cria, renomeia e apaga, e a lixeira abre só com as tarefas | E |
| Notas (lista, editor, Escrever e Prévia, pastas) | Sim, com "Nova nota", salvamento automático, "Pôr numa pasta", menu da nota e lixeira só com as notas | E |
| Agenda (dia, semana, mês, criar e editar evento) | Sim: as três visões funcionam, "Novo evento" cria na semana, com a linha de agora; o atalho do rodapé diz só "Configurações" | F |
| Contatos (pessoas, clientes do CRM, avaliações) | Pessoas, com todos os campos do Google e contagem regressiva. As etiquetas saem da faixa que rolava de lado: um botão "Etiqueta: Todas ▾" abre a lista com busca e contagem, e um X limpa o filtro. Clientes sai da tela e fica para depois (resposta 6 de 10/11: nada roda em segundo plano por enquanto). Avaliações vira item próprio do menu | G e G2 |
| Automações (rotinas, sugestão da Zuri, fluxos, conexões, editor de fluxo, menu ⋯) | O item vira **Rotinas** (lembretes, resumos e rotinas da Zuri). O menu lateral ganha o item **CRM**, com as partes **Automações** (as que vêm do n8n; antes "Módulos"), **Fluxos** (os que você monta) e **Credenciais** (o novo nome de Conexões). Termos fechados em 10/11, 02:45 (seção 7, "Termos") | H |
| Memória ("Nova memória" em diálogo, tipos, filtros, conflitos, "nunca enviar para fora" marcável no menu ⋯) | Sim, com o microfone dentro do diálogo. Novo desenho: filtros à esquerda (Mostrar e Tipos, com contagem), lista agrupada por tipo, painel da memória escolhida ("Ligada a", "Aparece em", "Memórias próximas") e a visão **Mapa** (seção 7, "Memória em mapa") | D |
| Configurações › Conta (preferências, senha, tema; sem o cartão "Sair deste aparelho") | Sim, tema só com ícones | H |
| Configurações › Segurança (duas etapas, passkeys, limites de sessão, atividade, acesso pela API) | Sim; limites de sessão em "Saída automática". Encerrar as sessões abertas continua só no Telegram (`/sessoes`, `/encerrar_sessoes`), como na develop | H |
| Configurações › Uso da IA (uso de hoje, consumo por período por dia, semana, mês e ano) e › Modelos e limites (modelo, catálogo, "Limites avançados" recolhidos, agentes, modelos pagos, busca por significado) | Sim, nas duas seções, com o painel "Ajustar" | H |
| Configurações › Avisos (canais, o que vai para cada canal, Telegram, resumo do dia, a Zuri de olho, prioridades aprendidas e últimos envios no fim) | Sim, na ordem da develop | H |
| Configurações › Integrações (Google, servidores MCP) | Sim | H |
| Configurações › Dados (backup, importar, backup automático, restaurar, lixeira com "Voltar" e "Ver tudo") | Sim; "Baixar backup" baixa um arquivo de exemplo | H |
| Configurações › Diagnóstico | Sim, com "Relatar no GitHub" em cada falha e a prévia do que vai na issue (seção 7, "Relatar no GitHub") | H |
| Versão (hoje no menu da conta, na lista das Configurações do celular e no Diagnóstico) | Seção nova **Configurações › Sobre a Zuri** e a linha "Versão 0.39.2", com ícone próprio, logo abaixo de "Avisos" no menu do perfil, que deixa de ter "Agenda" | H (B para o menu) |
| Acessos (`/acessos`) | "Ver todos os acessos" em Segurança abre a lista com filtro | H |
| Paleta ⌘K | Sim | B |
| Lembrete de duas etapas, aviso de sessão perto do fim, senha de novo, confirmação | Estados das telas | A |
| Entrar, primeiro acesso, segundo passo, recuperação, troca de senha, bloqueio, `/aprovar`, 404 | Entrar e "Esqueci minha senha" no protótipo, com os seis estados da verificação de segurança (tela "Entrar · verificação" do protótipo); o resto segue o mesmo desenho | I |
| Avaliações › respostas (agente `review_draft`: camada do dono em Configurações › Modelos e limites; assinatura, tom, modelos e palavras proibidas no cartão de Avaliações) | Aba **Como responder** dentro de Avaliações, com tudo num lugar só (seção 7) | G2 |

### O que precisa de servidor (PRs à parte, cada uma com plano)

| Funcionalidade | Plano |
| --- | --- |
| Fila do pedido de avaliação, dias úteis, homônimos | [sinal-refinado-funcionalidades.md](sinal-refinado-funcionalidades.md), seção 8 |
| Envio pelo Chatwoot | [envio-chatwoot-pela-zuri.md](envio-chatwoot-pela-zuri.md) |
| Módulos e conexões compartilhadas (Chatwoot uma vez só) | [modulos.md](modulos.md) |
| Contatos a cada 5 min, Avaliações a cada 10 min, campos do Google, área de Avaliações com métricas | [sincronizacao-contatos-avaliacoes.md](sincronizacao-contatos-avaliacoes.md) |
| Sugestões do Início pelo uso real | [sugestoes-do-inicio.md](sugestoes-do-inicio.md) |
| Consumo da IA por hora (hoje) e por mês (ano) | seção 7, "Consumo por período" |
| Catálogo de modelos da Cloudflare conferido sozinho | seção 9b do desenho das funcionalidades |
| Foto dos contatos | seção 6 do desenho das funcionalidades |
| Configurações › Agenda (horário de trabalho, dias de trabalho, eventos de dia inteiro e fora do horário) | preferência nova aprovada (resposta 3 de 10/11); seção 7, "Agenda no horário de trabalho" |
| Versão do servidor para conferir a atualização | `GET /api/version`; seção 7, "Versão" |
| "Como responder" das avaliações (dados do consultório, exemplos, teste) | seção 7, "Como responder" |
| Conversa nova todo dia à 0:00, no app e no Telegram, com o resumo da anterior | seção 7, "Conversas recentes" |
| Intervalo entre mensagens do Chatwoot e fila de envio | [modulos-crm.md](modulos-crm.md), seção 6 (PR #247) |
| Módulos do CRM e credenciais (servidor) | [modulos-crm.md](modulos-crm.md) (PR #247), que decide quais fluxos do n8n viram módulo, a ordem e as credenciais; este plano cuida só da interface do menu CRM |

Até a PR de servidor chegar, a interface daquela parte **não aparece**. Nada de botão que não faz nada.

Fora: trocar a marca, o nome ou o domínio; mudar rota ou contrato da API nas PRs de interface.

## 5. Como funciona para o Pablo

Nada muda no jeito de usar; muda a cara e o conforto. Cada PR traz capturas de antes e depois e só mexe numa área, então dá para conferir e reverter por partes.

### Textos visíveis

Os textos do protótipo entram no catálogo pelas chaves existentes sempre que o sentido for o mesmo; os novos ganham chave nova em pt-BR e en, passados pela `humanizer:humanizer`.

## 6. Regras de negócio e limites

- Nenhuma regra de negócio muda nas PRs de interface.
- Verde só na ação principal, no máximo 2 por tela; controles com contraste 3:1; alvos de 44 px; nada de preto puro no escuro.
- Movimento só com `prefers-reduced-motion` desligado.

## 7. Desenho técnico

### Arquivos

| PR | O que muda | Arquivos principais |
| --- | --- | --- |
| A · Fundamentos | Tokens de cor, raio, sombra e espaço; Figtree em woff2 servida pelo Worker; tema com ícones; peças base (botão, campo, interruptor, segmentado, selo, cartão, diálogo, folha, aviso, esqueleto) | `styles.css`, `components/ui.tsx`, `components/ThemeSwitcher.tsx`, `public/fonts/` |
| B · Casca | Lateral, menu de baixo no celular (Início, Conversa, Tarefas, Agenda, Mais), perfil e avisos em painel e folha, só o conteúdo rola, ⌘K | `components/AppShell.tsx`, `NotificationCenter.tsx`, `CommandPalette.tsx` |
| C · Início | Seu dia com linha de agora, cortina do que passou e pendências | `pages/home/HomeBody.tsx`, `lib/next.ts` |
| D · Conversa e Memória | Campo sem clipe, gravação igual em todos os microfones (um componente só), memória por voz | `pages/chat/*`, `pages/memory/MemoryPage.tsx`, `pages/chat/voice.ts` |
| E · Tarefas e Notas | "Pastas" nos textos (cerca de 30), "Nova nota", salvamento automático | `pages/productivity/*`, `pt-BR-productivity.ts`, `pt-BR-chat.ts`, `pt-BR-server.ts`, `pt-BR-backup.ts`, `pt-BR-security.ts` |
| F · Agenda | Semana com linha de agora que anda, "Antes" e "Depois", legenda | `pages/agenda/AgendaPage.tsx`, `lib/agenda.ts` |
| G · Contatos | Ficha com campos em grupos, Telefone/Ligar, WhatsApp, avaliações por contato | `pages/contacts/*` |
| H · Automações e Configurações | Assistente de 5 passos, abas, "Acesso pela API", painéis | `pages/automations/*`, `pages/settings/*`, `components/security/*` |
| I · Entrada | Entrar, primeiro acesso, segundo passo, recuperação, troca de senha, bloqueio, aprovar, 404 | `pages/LoginPage.tsx`, `pages/setup/*`, `pages/*Page.tsx` |

### Tela de entrar (PR I)

- **Textos (revistos em 10/11):** "Sua agenda, suas tarefas e seus lembretes, em ordem." no lado da marca e "Entre para continuar de onde parou." embaixo de "Entrar". Só a marca e uma frase, como decidido às 13:37. O título da aba continua "Entrar · Zuri", e o favicon, o ícone do iPhone e o manifesto já estão em `apps/web/index.html`; só a página de erro de rota (`RouteErrorPage`) ganha título próprio ("Algo deu errado · Zuri").
- **Campo de e-mail sem exemplo dentro.** O texto de exemplo some quando a pessoa digita, tem pouco contraste e confunde com campo já preenchido. Fica o rótulo "E-mail" sempre visível em cima, `type="email"`, `autocomplete="username"`, `inputmode="email"`, `autocapitalize="none"` e `spellcheck="false"`, para o gerenciador de senhas preencher. Erro embaixo do campo, ligado por `aria-describedby`: "Digite o seu e-mail." ou "Confira o e-mail: falta alguma parte.".
- **Verificação de segurança.** Já existe na develop (`components/TurnstileWidget.tsx`, `auth/turnstile.ts`): é o Turnstile da Cloudflare, grátis, no modo "só quando precisa" (`appearance: interaction-only`). Na maioria das vezes passa sozinho, sem clique. O servidor confere cada token com a chave secreta, e o token vale uma vez. A tela nunca diz "Turnstile" nem "Cloudflare": diz "verificação de segurança". Uma linha discreta acima de "Entrar" tem seis estados, todos na tela "Entrar · verificação" do protótipo:

  | Estado | Quando | O que aparece | Entrar |
  | --- | --- | --- | --- |
  | Conferindo | Logo que a tela abre (1 ou 2 s) | "Fazendo a verificação de segurança…" com o círculo girando | Desligado |
  | Concluída | O widget devolveu o token | "Verificação de segurança concluída" com o escudo verde | Ligado |
  | Pedir clique | A Cloudflare desconfiou da conexão (`before-interactive-callback`) | "Confirme que é você para continuar." e a caixa para marcar | Desligado até marcar |
  | Não carregou | O script não carregou (`error-callback`, bloqueador, rede) | "A verificação de segurança não carregou." e o botão **Recarregar a verificação** | Desligado |
  | Não passou | O servidor recusou o token (`turnstileFailed`) ou ele venceu (`expired-callback`) | "Não deu para confirmar. Tente de novo." e "Recarregar a verificação" | Desligado |
  | Espera | Muitas falhas na mesma rede (`MAX_TURNSTILE_FAILURES_PER_NETWORK`, hoje 10) | "Muitas tentativas desta rede. Tente de novo em 15 minutos." e a contagem | "Espere 14:52" |

  Um robô de verdade fica preso em "Pedir clique" ou "Não passou": o servidor recusa o login sem token válido, e a contagem por rede leva à espera. A pessoa nunca vê código de erro.
- **"Esqueci minha senha"** fica ao lado do rótulo da senha e abre a recuperação que já existe (`/recuperar-senha`, etapa 11): e-mail, verificação, "Enviar o link" e a mesma resposta para qualquer e-mail ("Se o e-mail for o da conta, o link chega em alguns minutos. Ele vale por 30 minutos e funciona uma vez só."). O link pede o código de duas etapas quando ele está ligado. A tela deixa de dizer quando o envio de e-mail não está configurado; isso fica para o achado de auditoria já registrado (resposta uniforme), que precisa da decisão do Pablo.

### Menu CRM (PR B e PR H)

- Item novo **CRM** no menu lateral (ícone `handshake`), no grupo Relacionamento, com três partes: **Automações** (ícone `zap`), **Fluxos** (`workflow`) e **Credenciais** (`key-round`). No celular fica na folha "Mais".
- "Conexões" vira "Credenciais" em todo texto do CRM (títulos, botões, diálogos, avisos de uso: "Usa: credencial do Chatwoot"). As chaves do catálogo mudam junto, pt-BR e en.
- O antigo item Automações vira **Rotinas** (ícone `alarm-clock`), só com a lista das rotinas, sem abas. Fluxos vão para o CRM, perto das credenciais que usam. Um fluxo que usa uma credencial abre a escolha pelo nome, como hoje.
- A parte de servidor (quais fluxos do n8n viram módulo, ordem, credenciais por tipo) está em [modulos-crm.md](modulos-crm.md).

### Termos (pedido do Pablo, 10/11, 02:45)

| Termo | O que é | Onde fica |
| --- | --- | --- |
| **Rotina** | O que a Zuri roda sozinha para você: lembrete, resumo ou rotina com IA ("Rotina da Zuri") | Menu **Rotinas** (antes Automações). Botão "Criar rotina" |
| **Automação** | Processo do consultório trazido do n8n (pedido de avaliação, confirmação de consulta, boas-vindas); você liga, escolhe a credencial e acompanha o ensaio | CRM › **Automações** (antes Módulos) |
| **Fluxo** | Automação que você monta passo a passo no editor | CRM › **Fluxos** |
| **Credencial** | Endereço e chave de um serviço de fora, guardados uma vez | CRM › **Credenciais** |

No código e nos planos de servidor, "módulo" continua como nome interno (`modulos.md`, `modulos-crm.md`); nada na tela diz "módulo". A regra de textos (`.claude/rules/textos-da-interface.md`) muda junto.

### Menu lateral em grupos (PR B; pedido do Pablo, 10/11, 02:24)

- Três grupos, com títulos pequenos que somem quando o menu está recolhido: sem título **Início** e **Conversa**; **Organizar** com Tarefas, Agenda, Notas, Memória e Rotinas; **Relacionamento** com Contatos, Avaliações e CRM. Cada grupo é uma lista com `aria-labelledby` no título.
- Ícones (lucide, um traço só, mesmo tamanho): Início `house`, Conversa `messages-square`, Tarefas `list-todo`, Agenda `calendar-days`, Notas `notebook`, Memória `brain`, Rotinas `alarm-clock`, Contatos `book-user`, Avaliações `star`, CRM `handshake`. Nenhum ícone se repete entre itens do menu.
- A contagem continua à direita do item, com o motivo para o leitor de tela ("4 para hoje").

### Conversas recentes (PR D e servidor; pedido do Pablo, 10/11, 02:24)

- A tela Conversa ganha a lista das conversas ao lado (no celular, atrás do botão de lista do cabeçalho), com busca, grupos por data, "Em uso" na atual e "Nova". Abrir uma conversa antiga mostra o histórico e um aviso: "Esta conversa terminou. Escrever aqui continua na conversa de hoje."
- **Conversa nova todo dia à 0:00** (pedido do Pablo, 10/11, 03:12; troca a regra das 24 h depois da primeira mensagem): à meia-noite do fuso do dono (Configurações › Conta), a conversa em uso fecha e uma nova começa. Vale no app e no Telegram (que hoje fica numa conversa só até `/nova_conversa`). A troca usa o alarme único que já existe (regra P8): o despertar depois da 0:00 cria a conversa nova e avisa a tela aberta pelo canal de tempo real, que passa para ela sozinha. Se o objeto não despertar na hora, a primeira mensagem depois da 0:00 faz a troca antes de responder. Dia sem mensagem não cria conversa vazia: a nova só é gravada quando algo é escrito nela.
- A conversa nova leva o resumo curto da anterior (o mesmo resumo que o histórico longo já gera), sem chamada extra de IA; a memória continua igual. Isso evita mandar 200 linhas de histórico a cada pergunta e a perda de contexto do corte.
- Configurações › Conta › **Conversas**: "Começar uma conversa nova todo dia à 0:00", ligado por padrão. O cabeçalho da conversa mostra "Desde hoje, 08:12 · nova conversa à 0:00"; a lista diz "Todo dia, à 0:00, começa uma conversa nova. As anteriores ficam aqui."
- Sem migration nova: o início da conversa já está em `zur_conversations.created_at` e a preferência é uma chave de `zur_settings`. Testes: a troca acontece uma vez só com mensagens simultâneas e com o alarme ao mesmo tempo; mensagem às 23:59:59 fica na conversa do dia e à 0:00:00 vai para a nova (relógio falso, fuso de São Paulo e outro fuso); horário de verão não cria duas trocas; uma conversa antiga reaberta e escrita continua na conversa do dia.

### Exemplo do link de avaliação (PR G2)

- Em Avaliações › Pedidos, o botão "Como funciona o link" (e "Ver um exemplo do link" no texto do funil) abre um diálogo em três passos: a mensagem que o paciente recebe com `zuri.exemplo.com.br/a/k7Q2mX9p`; o que acontece no toque (a Zuri anota a abertura e leva direto à página de avaliação do Google; a prévia do WhatsApp não conta como abertura; o link vale 30 dias); e a linha do tempo do pedido (enviado, entregue, aberto, avaliou 5 estrelas e ligado ao contato).
- O link curto e a contagem de aberturas são do servidor do pedido de avaliação ([sinal-refinado-funcionalidades.md](sinal-refinado-funcionalidades.md), seção 8).

### Chaves dos modelos pagos (resposta ao Pablo, 10/11, 02:24)

- Continuam como segredos do Worker (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`), gravados no painel da Cloudflare, como no guia de instalação. A tela não recebe nem guarda a chave: mostra só "Chave gravada" ou "Sem chave", o botão de ligar com a senha (como hoje) e o passo a passo para gravar ou trocar.
- Por quê: a chave nunca chega ao navegador, ao banco do Durable Object nem ao backup (regra 2 do `AGENTS.md`); trocar a chave não depende de a Zuri estar no ar; e quem invadir uma sessão não consegue ler nem trocar a chave para gastar no cartão do Pablo.

### Intervalo entre mensagens do Chatwoot (PR H e servidor das credenciais)

- Na credencial do Chatwoot, o grupo **Intervalo entre mensagens** com "De" e "Até" (30 s a 1 min, que é também o padrão; pedidos do Pablo de 10/11, 03:01 e 03:22). "De" maior que "Até" não salva e o erro aparece no campo. Mudar o intervalo não pede a chave de novo.
- Em **CRM › Envios**, a fila de envio mostra a situação, a última enviada, a próxima, as que esperam e o histórico por período ([envios-monitoramento.md](envios-monitoramento.md)). Credenciais fica só com o resumo e o intervalo.
- Cotas do plano grátis da Cloudflare (conferidas em 10/11 com `docs/arquitetura/orcamento-free-tier.md`): com o teto de 60 mensagens por dia, são no máximo uns 120 despertares do alarme único (0,1% das 100.000 requisições diárias do objeto), 4 a 7 subrequisições por envio (o teto é 44 por despertar) e algumas centenas de linhas gravadas (de 100.000). Entre um envio e outro o objeto dorme, então a duração quase não conta. O piso de 30 s não chega perto de nenhum limite da Cloudflare; quem limita o ritmo é o risco de bloqueio do número no WhatsApp não oficial.
- A lógica no servidor (um relógio por credencial, próximo horário livre guardado no banco com atualização condicional, prioridade, mensagem que perderia a hora vira aviso) está em [modulos-crm.md](modulos-crm.md), seção 6, e vale para todos os módulos que usam a mesma credencial.

### Versão (PR H e servidor pequeno)

- `APP_VERSION` (`packages/shared/src/version.ts`) já vai no bundle da tela. O servidor ganha `GET /api/version` (sessão exigida, resposta `{ version }`, sem cache), que lê a mesma constante do bundle do Worker.
- **Configurações › Sobre a Zuri:** "Zuri 0.39.2", data da instalação, e uma das duas linhas: "Tudo na mesma versão" ou "A tela está em X e o servidor em Y. Recarregue a página." com o botão "Recarregar". "Conferir de novo" chama a rota. Embaixo, "Novidades desta versão" (do `CHANGELOG.md`, gerado no build, só os itens da versão) e "Ver todas as versões" (abre as releases em outra aba).
- No menu do perfil, uma linha própria logo abaixo de "Avisos", com o ícone de etiqueta: "Versão" à esquerda e o número (0.39.2) discreto à direita; leva a Sobre a Zuri (pedido do Pablo, 10/11, 02:00). "Agenda" sai desse menu.
- Assim, depois de cada atualização, o Pablo abre Sobre e vê a versão nova e "Tudo na mesma versão".

### Relatar no GitHub (PR H)

O link já sai preenchido hoje (`apps/web/src/lib/issue-report.ts`, modelo `erro.yml`): título, contexto (rota, datas, versão), obtido e código. Melhorias:

- Preencher também **Passos para reproduzir** (a partir da origem da falha, sem conteúdo do dono), **Esperado** e **Impacto** (pela contagem de 30 dias).
- Antes de abrir o GitHub, um diálogo mostra cada campo como vai chegar, com "Abrir no GitHub" e "Cancelar". O campo "Onde aconteceu" (lista suspensa) o GitHub não deixa preencher pelo link; a prévia avisa para escolher lá.
- Nada de conteúdo de conversa, nota ou contato vai no link; o teste confere.

### Agenda no horário de trabalho (PR F e servidor pequeno)

- **Configurações › Agenda:** "Horário de trabalho" (começa e termina, com a barra de 24 h), "Dias de trabalho", "Eventos de dia inteiro" (Mostrar ou Esconder) e "Eventos fora do horário" (Mostrar nas linhas "Antes" e "Depois" ou Esconder).
- Na Agenda, dois botões de alternar ficam na barra ("Dia inteiro" e "Fora do horário") para mudar só naquela visita. O que fica escondido nunca some sem aviso: uma linha diz "1 evento de dia inteiro escondido · Mostrar" ou "2 eventos escondidos fora do horário · Mostrar".
- A visão Mês mostra tudo (é um resumo). A conversa e as rotinas continuam vendo todos os eventos; a preferência é só da tela.
- Servidor: a preferência entra em `zur_settings` (sem migration nova se couber nas chaves existentes; senão, a próxima livre).
- **Hoje de verdade** (pedido do Pablo, 10/11, 03:17): a Agenda abre na semana de hoje, no fuso do dono, e marca o dia atual na faixa dos dias, na coluna da semana e no mês (`aria-current="date"`). À 0:00 a marca passa para o dia novo sem recarregar (a linha da hora já roda a cada minuto; ao virar o dia, a tela troca a semana se preciso). O Início mostra a data do dia ("Terça-feira, 10 de novembro"). Teste com relógio falso às 23:59 e à 0:00.
- **Sem a data da semana:** a visão Semana não tem mais o título "9 a 15 de novembro"; a faixa dos dias já mostra os números. Dia e Mês mantêm o título ("Terça, 10 de novembro", "Novembro de 2026").
- **Barra no celular:** setas e "Hoje" à esquerda e Dia/Semana/Mês à direita na mesma linha; "Dia inteiro" e "Fora do horário" embaixo, em duas colunas iguais. Nada quebra linha em 360 px.

### Como responder, em Avaliações (PR G2 e servidor)

Uma aba nova dentro de Avaliações junta o que hoje está espalhado, em seis blocos:

1. **Sobre o consultório:** nome que aparece, como chamar quem é atendido e até 600 caracteres do que vale lembrar. Entra no prompt como dado (`<data>`), nunca como ordem; o verificador barra telefone, endereço, preço e link.
2. **Instruções para a Zuri:** a camada do dono do agente `review_draft` (hoje em Modelos e limites), até 2.000 caracteres, com contador, as 20 versões guardadas e "Voltar ao padrão". Tom e assinatura ficam aqui.
3. **O que fazer em cada nota:** 5 e 4 estrelas viram rascunho para aprovar (publicar sozinha só depois de 10 aprovações, regra que já vale); 1 a 3 estrelas só avisam a equipe. A IA pode deixar a resposta mais cuidadosa, nunca menos.
4. **Exemplos:** até 3 respostas já publicadas pelo Pablo, para imitar o jeito.
5. **Nunca dizer:** palavras proibidas (as de saúde, preço, promessa e jurídico já vêm marcadas).
6. **Testar antes de salvar:** escolhe uma avaliação e gera um rascunho sem publicar, com a segunda leitura e o custo (cerca de 30 Neurons). Salvar pede a senha.

As regras fixas e a segunda leitura (`docs/planos/guardrails-multiagentes-ia.md`) continuam por baixo e não mudam. Servidor: campos novos na configuração do agente, rota de teste com o limite diário de IA.

### Memória em mapa (PR D)

É viável sem custo novo. A visão Mapa desenha a memória escolhida no centro, as memórias ligadas em volta e os "centros" (pastas, pessoas, conversas) como nós maiores. As ligações saem do que já existe: memória criada numa conversa, citada numa tarefa ou nota, mesma pasta, mesma pessoa. Nada de IA nova nem de busca por significado (que segue desligada).

- Tela sob demanda (lazy), sem biblioteca de grafo: SVG simples com posições calculadas, teto de 200 nós; acima disso, só os vizinhos da memória escolhida.
- A Lista continua sendo o padrão e o caminho acessível; o Mapa é extra, e cada nó é botão com nome.
- No celular, o Mapa ocupa a largura toda e os rótulos só aparecem ao tocar.

### Nada escondido (todas as PRs de interface)

A varredura de 10/11 procurou em cada tela, nos dois tamanhos, elementos que rolam de lado ou cortam conteúdo. Ficou assim, e vale para o app:

- Nenhuma faixa de botões rola de lado. Filtros com muitas opções viram uma lista que abre (etiquetas dos contatos, seções das Configurações no celular: "Seção: Agenda ▾").
- No celular, abas viram uma grade de colunas iguais: até três numa linha, quatro em 2 × 2 (Avaliações, Tarefas). Nenhuma aba fica sozinha numa linha nem corta o texto (pedido do Pablo, 10/11, 02:32).
- Linhas com ícone (Automações do CRM, Rotinas, "Precisa de você") usam ícone de 32 px no canto, texto ao lado e os botões embaixo, alinhados ao texto. Título com selo ("Esperando aprovação") põe o selo na linha de baixo em vez de partir o título.
- Botões de decisão com textos longos (Memória › Para revisar) ficam em grade: a ação principal na largura toda, as outras duas a duas.
- Botão com ícone mostra o texto também no celular quando cabe (Pastas e Lixeira em Tarefas).
- O teste de cada PR roda a mesma varredura no e2e: nenhum elemento visível com rolagem lateral escondida em 390 px e 1440 px.

### Frases descritivas

Cada tela tem uma frase curta embaixo do título, que diz o que dá para fazer ali, na voz da pessoa e sem citar infraestrutura (prática do Material, do Apple HIG e do GOV.UK: verbo, benefício, sem jargão; a mesma estrutura em todas as seções). Textos do protótipo:

| Onde | Frase |
| --- | --- |
| Tarefas | O que vence hoje, o que vem depois e o que já foi feito. |
| Notas | Ideias, listas e o que veio das conversas. Tudo se salva sozinho. |
| Agenda | Seus eventos do Google Agenda, sempre atualizados. O que você cria aqui ou pela Zuri vai direto para lá. |
| Memória | O que a Zuri lembra sobre você e como cada coisa se liga. Você corrige ou apaga quando quiser. |
| Rotinas | Lembretes, resumos e rotinas que a Zuri roda para você, no seu fuso. |
| CRM › Automações | Automações do consultório trazidas do n8n, já testadas. Você liga, escolhe a credencial e acompanha o ensaio. |
| CRM › Fluxos | Automações que você monta passo a passo, com hora para rodar e limites. |
| CRM › Credenciais | Endereços e chaves dos serviços de fora, guardados uma vez e usados por todas as automações e fluxos. |
| Avaliações | O que dizem do consultório no Google, as respostas que a Zuri prepara e os pedidos de avaliação. |
| Avaliações › Ajustes | Conexão com o Google (ler, importar e responder) e Como responder ([avaliacoes-conexao-e-respostas.md](avaliacoes-conexao-e-respostas.md)) |
| Configurações | Conta, segurança, integrações e o jeito como a Zuri trabalha para você. |
| › Conta | Nome, idioma, fuso, tema e senha |
| › Agenda | Horário de trabalho, visualização e lembretes |
| › Segurança | Duas etapas, passkeys, sessões e acesso pela API |
| › Uso da IA | Quanto a IA usou hoje e em cada período |
| › Modelos e limites | Modelo de IA, agentes e limites |
| › Avisos | O que chega, quando e por qual canal |
| › Integrações | Google, Telegram e outros serviços |
| › Dados | Cópias de segurança, espaço e lixeira |
| › Diagnóstico | Falhas recentes e como relatar |
| › Sobre a Zuri | Versão instalada e novidades |
| Entrar | Entre para continuar de onde parou. Lado da marca: "Sua agenda, suas tarefas e seus lembretes, em ordem." |
| Esqueci minha senha | Criar uma senha nova: "Informe o e-mail da conta. Se ele estiver cadastrado, você recebe um link para criar a senha nova." |

Cada PR passa os textos novos pela `humanizer:humanizer` e põe a tradução en junto.

### Consumo por período (PR H e PR de servidor)

Dia, Semana, Mês e Ano num seletor só, com um gráfico de colunas, a linha tracejada do teto diário (Semana e Mês), total, média e pico, e "Ver em tabela". A develop já tem `/api/usage/history?days=7|30|90` com retenção de 90 dias (P13). Faltam:

- **Dia (por hora):** contadores por hora só de hoje, 24 linhas que se reaproveitam, zeradas à meia-noite.
- **Ano (por mês):** um resumo por mês, gravado no primeiro uso de cada dia a partir do dia anterior; 12 linhas.

Migration de acréscimo com as duas tabelas pequenas, `days=365` não é aceito: o ano lê o resumo por mês.

### Rotas e contratos

Nenhuma mudança nas PRs A a I. As PRs de servidor listadas na seção 4 trazem as suas.

### Banco

Nenhuma mudança nas PRs A a I.

### Ferramentas do agente

Nenhuma.

### Agendamentos, IA e integrações externas

Nenhum. A linha de agora usa só o relógio do navegador.

## 8. Custo e cotas do plano Free

Nenhum custo na Cloudflare. A fonte Figtree (licença OFL) vai em woff2 com subconjunto latino, cerca de 2 × 25 kB, servida pelo `ASSETS` com cache longo; não entra no JS. O peso que importa é o do JS inicial (seção 1).

## 9. Segurança e privacidade

- Nada novo chega ao navegador. Telefone e e-mail mascarados onde o protótipo mascara.
- A fonte é servida pelo próprio Worker, sem Google Fonts nem outro serviço de fora (regra sem telemetria).
- A CSP continua igual; nada de estilo ou script embutido novo.
- Auditoria em modo orientação ao fim de cada PR.

## 10. Testes

- e2e de cada área, atualizados no mesmo commit da mudança de nome acessível.
- Teste novo da linha de agora com relógio simulado (Playwright `clock`): a linha anda e o item passa para a cortina.
- Teste da cortina: recolhida por padrão, abre e fecha pelo teclado, pendências contadas.
- axe em todas as telas, nos dois temas e nos dois tamanhos.
- Capturas por `node scripts/capturas-da-interface.ts` em `docs/capturas/pr/<assunto>/`.
- `npm run size` em cada PR.

## 11. Entrega e cronograma

Tudo o que foi definido no protótipo entra no app. A ordem respeita as dependências; cada linha é uma PR para a `develop`, com plano, testes, QA, auditoria e capturas. "Servidor" vem antes da interface que usa aquilo, ou junto.

| # | PR | O que entra | Depende de | Tamanho |
| --- | --- | --- | --- | --- |
| 1 | A · Fundamentos | Tokens, Figtree em woff2, peças base, tema só com ícones | Aprovação do Sinal refinado | M |
| 2 | B · Casca | Menu lateral em três grupos com ícones revistos, Avaliações, Rotinas e CRM (Automações, Fluxos, Credenciais), menu de baixo no celular, folha "Mais", perfil e avisos em painel (linha "Versão" abaixo de "Avisos", sem "Agenda"), ⌘K | A; teto do JS aprovado (até 141 kB, resposta 2 de 10/11) | G |
| 3 | I · Entrada | Textos novos, campo de e-mail sem exemplo, os seis estados da verificação de segurança, "Esqueci minha senha" ao lado da senha, recuperação no desenho novo, título da página de erro | A | P |
| 4 | C · Início | Saudação pela hora, cortina do que passou, pendências | B | M |
| 5 | Servidor · sugestões | [sugestoes-do-inicio.md](sugestoes-do-inicio.md) e as sugestões no Início | C | M |
| 6 | D · Conversa e Memória | Lista das conversas recentes com busca; preferência "conversa nova todo dia à 0:00"; sem clipe; um componente de gravação para todos os microfones; memória com filtros, lista agrupada, painel e visão Mapa | B | M |
| 6b | Servidor · conversa do dia | Troca de conversa à 0:00 no fuso do dono pelo alarme único, com reserva na chegada da mensagem (app e Telegram), resumo da anterior, preferência | — | P |
| 7 | E · Tarefas e Notas | "Pastas", "Nova nota", salvamento automático | B | M |
| 8 | F · Agenda | Dia de hoje de verdade e troca à 0:00, sem título da semana, barra do celular em duas linhas, linha de agora, legenda, rodapé "Configurações", horário e dias de trabalho, esconder dia inteiro e fora do horário com aviso (servidor pequeno junto) | B | M |
| 9 | Servidor · sincronização | Contatos 5 min, Avaliações 10 min, etiquetas por hora, recarga só com mudança, campos novos ([plano](sincronizacao-contatos-avaliacoes.md), PR 1) | — | M |
| 10 | G · Contatos | Sem Clientes, filtro de etiquetas em lista com busca, contagem, ficha com todos os campos e "Vazio no Google" | B, 9 | M |
| 11 | Servidor · métricas | Métricas das avaliações ([plano](sincronizacao-contatos-avaliacoes.md), PR 2) | — | P |
| 12 | G2 · Avaliações | Área própria: Visão geral, Avaliações, Pedidos (com o exemplo do link) e Ajustes, com a conexão com o Google e Como responder ([avaliacoes-conexao-e-respostas.md](avaliacoes-conexao-e-respostas.md); com o servidor dos campos novos e do teste) | B, 11 | M |
| 13 | Servidor · consumo | Contadores por hora e resumo por mês | — | P |
| 14 | H · Rotinas, CRM e Configurações | Rotinas; CRM com Automações (vazia até a 16), Fluxos e Credenciais; Configurações com Sobre a Zuri e `/api/version`; Relatar no GitHub com prévia; consumo por dia/semana/mês/ano | B, 13 | G |
| 15 | Servidor · credenciais | Tipo de credencial (`http`, `chatwoot`), senha, troca de chave, intervalo entre mensagens e fila por credencial, remoção bloqueada em uso ([modulos.md](modulos.md), [modulos-crm.md](modulos-crm.md)) | H | M |
| 16 | Servidor · automações do CRM (módulos no código) | Manifesto, ensaio, comparação, rotas ([modulos.md](modulos.md), PR 1) | 15 | G |
| 17 | Automação · Pedido de avaliação | Fila, dias úteis, homônimos, Chatwoot ([envio-chatwoot-pela-zuri.md](envio-chatwoot-pela-zuri.md)) | 16, 12 | G |
| 18 | Catálogo de modelos | Conferido sozinho uma vez por dia | H | P |
| 19 em diante | Uma automação por fluxo do n8n | Na ordem de [modulos-crm.md](modulos-crm.md), cada um com a aprovação da exceção, se mandar mensagem a pacientes | 16 | M cada |
| Penúltima | Conferência das capturas | Nenhuma captura do visual antigo sobra no README nem em `docs/capturas/` | Todas as de interface | P |
| **Última** | **Pentest autônomo final** | Um agente autônomo age como pentester contra o sistema inteiro e depois aplica as correções (detalhes abaixo) | Tudo concluído **e** autorização explícita do Pablo | G |

Em paralelo depois da B: I, C, D, E, F; os servidores 9, 11 e 13 não dependem de interface e podem começar já.

### Capturas do README (pedido do Pablo, 10/11)

O README precisa mostrar o frontend novo. Cada PR que troca uma tela refaz, no mesmo PR, a captura correspondente do README com `node scripts/capturas-do-readme.ts` (regras em `.claude/rules/readme.md` e `.claude/rules/capturas.md`), nos dois temas. A PR #239 (README compacto) já deixou o espaço das capturas. A penúltima linha do cronograma confere que não sobrou nenhuma captura do visual antigo.

### Pentest autônomo final (pedido do Pablo, 10/11, 00:54)

**Trava:** só começa depois de todas as linhas anteriores mescladas **e** de uma autorização explícita do Pablo, dada na hora. Nenhuma rotina nem thread inicia esta etapa sozinha.

- Um agente autônomo se comporta como pentester e testa o sistema por completo: entrada e sessão, verificação de segurança, API e rotas, WebSocket `/api/live`, bot do Telegram, ferramentas do agente e injeção de prompt, MCP, módulos e credenciais do CRM, webhooks (Chatwoot e n8n), backup, cabeçalhos e CSP, custo no plano Free.
- Só contra o ambiente local ou de ensaio (`wrangler dev --local` ou um Worker de teste), nunca contra produção nem contra serviços de terceiros reais.
- Relatório em `docs/qa/auditorias/<data>-pentest-final.md`, no formato das auditorias anteriores.
- Correções em PRs para a `develop`, pelas regras de sempre (teste que prova a falha, QA, auditoria). Achado alto ou médio vai ao Pablo antes de corrigir.

### Conferência antes de cada merge

1. As capturas da PR batem com o protótipo nos 4 jeitos (claro, escuro, computador, celular).
2. Todo botão da tela faz o que diz (mesma varredura de cliques do protótipo, agora no e2e).
3. A tabela da seção 4 não perde nenhuma linha.
4. `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e` e `npm run size` verdes.

## 12. Riscos

- **Teto do JS.** Mitigação: medir na PR B, cortar ícones e código duplicado antes de pedir teto novo.
- **Testes e2e quebrando por nome.** Mitigação: manter os nomes acessíveis; mudar teste no mesmo commit.
- **Diferença entre protótipo e app.** Mitigação: capturas lado a lado na PR, nos 4 jeitos (dois temas, dois tamanhos).

## 13. Suposições

- O Tailwind atual aceita os tokens como variáveis CSS, sem plugin novo.
- O lucide continua sendo a família de ícones.

## 14. Entrevista com o Pablo

### Perguntas abertas

1. Aprovar o Sinal refinado como a nova interface? Recomendação: sim; a PR A começa em seguida.
2. ~~Teto do JS inicial para a casca nova~~ Respondida em 10/11: sim, até 141 kB se a economia não bastar.
3. ~~Configurações › Agenda como preferência nova~~ Respondida em 10/11: sim (horário, dias, dia inteiro e fora do horário).
4. Ordem do cronograma da seção 11? Recomendação: como está, com os servidores 9, 11 e 13 começando já, porque não dependem da interface.
