# Plano · Implementar o Sinal refinado, PR a PR

Situação: plano. Pedido do Pablo em 10/11/2026, 16:07: revisar o protótipo contra o código, nos dois sentidos, corrigir o que estiver errado, escrever o plano de implementação e seguir etapa a etapa. Este plano **manda na ordem e no conteúdo de cada PR**; o desenho de cada funcionalidade continua nos planos da PR #204 (`docs/planos/novo-frontend-sinal.md`, `sinal-refinado-funcionalidades.md`, `envio-chatwoot-pela-zuri.md`, `sincronizacao-contatos-avaliacoes.md`, `sugestoes-do-inicio.md`, `avaliacoes-conexao-e-respostas.md`, `link-de-avaliacao.md`, `envios-monitoramento.md`, `modulos.md`) e da PR #247 (`modulos-crm.md`). Onde este plano divergir do cronograma antigo (`novo-frontend-sinal.md`, seção 11), vale este.

## 1. Resumo

O protótipo aprovado (`docs/planos/modelos-frontend/prototipo-interativo.html`, com os ajustes até 10/11, 15:34) entra no app em **PRs pequenas e ordenadas**, uma por conversa. As 8 primeiras trocam a cara das telas que já existem, sem funcionalidade nova de servidor além do mínimo de cada uma. Depois vêm as funcionalidades novas (Avaliações com área própria, CRM, Envios, automações do n8n), cada uma com servidor e tela juntos.

A revisão cruzada de 10/11 comparou as 39 vistas do protótipo com as rotas, as telas, o catálogo de textos e as 195 rotas da API da `develop` (versão 0.39.4). Achou **9 funcionalidades do código sem lugar no protótipo** (seção 4.1), **24 partes do protótipo que o código ainda não tem** (seção 4.2) e **7 erros no plano antigo** (seção 4.3). Nenhum deles muda uma decisão do Pablo; todos ganharam lugar e PR neste plano.

## 2. Contexto no sistema

- Interface em `apps/web/src/`: casca `components/AppShell.tsx` (menu lateral que recolhe, gaveta no celular, menu da conta), peças em `components/ui.tsx`, tema em `lib/theme.ts`, estilos e tokens em `styles.css`, paleta `components/CommandPalette.tsx`, avisos `components/NotificationCenter.tsx`, telas sob demanda em `pages/`.
- Rotas de hoje (`App.tsx`): `/`, `/conversa/:id?`, `/tarefas`, `/notas/:id?`, `/agenda`, `/contatos/:aba?`, `/automacoes/:aba?`, `/memoria`, `/configuracoes/:tab?`, `/acessos`, mais entrar, primeiro acesso, recuperação, `/aprovar` e 404.
- **O servidor grava e envia endereços dessas rotas**: `packages/shared/src/alerts.ts`, `apps/agent/src/alerts/*.ts`, `agent/zuri-agent.ts`, `push/service.ts`, `mcp/service.ts` e `diagnostics/service.ts` montam links para `/automacoes`, `/automacoes/fluxos`, `/contatos/clientes`, `/contatos/avaliacoes`, `/configuracoes/ia`, `/configuracoes/avisos`, `/configuracoes/integracoes`, `/configuracoes/seguranca`, `/configuracoes/diagnostico`, `/acessos` e `/tarefas`. Esses links já estão em avisos guardados, mensagens do Telegram e notificações do aparelho.
- Textos em `packages/shared/i18n/` (pt-BR por tela e `en`), lint de i18n e de microcopy na CI.
- Teto do JS inicial: 139,9 kB em `scripts/check-bundle-size.ts`; a `develop` usa 139.858 B. O Pablo aprovou subir até 141 kB na casca, se a economia não bastar.
- Próxima migration livre: 32. Só de acréscimo.
- Regras: `.claude/rules/` (web-ui, i18n, capturas, readme, performance P1 a P14, textos-da-interface, migrations).

## 3. Objetivo e critérios de aceite

1. Cada tela do app fica igual à do protótipo nos quatro jeitos (claro e escuro, 1440 px e 390 px), e sem corte em 320 px, 820 px e em janela baixa (600 px de altura).
2. Todo botão faz o que diz. O que depende de servidor que ainda não chegou **não aparece**.
3. Nenhuma funcionalidade da `develop` some: a tabela da seção 4.1 e a da seção 4 do plano antigo ficam inteiras a cada PR.
4. Todo endereço antigo continua abrindo a tela certa (seção 7, "Rotas").
5. axe sem violações em toda tela, nos dois temas e nos dois tamanhos; Lighthouse ≥ 95; teclado e leitor de tela em cada fluxo; alvo de toque de 44 px.
6. JS inicial dentro do teto (139,9 kB; até 141 kB só na PR S02, medido).
7. `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e` e `npm run size` verdes em cada PR; nenhum teste pulado, afrouxado ou com nova tentativa.
8. Cobertura no piso atual (agente 99%, shared 99,7%).

## 4. Escopo

### 4.1 O que o código tem e o protótipo não mostra

Cada linha ganhou um lugar na interface nova. O protótipo recebe a mesma mudança (pedido enviado à conversa que cuida dele, PR #249); se ela não entrar lá, vale esta tabela.

| # | Na `develop` | Onde fica no Sinal | PR |
| --- | --- | --- | --- |
| C1 | Conversa: **Renomear** e **Apagar conversa** | Menu "Mais opções" (⋯) de cada linha da lista de conversas | S05 |
| C2 | Memória: "Como a memória funciona" › **Revisão de conflitos** (liga e desliga `memoryConflictReview`) | Configurações › Assistente, cartão "Memória" | S16 (fica na tela de Memória até lá) |
| C3 | CRM: **Avisos do CRM** (`PATCH /crm/settings`) | Configurações › Avisos, grupo "CRM" | S15 |
| C4 | CRM: **Eventos do n8n** (endereço e segredo, `POST`/`DELETE /crm/events-key`) | CRM › Credenciais, cartão "n8n do consultório" | S15 |
| C5 | Clientes (funil, etiquetas, retorno, histórico) | A tela sai (decisão de 09/11, 21:51). As rotas `/api/crm/*`, as 5 ferramentas da conversa e os dados continuam. `/contatos/clientes` leva a Contatos | S10 |
| C6 | Fluxos: **Histórico dos fluxos** (`GET /flows/runs`) | CRM › Fluxos, "Últimas execuções" embaixo da lista, como em Rotinas | S15 |
| C7 | Avaliações: aba **Respondidas** e **Apagar a resposta no Google** | Filtro "Respondidas" na lista e item no ⋯ da resposta publicada | S12 |
| C8 | Estados "ainda não ligado" (Agenda sem Google, Contatos desligados, Avaliações desligadas, nenhuma agenda aberta) e os vazios de cada lista | O `EmptyState` que já existe (ícone, título, uma frase, um botão), com os tokens da S01 | cada PR de tela |
| C9 | Rotas `/acessos`, `/aprovar`, primeiro acesso, segundo passo, troca de senha, bloqueio, 404 e "Esta tela parou" | Mesmo desenho da tela de entrar | S03 (S16 para `/acessos`) |

Conferido e **presente** no protótipo: "Nunca enviar para fora" em notas e memórias, autonomia por ferramenta dos servidores MCP, "Publicadas sozinha", notificação neste aparelho, busca por significado, histórico da memória, aprovação de rotina, sugestões de fluxo, backup automático e lixeira por tipo.

### 4.2 O que o protótipo tem e o código não

| # | No protótipo | O que falta no código | PR |
| --- | --- | --- | --- |
| P1 | Tokens novos, Figtree, tema só com ícones | CSS, fonte servida pelo Worker, peças base | S01 |
| P2 | Menu em três grupos com Rotinas, Avaliações e CRM; menu de baixo e folha "Mais" no celular; perfil e avisos em painel; barra de cima que some ao descer | Casca nova e rotas novas com os endereços antigos redirecionando | S02 |
| P3 | Entrar com seis estados da verificação, e-mail sem exemplo, "Esqueci minha senha" ao lado da senha | Só interface | S03 |
| P4 | Início: "Seu dia" das 08:00 às 18:00 com cortina, pendentes e "N fora do horário · Mostrar"; data do dia | Só interface (a janela vem da preferência da S08; até lá, 08:00 a 18:00 fixo) | S04 |
| P5 | Sugestões do Início pelo dia real | Servidor (`sugestoes-do-inicio.md`) | S22 |
| P6 | Lista de conversas com busca e grupos por data; conversa antiga com aviso | Interface (a rota `GET /conversations` existe) | S05 |
| P7 | Conversa nova todo dia à 0:00, app e Telegram, com a preferência | Servidor: troca pelo alarme único, chave em `zur_settings` | S05b |
| P8 | Memória com filtros em linha, lista por tipo e painel ("Ligada a", "Aparece em", "Memórias próximas") | Rota de leitura das ligações (sem IA) | S06 |
| P9 | Memória › Mapa interativo | Parte sob demanda, SVG próprio, mesma rota da P8 | S06 |
| P10 | "Pastas" no lugar de "Projetos"; nota com salvamento automático; microfone no texto da nota | Textos, `useVoice` numa pasta comum, botão na nota | S07 |
| P11 | Agenda: hoje pelo fuso do dono, sem título na semana, barra do celular em grade | Interface | S08 |
| P12 | Configurações › Agenda: horário e dias de trabalho, visão ao abrir, primeiro dia, dia inteiro e fora do horário | Chaves novas em `zur_settings` e no schema | S08 |
| P13 | Contatos a cada 5 min com contagem, etiquetas por hora, campos novos, "Vazio no Google" | Servidor (`sincronizacao-contatos-avaliacoes.md`, PR 1) | S09 |
| P14 | Contatos: filtro de etiqueta em lista com busca, ficha em grupos, WhatsApp | Interface | S10 |
| P15 | Avaliações › Visão geral (índice, estrelas, funil, período) | Servidor de métricas | S11 |
| P16 | Avaliações com área própria e Ajustes › Conexão e Como responder | Interface e campos novos do agente | S12 |
| P17 | Avaliações › Agente e segurança: temperatura 0,5, publicação na hora, 12 casos de teste | Servidor: troca a regra das 10 aprovações pela decisão de 10/11, 12:02 | S12b |
| P18 | Consumo por dia (por hora) e por ano (por mês) | Duas tabelas pequenas | S13 |
| P19 | Rotinas sem abas, "Criar rotina" em 5 passos | Interface | S14 |
| P20 | CRM › Automações, Fluxos e Credenciais ("Conexões" vira "Credenciais") | Interface; Automações só aparece com a S18 | S15 |
| P21 | Configurações em cinco grupos; seção Assistente; Senha em Segurança; Telegram em Integrações; IP na atividade de acesso; Sobre a Zuri; Relatar no GitHub com prévia | Interface e `GET /api/version` (a API já devolve o IP) | S16 |
| P22 | Credencial do Chatwoot com intervalo, CRM › Envios | Servidor (`modulos.md`, `envios-monitoramento.md`) | S17, S19 |
| P23 | Automações do CRM, pedido de avaliação, link `/a/<código>` | Servidor (`modulos-crm.md`, `envio-chatwoot-pela-zuri.md`, `link-de-avaliacao.md`) | S18, S20 |
| P24 | Catálogo de modelos conferido sozinho | Servidor | S21 |

Fora do app: "Estados das telas" e "Identidade visual" são páginas de referência do protótipo.

### 4.3 Erros corrigidos no plano antigo

1. **Rotas.** O plano antigo dizia "nenhuma mudança de rota", mas o menu novo cria Rotinas, Avaliações e CRM. Sem tratar isso, links já enviados pelo Telegram e guardados nos avisos abririam a tela errada. Correção na seção 7.
2. **Agenda.** O texto ainda punha "Dia inteiro" e "Fora do horário" na barra da Agenda; a decisão de 10/11, 12:35 deixou os dois só em Configurações › Agenda.
3. **Configurações.** Faltavam os cinco grupos, a seção Assistente, a Senha em Segurança e o Telegram em Integrações (10/11, 12:35).
4. **Faltavam no cronograma:** CRM › Envios, "Pedidos e link", "Agente e segurança", microfone nas notas, IP na atividade de acesso e a janela de 08:00 a 18:00 do Início.
5. **Teto do JS.** A PR da casca não pergunta de novo: o Pablo já aprovou até 141 kB.
6. **Migrations.** O plano antigo não dizia quem pega qual número. Regra: ninguém reserva número; cada PR de servidor cria a próxima livre na hora de mesclar e, se outra entrou antes, renumera a sua antes do merge.
7. **Menu do perfil.** O item "Acessos" de hoje não está no protótipo: o caminho passa a ser Segurança › "Ver todos os acessos", e `/acessos` continua valendo.

### Fora

Trocar a marca, o nome ou o domínio; tela de Clientes; qualquer serviço pago; deploy, release e merge na `main`.

## 5. Como funciona para o Pablo

Cada PR troca uma área. A descrição traz as capturas de antes e depois nos quatro jeitos e a lista do que mudou. O app continua usável entre uma PR e outra: até a tela nova de uma área chegar, a antiga funciona dentro da casca nova.

### Textos visíveis

Os do protótipo, pelas chaves que já existem quando o sentido é o mesmo; os novos em pt-BR e en, com a `humanizer:humanizer`. Termos fechados: Rotina, Automação (do CRM), Fluxo, Credencial, Pasta. A regra `.claude/rules/textos-da-interface.md` muda na S02 (glossário: "Rotina" no lugar de "Automação" para as da Zuri).

## 6. Regras de negócio e limites

- PRs S01 a S04, S06 (menos a rota das ligações), S10, S14 e S15 não mudam regra de negócio.
- Automação que escreve a contatos nasce desligada e em ensaio. Nenhuma liga sozinha.
- Números em tela saem de `packages/shared` (limites, tetos, prazos), nunca digitados na tela.
- Verde só na ação principal; contraste 3:1 nos controles e 4,5:1 no texto; nada de preto puro no escuro; movimento só com "reduzir movimento" desligado.

## 7. Desenho técnico

### Rotas

Rotas novas, criadas na S02 apontando para as telas de hoje, e trocadas pela tela nova na PR de cada área:

| Endereço novo | Abre | Endereços antigos que passam a redirecionar |
| --- | --- | --- |
| `/rotinas` | Rotinas | `/automacoes`, `/automacoes/rotinas` |
| `/crm/:parte?` (`automacoes`, `fluxos`, `envios`, `credenciais`) | CRM | `/automacoes/fluxos` → `/crm/fluxos`; `/automacoes/conexoes` → `/crm/credenciais` |
| `/avaliacoes/:aba?` | Avaliações | `/contatos/avaliacoes` |
| `/contatos` | Contatos | `/contatos/clientes` (na S10) |
| `/configuracoes/:tab?` | Configurações | os nomes de seção de hoje continuam; `/configuracoes/ia` segue valendo |

- O redirecionamento é do roteador da tela (`<Navigate replace>`), mantém `?` e `#` e fica **para sempre**: há links antigos em avisos guardados e em mensagens do Telegram.
- As constantes do servidor (`packages/shared/src/alerts.ts` e os arquivos da seção 2) passam a gerar o endereço novo na mesma PR que cria a rota. Um teste percorre todo endereço que o servidor gera e confere que a tela abre sem passar pelo 404.
- O service worker e o `_headers` não mudam: toda rota de tela já cai no `index.html`.

### Arquivos

| PR | Arquivos principais |
| --- | --- |
| S01 | `apps/web/src/styles.css`, `components/ThemeSwitcher.tsx`, `apps/web/src/fonts/` (o build põe o hash no nome, então o cache longo de `/assets/` já vale), `docs/interface.md` |
| S02 | `components/AppShell.tsx` (dividido em `shell/Sidebar.tsx`, `shell/TabBar.tsx`, `shell/MoreSheet.tsx`, `shell/AccountPanel.tsx`), `lib/nav.ts` (a lista única do menu, usada pela lateral, pela folha "Mais" e pela paleta), `NotificationCenter.tsx`, `CommandPalette.tsx`, `App.tsx`, `packages/shared/src/alerts.ts` e os geradores de link do agente |
| S03 a S16 | A pasta `pages/` da área, o `pt-BR-<tela>.ts` dela, os e2e da área |

### Banco

| PR | Mudança |
| --- | --- |
| S05b | Nenhuma tabela; chave `dailyConversation` em `zur_settings` |
| S06 | Nenhuma; a rota das ligações lê o que já existe |
| S08 | Chaves da Agenda em `zur_settings` |
| S09, S11, S13, S17 a S21 | Migration de acréscimo, a próxima livre na hora (seção 4.3, item 6), pela skill `nova-migration` |

### Ferramentas do agente

Nenhuma nova até a S18. As que existem não mudam.

### Agendamentos, IA e integrações externas

S05b, S09, S17 e S19 usam o alarme único (regra P8). S12b e S22 chamam IA dentro do teto diário, sem nova tentativa automática (P7). Chatwoot só a partir da S17, desligado até o Pablo ligar.

## 8. Custo e cotas do plano Free

Nenhum recurso novo da Cloudflare. A Figtree (licença OFL) vai em dois arquivos woff2 de subconjunto latino, servidos pelo `ASSETS` com cache de um ano; não entra no JS. Cada PR de servidor traz a tabela "Custo no plano Free" com a medida do teste de orçamento (P1). Nada marcado com ⚠️ neste plano.

## 9. Segurança e privacidade

- A fonte sai do próprio Worker; nada de Google Fonts (regra sem telemetria). CSP igual, sem estilo ou script embutido.
- Redirecionamentos só entre rotas internas fixas; nenhum destino vem do endereço.
- IP na atividade de acesso: dado que o servidor já devolve à sessão do dono; nas capturas, só faixas de documentação.
- Mapa da memória: rótulos são texto do dono, sempre como texto do SVG, nunca HTML.
- Auditoria (`auditoria-seguranca`) ao fim de cada PR, em modo orientação nas de interface e completa nas S12b, S17, S18, S19 e S20. Pentest autônomo no fim, só com autorização do Pablo dada na hora.

## 10. Testes

Matriz mínima de cada PR de tela:

| Camada | O que confere |
| --- | --- |
| e2e da área | Cada critério de aceite da PR; nomes acessíveis atualizados no mesmo commit |
| e2e "nada escondido" | Nenhum elemento visível com sobra lateral em 320, 390, 820 e 1440 px, e em 1440 × 600 |
| e2e de cliques | Todo botão da tela abre o que promete, com foco preso no diálogo, Esc e volta do foco |
| axe | Claro e escuro, computador e celular, sem violação |
| Regressão | A linha da área na seção 4.1 e na tabela do plano antigo, uma a uma |
| i18n | pt-BR e en; lint de microcopy |
| Tamanho | `npm run size` |
| Capturas | `docs/capturas/pr/<assunto>/`, antes e depois; README refeito quando a tela aparece nele |

Nas de servidor, além disso: contrato da rota (schema e códigos de erro), orçamento (P1), abuso (entrada vazia, enorme, repetida, concorrente, fora de ordem), fuso e horário de verão, limites n−1, n e n+1.

## 11. Entrega

Uma PR por linha, para a `develop`, uma por conversa. Branch `feat/sinal-NN-<assunto>`. "Depende de" é o que precisa estar mesclado antes.

| # | PR | Entrega | Critérios de aceite próprios | Depende de |
| --- | --- | --- | --- | --- |
| S01 | Fundamentos | Tokens do Sinal refinado (claro com fundo `#f1f1f3`), Figtree, cantos, tema só com ícones. As peças base que já existem em `components/ui.tsx` (botão, campo, cartão, diálogo, aviso, vazio, esqueleto com a linha verde) ganham a cara nova pelos tokens; peça que muda de forma ou que ainda não existe (segmentado, selo, folha) entra na PR da primeira tela que a usa | Toda tela de hoje continua funcionando e passa no axe com as cores novas; a fonte carrega do próprio endereço; nenhuma tela com sobra lateral em 320, 390, 820 e 1440 px e em 1440 × 600 | — |
| S02 | Casca | Menu em três grupos, rotas novas com redirecionamento, menu de baixo e folha "Mais", perfil e avisos em painel e folha, linha "Versão", barra de cima que some ao descer, paleta com a mesma lista do menu | Seção 7 "Rotas" inteira; só o conteúdo rola; teclado na lateral recolhida; JS ≤ 141 kB medido | S01 |
| S03 | Entrada | Entrar, verificação em seis estados, recuperação, primeiro acesso, segundo passo, troca de senha, bloqueio, `/aprovar`, 404, erro de tela | Os seis estados com Playwright; nenhum texto cita infraestrutura | S01 |
| S04 | Início | Saudação pela hora, data, "Seu dia" com cortina, pendentes, janela de horário, linha de agora | Relógio falso: a linha anda, o item passa para a cortina, a lista se refaz sem roubar o foco | S02 |
| S05 | Conversa | Lista com busca e grupos, C1, conversa antiga com aviso, um componente de gravação, sem clipe | Renomear e apagar pelo teclado; voz igual em todos os microfones | S02 |
| S05b | Conversa do dia | P7 | 23:59:59 fica, 0:00:00 troca, uma vez só com mensagens simultâneas, dois fusos, horário de verão, Telegram | S05 |
| S06 | Memória | P8 e P9 | Lista é o caminho acessível; mapa com teto de 200 nós; cada nó é botão com nome | S02 |
| S07 | Tarefas e Notas | P10 | Nota salva sozinha e avisa quando não salvou; ditado entra no fim do texto; "Pastas" em todo texto, inclusive do servidor e do bot | S02 |
| S08 | Agenda | P11 e P12 | Relógio falso às 23:59 e 0:00; o que fica escondido sempre tem aviso com "Mostrar" | S02 |
| S09 | Servidor · sincronização | P13 | Orçamento medido; recarga só com mudança | — |
| S10 | Contatos | P14 e C5 | Contato sem nome, sem telefone e só com e-mail | S02, S09 |
| S11 | Servidor · métricas | P15 | Períodos de 30 dias, 6 e 12 meses | — |
| S12 | Avaliações | P16 e C7 | Coluna única entre 821 e 1.100 px; sem faixa vazia em janela baixa | S02, S11 |
| S12b | Agente e segurança | P17 | As sete travas com teste cada; parada automática | S12 |
| S13 | Servidor · consumo | P18 | `days=365` recusado; o ano lê o resumo por mês | — |
| S14 | Rotinas | P19 | Aprovar, recusar, pausar e rodar como hoje | S02 |
| S15 | CRM | P20, C3, C4 e C6 | Parte "Automações" e "Envios" não aparecem antes do servidor delas | S02 |
| S16 | Configurações | P21 e C2 | Todo cartão de hoje tem lugar; `/acessos` e os nomes de seção antigos abrem | S02, S13 |
| S17 | Servidor · credenciais | Tipos `http` e `chatwoot`, intervalo, troca de chave | Credencial em uso não some; chave nunca volta ao navegador | S15 |
| S18 | Servidor · automações do CRM | Manifesto, ensaio, comparação | Tudo desligado ao instalar | S17, decisão do Pablo sobre a ordem dos fluxos |
| S19 | Envios | P22 | Fila com atualização condicional; nada envia duas vezes | S17 |
| S20 | Pedido de avaliação e link | P23 | Homônimo nunca liga sozinho; link só do Google com https | S18, S12, respostas do Pablo em `link-de-avaliacao.md` |
| S21 | Catálogo de modelos | P24 | Modelo novo só entra com um toque | S16 |
| S22 | Sugestões do Início | P5 | A IA só ordena a lista fechada | S04 |
| S23 em diante | Uma automação por fluxo do n8n | Ordem de `modulos-crm.md` | Aprovação do Pablo para cada uma que escreve a pacientes | S18 |
| Penúltima | Conferência das capturas | Nenhuma captura do visual antigo no README nem em `docs/capturas/` | — | todas as de tela |
| Última | Pentest autônomo | Relatório e correções | — | tudo, e autorização do Pablo |

Podem andar ao mesmo tempo depois da S02: S03 a S08, S10, S14 a S16. Os servidores S09, S11 e S13 não dependem de tela. O modo contínuo segue uma por vez, na ordem da tabela, a não ser que o Pablo peça paralelo.

### Bloco para a conversa de cada PR

> Implemente a PR **S<NN>** de `docs/planos/implementacao-frontend-sinal.md` (linha da seção 11 e as linhas citadas das seções 4.1 e 4.2). Leia antes: esse plano, `.claude/memoria/progresso.md`, `.claude/memoria/decisoes.md`, as regras de `.claude/rules/` da área e a tela correspondente em `docs/planos/modelos-frontend/prototipo-interativo.html` (abra no navegador; não leia o arquivo inteiro). Fluxo: `planejar` só se a linha pedir decisão nova, testes primeiro, `verificar`, `revisao-qa`, `auditoria-seguranca`, `preparar-pr`, `proxima-etapa`. Marque a linha da PR na tabela "Andamento" e peça a conversa da seguinte.

### Andamento

| PR | Situação |
| --- | --- |
| S01 | mesclada (#261) |
| S02 | mesclada (#265) |
| S03 | mesclada (#267) |
| S04 | mesclada (#270) |
| S05 | mesclada (#273) |
| S06 | mesclada (#275) |
| S07 | mesclada (#277) |
| S08 | mesclada (#282) |
| S09 | mesclada (#286) |
| S10 | mesclada (#291) |
| S11 | mesclada (#299) |
| S12 | mesclada (#310) |
| S13 | mesclada (#313) |
| S14 | em revisão |

(As linhas seguintes entram quando cada PR abre.)

Diferenças da S03 para o que as tabelas previam, registradas aqui para as PRs seguintes não as desfazerem:

- A página não encontrada (404) continua dentro da casca, com o menu: quem chega a ela já entrou, e tirar o menu deixaria a pessoa sem caminho de volta. As outras rotas da linha C9 usam a moldura da tela de entrar.
- O botão principal fica ativo enquanto a verificação de segurança roda. Uma tentativa nessa hora não sai do navegador e a linha diz por quê; o botão só desliga na pausa por excesso de tentativas.
- Quando o token vence com a tela aberta, a linha volta para "conferindo" (o serviço refaz sozinho), sem passar por "não passou".
- Os textos da linha não são os da tabela do protótipo palavra por palavra: passaram pelo lint de microcopy e pelo glossário ("Recarregar a verificação", "Verificação de segurança concluída").
- A aba do navegador da tela de erro diz "Esta tela parou", o mesmo do título. "Algo deu errado" é barrado pelo lint de microcopy.
- Pausa de uma hora ou mais mostra horas ("23:59:59"). Um leitor de tela ouve a pausa uma vez, com o tempo do início; a contagem na tela anda em silêncio.

Diferenças da S04 para o que as tabelas previam:

- A frase sob o cumprimento continua sendo a da Zuri, que muda a cada dia (decisão de 31/10). O resumo do dia do protótipo ("Quatro tarefas hoje, uma delas atrasada") depende do servidor da S22 e entra com ela.
- As três ideias sob o campo continuam fixas até a S22. O microfone do campo entra na S07, quando o `useVoice` vai para uma pasta comum.
- "Precisa de você" não entrou: a lista de planos esperando revisão não tem rota. A rotina que espera aprovação aparece em "Seu dia", como a primeira das pendentes, com "Revisar".
- O nome da pasta sob a tarefa não aparece (custaria mais uma leitura ao abrir o Início). O evento mostra o lugar.
- Das tarefas atrasadas de outros dias aparecem as três mais antigas, com "Mais N em Tarefas": uma fila longa não empurra o dia de hoje para baixo. As pendentes de hoje aparecem todas.
- O cumprimento e o resto do Início passaram a vir num pedaço só. Com dois, tirar os ícones do cumprimento fazia o empacotador separar a fábrica de ícones do pacote inicial (mais 0,3 kB).
- A rotina do dia aparece até rodar. Depois disso o servidor já aponta a próxima execução e ela sai da lista, sem passar pela cortina (o histórico fica em Rotinas).
- O evento aparece enquanto um pedaço dele cai entre 08:00 e 18:00, e o que está pendente aparece a qualquer hora (achados da revisão de QA): a regra do protótipo, só pela hora de início, escondia a reunião em andamento que começou às 07:30.
- O alvo de toque das marcas, das ideias e dos botões da lista é de 44 px (critério 5), maior que o do protótipo.

Diferenças da S05 para o que as tabelas previam:

- O selo "Em uso" e o "nova conversa à 0:00" do título dependem da conversa do dia (P7) e entram com a S05b. Até lá o título mostra só "Desde hoje, 08:12", e o aviso de conversa anterior aponta para a conversa usada hoje mais recente.
- O grupo da lista continua "Últimos 7 dias" (o protótipo diz "Esta semana"): a conta é de sete dias corridos, e na segunda-feira "esta semana" seria falso.
- O menu "Mais opções" da linha abre como o das outras listas (`ActionsMenu`, junto do botão), e não como janela no meio da tela.
- No celular a lista entra no lugar da conversa, como no protótipo, mas sem endereço próprio: Esc e a seta voltam para a conversa que estava aberta.
- A tela não usa mais a rolagem do conteúdo (`main`): a lista e as mensagens rolam cada uma na sua área. Por isso a barra de cima do celular não some ao descer dentro da Conversa.
- "Um componente de gravação" é `pages/chat/VoiceInput.tsx` (botão e linha de estado). Hoje só a Conversa tem microfone; a S07 leva o componente e o `useVoice` para uma pasta comum e liga a nota e o Início nele.
- O cartão do plano e os cartões de aprovação ficaram como estavam; só os balões mudaram (o do dono cinza, a resposta da Zuri sem moldura, com a marca e a hora).
- O alvo de toque dos botões é de 44 px (critério 5), maior que o do protótipo.
- O menu ao lado do título se chama só "Mais opções"; o da linha leva o nome da conversa. Dois botões com o mesmo nome confundiam o leitor de tela.
- Para a S05b: a tela lê "hoje" quando desenha, então fica parada se atravessar a 0:00 aberta e sem uso; a troca da conversa do dia precisa redesenhar a lista e o título. E renomear uma conversa ainda conta como uso no servidor (issue aberta nesta PR).

Diferenças da S06 para o que as tabelas previam:

- As ligações saem de regras de texto, porque o banco não guarda de onde a memória veio: a pasta liga quando o nome inteiro dela está na memória; conversa, tarefa e nota ligam quando o título tem duas palavras com sentido em comum; "Memórias próximas" são as que dividem duas palavras, mais as versões do mesmo fato e as que esperam revisão. O painel diz isso numa linha ("A Zuri liga pelo nome da pasta e pelas palavras em comum, sem IA"). Detalhes em `docs/memoria.md`, "Ligações e mapa".
- "Anotada pela Zuri numa conversa" continua sem apontar para a conversa: a memória não guarda esse vínculo e a S06 não cria tabela nem coluna. Se o Pablo quiser a ligação exata, é uma coluna nova em `zur_memories` (migration), em PR própria.
- Contatos ("mesma pessoa") não entram no mapa nesta PR. Procurar nomes entre até 5.000 contatos a cada memória não cabe no orçamento de leituras; fica para a S10, que refaz Contatos.
- O teto de 200 nós é dividido: 160 memórias e 40 pastas, conversas, tarefas e notas. Com mais de 160 memórias o mapa mostra as mais recentes e avisa; com uma memória escolhida, mostra só ela e o que encosta nela.
- Os tipos não mostram contagem nos botões do filtro (o protótipo mostra): contar por tipo pediria contadores novos no banco. A contagem aparece no título de cada grupo da lista. Os filtros quebram em linhas no celular, no lugar de rolar de lado (regra "nada escondido").
- As ações da memória (Editar e "Mais opções") saíram da linha da lista e ficam só no painel, como no protótipo. O botão principal continua "Editar"; "Atualizar este fato" segue no menu, como hoje.
- No celular o painel entra no lugar da lista, com "Voltar", como a lista da Conversa na S05. O foco vai para o título do painel e volta para a linha.
- "Para revisar" é uma faixa fechada com o botão "Revisar". A frase da faixa é a contagem ("1 memória nova pode mudar uma antiga…"), e não o motivo do primeiro conflito: a fila só é buscada quando o dono abre a faixa.
- No computador o painel não tem botão para desfazer a escolha (o "Voltar" é do celular): escolher outra memória troca o painel. No mapa, o tipo da memória aparece pela cor do ponto e por escrito no painel.
- O mapa vem junto com a tela da Memória, que já é carregada sob demanda, e não num pedaço próprio: como pedaço separado ele fazia o empacotador tirar do primeiro carregamento uma parte comum (ícones, textos ou o `jsx-runtime`) e o JS inicial passava do teto.
- No mapa, o toque acha o ponto mais próximo num raio de 22 px (alvo de 44 px), calculado pelas posições. Assim um ponto desenhado por cima não rouba o toque do vizinho.
- A chave "Revisão de conflitos" continua no fim da tela até a S16 (linha C2).

Diferenças da S08 para o que as tabelas previam:

- As opções da Agenda ficam numa chave só de `zur_settings` (`agenda`), salva inteira: o horário tem começo e fim, e os dois precisam ser conferidos juntos. A tela guarda com "Salvar alterações", como no protótipo.
- "Mostrar sábado e domingo" virou **Mostrar os dias de folga**: com os dias de trabalho escolhidos pelo dono, a folga pode ser uma quarta. Desligado, a semana mostra só os dias de trabalho.
- "Lembrete dos eventos novos" não entrou: não está na linha P12 e muda o que a Zuri grava no Google ao criar um evento (servidor e ferramentas da conversa). Fica para uma PR própria, se o Pablo quiser.
- "Agendas da conta" não foi repetido em Configurações › Agenda: a escolha continua em Integrações › Google, e a S16 decide onde cada cartão mora.
- O que fica escondido aparece contado embaixo da Agenda, uma linha por motivo (dia inteiro, fora do horário, dia de folga), cada uma com "Mostrar" e, depois, "Esconder". O protótipo lista os nomes dos eventos fora do horário; a contagem com o botão cumpre o critério e deixa cada evento clicável quando aparece. O mês mostra tudo.
- A semana em grade existe a partir de 1.024 px. Abaixo disso, "Semana" é a faixa de sete dias com a lista do dia, andando de semana em semana, como no protótipo do celular.
- O dia e a semana leem a semana inteira de uma vez: trocar de dia na faixa não faz pedido novo.
- O evento que atravessa a borda do horário aparece na grade, cortado nela (o das 07:30 às 09:00 começa na linha das 08:00). Só vai para "Antes" ou "Depois" o que fica inteiro fora.
- Cada hora da grade tem 56 px, e o evento curto tem altura mínima de 44,8 px (48 minutos na escala), o toque mínimo que a interface promete. Dois curtos seguidos ficam lado a lado em vez de um sobre o outro.
- A tela e o "Seu dia" não importam os valores padrão do pacote comum: um pedaço novo dividido entre telas sob demanda passava o JS inicial do teto. As telas esperam as configurações que a sessão já leu; `STANDARD_HOURS` (o "Voltar para 08:00 até 18:00") e `DAY_WINDOW` têm teste que os mantém iguais ao padrão do servidor.
- O prazo relativo das tarefas ("Ontem, 18:00") saiu em `lib/due.ts`, com as palavras do próprio navegador (`Intl.RelativeTimeFormat`), sem texto novo no catálogo.
- Revisão de QA (S08), corrigido na própria PR: o dia de folga mostrado com "Mostrar" passa pelas mesmas preferências dos outros dias, então o que ele traz de dia inteiro ou fora do horário entra na contagem (QA-S08-01); fechar um evento devolve o foco ao bloco de onde ele abriu (o diálogo era desmontado ao fechar); o Início e a Agenda dão a mesma resposta para o evento que começa na hora em que o horário termina (fica "Depois"); a barra do celular cabe numa linha a partir de 390 px.
- Auditoria (S08): nenhum achado alto ou médio. SEC-S08-01 (baixo), corrigido: as preferências da agenda entram no backup e voltam na importação, com a mesma validação.
- Ficou para depois (baixo): em Tarefas, "Hoje" e "Ontem" do prazo só mudam à meia-noite quando a lista é desenhada de novo, como os grupos da S07; a virada da semana (domingo para segunda) com a tela aberta tem teste só da virada do dia.
- A preferência de visão guardada no navegador (`zuri.agenda.view`) saiu: quem manda é "Ao abrir, mostrar", igual em todos os aparelhos.

Diferenças da S09 (servidor da sincronização), para a S10 e a S12 não as desfazerem:

- **Migration 32**, ao contrário do "nenhuma migration" de `sincronizacao-contatos-avaliacoes.md`. Os gatilhos das migrations 23 e 26 sobem o número da área quando `status`, `problem` ou `last_ok_at` aparecem num `UPDATE`, qualquer que seja o valor, e gatilho não se troca sem `DROP`. A leitura sem novidade grava a hora, o resultado e a próxima em colunas novas (`checked_at`, `last_result` e, nos contatos, `dirty`, `labels_read_at`, `synced_now_at`, `fields_version`), fora dos gatilhos. `status`, `problem` e `last_ok_at` só são escritos quando algo mudou ou quando precisam mudar.
- A tela não recebe aviso quando a leitura não trouxe nada (é esse o ponto). A contagem regressiva da S10 e da S12 sai do `nextSyncAt` do estado; ao chegar a zero, a tela pede o estado de novo uma vez (`GET /api/google/contacts` ou `GET /api/reviews/status`, leitura de uma linha) para saber a próxima hora. `lastResult` diz se é "Nada mudou às" (`unchanged`), "Conferido às" (`changed`) ou falha (`failed`); `lastSyncAt` e `lastCheckAt` passam a ser a hora da última leitura que deu certo, com ou sem novidade.
- O estado das avaliações usa o mesmo nome `nextSyncAt`, para um componente só de contagem.
- "Sincronizar agora" dos contatos: 429 `RATE_LIMITED` com `retryAfter` em segundos (no corpo e no cabeçalho `Retry-After`). O texto do erro diz "daqui a um minuto", como o das avaliações; a tela pode mostrar os segundos do `retryAfter`. Ligar os contatos ou salvar uma escolha de etiquetas diferente da anterior devolve o minuto ao botão, porque a tela de hoje sincroniza logo depois de salvar. Salvar a mesma escolha de novo não devolve. O "Conferir agora" das avaliações também passa a devolver os segundos que faltam, em vez de sempre 60.
- Rota nova `POST /api/google/contacts/labels/refresh`, para a S10 chamar ao abrir a escolha de etiquetas. A lista guardada serve por um minuto.
- A ficha recebe `given`, `middle`, `family`, `addresses`, `urls`, `relations`, `chats` e `more` (quantos itens o Google tem além do teto de cada lista, para o "e mais N no Google"). Listas vazias vêm como `[]`: é delas que a S10 monta o "Vazio no Google". O teto de telefones, e-mails e datas subiu de 5 para 10, igual ao dos campos novos.
- Site só é guardado se for `http` ou `https`, com domínio e sem usuário e senha; "exemplo.com.br" ganha `https://`. A tela pode criar o link sem conferir de novo, mas com `rel="noopener noreferrer"`.
- `refreshing` no estado dos contatos diz que uma leitura inteira está em curso (primeira leitura, etiqueta acrescentada ou campos novos): é o gancho do aviso "Atualizando todos os contatos".
- O aviso de "Google fora do ar" sai na quinta falha seguida dos contatos e na quarta das avaliações (antes, na terceira): com a espera partindo de 5 e de 10 minutos, três falhas seriam menos de meia hora. Continua pouco mais de uma hora, como era.
- Os contatos e as avaliações não leem o Google no mesmo despertar: quando vencem juntos, a conferência das avaliações espera 2 min 30 s.
- Endereço é cortado em 300 caracteres (o plano dizia 200 para os demais campos; um endereço completo passa disso). Site com mais de 200 caracteres fica de fora inteiro, porque um link cortado levaria a outro lugar, e não entra na conta do "e mais N no Google".
- `lastResult` é `changed` também quando só as etiquetas mudaram (nova, renomeada, apagada ou com outra contagem), porque a lista da tela recarrega nesses casos.
- Sem nenhuma etiqueta escolhida, a Zuri só fala com o Google para ler as etiquetas, uma vez por hora.

Diferenças da S10 (Contatos), para as PRs seguintes não as desfazerem:

- Ficam de fora os blocos do protótipo que pedem dado que o servidor ainda não tem: "Próximos com…", "Onde aparece", "Avaliação no Google", o favorito, a descrição debaixo do nome e o "Mudou lá em". A linha da lista mostra telefone e e-mail.
- No computador, nenhum contato abre sozinho: a coluna da direita diz "Escolha um contato". Cada coluna rola por conta própria, como na Conversa. No celular, a ficha toma o lugar da lista e "Contatos" volta.
- Contato sem nome no Google aparece pelo telefone, ou pelo e-mail, e fica no grupo "#", no fim. O servidor nunca manda nome vazio (manda o primeiro e-mail ou telefone no lugar); a tela reconhece isso em `pages/contacts/person.ts`. "Perguntar à Zuri" some para quem não tem nome.
- As quatro portas da ficha: "Perguntar à Zuri" (abre a Conversa com "O que você sabe sobre {nome}?" escrito, sem enviar), "Ligar", "WhatsApp" e "E-mail". WhatsApp só para celular do Brasil (DDD e nove dígitos começando em 9); telefone fixo mostra "Sem celular". O ícone é o balão de conversa do conjunto de ícones, sem marca.
- Site e "Abrir no Google Contatos" só viram link se forem `http` ou `https`, com domínio e sem usuário e senha, conferidos de novo na tela (`siteHref`), com `rel="noopener noreferrer"`. O e2e `contatos.spec.ts` cobre nome, observação, site, e-mail e endereço do Google hostis.
- A escolha de etiquetas também abre de dentro de Contatos ("Falta alguma? Escolher etiquetas", no filtro). Ao abrir, pede as etiquetas ao Google (`labels/refresh`); ao salvar, sincroniza. A de Configurações > Integrações continua.
- A contagem regressiva sai do `nextSyncAt`. Ao chegar a zero, a tela pede o estado de novo depois de 3 s, 15 s e 30 s, no máximo três vezes, e para. Ela fica fora de região viva, para o leitor de tela não ler a cada segundo.
- A aba Clientes saiu. `/contatos/clientes` leva a Contatos e os avisos novos do CRM apontam para `/crm`. Os dois controles que só existiam na aba ("Avisos do CRM" e "Eventos do n8n") moram em `/crm`, abaixo dos fluxos, até a S15: sem eles o dono não teria como calar os avisos nem revogar o segredo do n8n. A lista de clientes, o funil e a edição ficam sem tela; as rotas `/api/crm/*`, as cinco ferramentas da conversa e os dados continuam.
- Contatos na Memória (pendência da S06): só no painel de uma memória e no mapa "em volta" dela, nunca no mapa inteiro, que mudaria de desenho a cada clique. A regra é de texto, sem IA: o nome inteiro do contato aparece na memória, ou só o primeiro nome quando um único contato começa por ele. A busca é pelo começo do nome guardado, então "Dra. Helena" não é achada por "Helena". Até 8 palavras da memória são procuradas, 4 linhas cada, e até 3 contatos aparecem.
- "O que a Zuri sabe", na ficha, é a busca de memórias pelo nome do contato (as três primeiras), com link para a Memória já buscando (`/memoria#busca=`).
- Achados da revisão de QA e da auditoria, corrigidos nesta PR: "Perguntar à Zuri" só escreve a pergunta no campo da Conversa, pelo estado `draft` do endereço, e nunca envia sozinho, porque o nome vem do Google (SEC-S10-01); o mapa da Memória só cita contato enquanto a permissão dos contatos vale (SEC-S10-02); número escrito com código de outro país nunca abre o WhatsApp; ramal não entra no número de "Ligar"; e-mail no lugar do nome não liga memória a contato; contato sem nome, telefone nem e-mail aparece como "Sem nome no Google"; a nova consulta do estado segue até a terceira mesmo quando uma falha. Os cartões do CRM ganharam e2e próprio (`crm-cartoes.spec.ts`).
- Fica como está, de propósito: aviso do CRM gravado antes desta PR abre Contatos (o endereço antigo da aba); os novos abrem o CRM. Falha ao carregar mais contatos ou ao copiar não mostra aviso.
- A issue #287 (conversa longa abria antes do fim) é corrigida nesta PR: de longe, a Conversa pula para o fim em vez de deslizar, e acompanha o conteúdo que cresce depois de desenhado enquanto o dono está no fim.

Diferenças da S11 (servidor das métricas), para a S12 não as desfazer:

- A rota é `GET /api/reviews/metrics?period=30d|6m|12m` e devolve `{ period, from, unit, ratings, buckets, replied, medianReplyMinutes, requests, partial }`. O `byBucket` do plano virou `buckets`, e a resposta ganhou `from`, `unit` e `partial`. O contrato está em `ReviewMetrics` (`packages/shared/src/reviews.ts`) e explicado em `docs/avaliacoes-google.md`, "Números da visão geral".
- **Migration 35**, só com o índice `zur_reviews_metrics`: não havia índice pela data em que a avaliação foi escrita. Nenhuma tabela nem coluna nova.
- A rota manda contagens; o índice de recomendação, a nota média e as porcentagens são conta da tela. `recommendationIndex` (pacote comum, sem Zod) faz a do índice e devolve `null` sem avaliações: a tela mostra "sem avaliações" nesse caso, e não zero.
- "30 dias" são hoje e os 29 dias antes, e os grupos são semanas de segunda a domingo. Como 30 não é múltiplo de 7, a primeira e a última semana vêm cortadas pelo período (o `from` diz onde começa), e os grupos somam o mesmo total dos quatro números. São 5 grupos, ou 6 quando hoje é segunda-feira: a tela não pode contar com um número fixo de colunas. A semana começa sempre na segunda, sem olhar o "primeiro dia" da Agenda.
- "6 meses" e "12 meses" são o mês corrente, ainda incompleto, e os 5 ou 11 anteriores inteiros.
- A variação do índice ("+N desde o começo do período") não vem pronta: a tela faz a conta entre o último e o primeiro grupo que tenham avaliação, como no protótipo.
- `requests` vem `null` até a S20 (pedido de avaliação e link pessoal). A S12 esconde o funil enquanto for `null`, em vez de mostrar zeros que pareceriam "ninguém abriu".
- "Tempo até responder" passa a valer também para a resposta dada direto no Google: a Zuri guarda a hora que o Google informa na primeira vez que vê a resposta (`replied_at`, coluna que já existia e só era preenchida nas respostas da própria Zuri). Respostas copiadas antes desta PR contam em `replied`, mas não no tempo; por isso `medianReplyMinutes` pode ser `null` com `replied` maior que zero, e a tela precisa de um texto para esse caso.
- "As que precisam de você" não vem nesta rota: é o `needs` de `GET /api/reviews/status`, que a tela já lê.
- Acima de 5.000 avaliações no período a resposta conta só as mais novas e marca `partial: true`.

Diferenças da S12 (Avaliações), para as PRs seguintes não as desfazerem:

- **Só interface.** A S12 monta a área sobre o servidor que já existe. Ficam para uma PR de servidor, antes da S12b, as partes de `avaliacoes-conexao-e-respostas.md` que pedem rota, migration ou mudança no modelo do agente: "Testar conexão", "Importar avaliações", "Análise do Google", "Sobre o consultório" (fatos, canal oficial, atendimento de saúde), "Variar o começo das respostas", o teste do rascunho antes de salvar e as instruções do agente dentro de Avaliações (por ora a tela leva a Configurações › IA). Nada disso aparece na tela até o servidor chegar, como as partes do CRM.
- **Endereços:** `/avaliacoes` (Visão geral), `/avaliacoes/lista` e `/avaliacoes/lista/<id>` (a avaliação aberta), `/avaliacoes/ajustes` (Conexão) e `/avaliacoes/ajustes/responder`. Qualquer outro vai para o endereço real mais próximo; a conferência fica em `pages/reviews/numbers.ts` (`reviewAddress`), dentro da tela, e o `App.tsx` ficou menor.
- **Abas:** Visão geral, Avaliações e Ajustes. "Pedidos" e "Pedidos e link" entram com a S20; "Agente e segurança", com a S12b.
- **Visão geral:** o funil dos pedidos não aparece enquanto `requests` vier `null`. Sem avaliações, o índice mostra um traço e "Sem avaliações". A variação compara o último grupo com avaliação ao primeiro. Com `medianReplyMinutes` nulo e respostas no período, a tela diz que não tem a hora das respostas mais antigas. As barras vão de −100 (rente à base) a 100 (topo), para o índice negativo também aparecer; o protótipo só desenhava valores positivos. Semana ou mês sem avaliação fica sem barra. "Ver em tabela" traz os mesmos números.
- **Lista:** abre em "Precisa de você" quando há algo esperando, e em "Todas" quando não há (o protótipo abre sempre em "Todas"). A partir de 1.101 px a primeira avaliação aparece aberta; até 1.100 px a lista ocupa a coluna e a avaliação aberta toma o lugar dela, com "Avaliações" para voltar. Quando a avaliação aberta sai do filtro (foi respondida, por exemplo), o endereço volta para a lista. O servidor só manda o primeiro nome, então a marca redonda tem uma letra e a tela não mostra "Ligada ao contato" nem "Editou hoje" (dados que o servidor não tem).
- **C7:** "Respondidas" é um dos filtros, e "Apagar resposta" é um botão na resposta publicada pela Zuri, não um item de menu ⋯: é a única ação dali, e o menu com um item só custaria um toque a mais.
- **Ajustes › Conexão:** os quatro passos saem do estado que a tela já lê (`connected`, `granted`, `problem`, `locations`); o e-mail da conta e a data da permissão não vêm nele e não aparecem. A chave "Publicar no Google as respostas que você aprova" troca o nível entre "só lê e avisa" e "rascunhos para aprovar". O texto do protótipo ("a Zuri só prepara os rascunhos e você copia") não é o que o servidor faz com o nível desligado, e foi trocado pelo que acontece de verdade.
- **Primeira vez:** escolher o perfil pede também a assinatura, porque o servidor guarda perfil, jeito de responder e nível numa rota só e toda resposta termina com a assinatura. O resto começa com os três modelos sugeridos e "rascunhos para aprovar".
- **Integrações:** a seção "Avaliações do Google" do cartão do Google ficou só com a hora da última leitura, o intervalo entre as leituras (decisão de 11/11) e o caminho para Avaliações.
- **"Ajustes"** é o nome da aba, como no protótipo. O glossário reserva "Configurações" para a página do menu; a exceção está em `i18n-ignore.json` só para o nome da aba, e os outros textos dizem "em Avaliações" ou "em Como responder".
- **Contador no menu lateral** (o "3" ao lado de Avaliações no protótipo): não entrou. Pediria uma leitura a mais em toda tela e código no pacote inicial, que está no teto. O número aparece na aba "Avaliações" da área.
- **JS inicial:** 140.867 bytes, 8 a menos que a develop. Ícone usado por outra tela sob demanda cria pedaço comum e pesa no pacote inicial; por isso a área usa ícones só dela (`SlidersVertical`, `PlugZap`, `CirclePause`, `Timer`, `ChevronsLeft`, `SendHorizontal`, `Hourglass`, `CircleDashed`) e não usa o `ActionsMenu`.

Diferenças da S14 (Rotinas) para o protótipo, para as PRs seguintes não as desfazerem:

- **"Rodar agora" fica ligado numa rotina pausada.** O protótipo desliga o botão; o servidor sempre deixou rodar à mão uma rotina pausada, e a linha da S14 pede "rodar como hoje". Serve para testar antes de retomar.
- **Editar tem quatro passos**, de "Quando" a "Revisar": o tipo de uma rotina não muda depois de criada.
- **O modelo só traz o horário dele enquanto você não mexeu em "Quando".** No protótipo o modelo aparece no passo 3, depois do horário; trocar o horário escolhido sem avisar seria surpresa.
- **"Só me avise quando houver algo" aparece só na Rotina da Zuri.** O servidor recusa essa opção nos outros tipos (`error.automationQuietOnlyAi`), e a S14 não muda regra de negócio.
- **Ferramentas externas aparecem ao editar**, não ao criar: a liberação é por rotina e pede uma rotina que já existe.
- **"Escolher os canais" não entrou no passo "Avisos".** O link sairia da tela e perderia o que foi preenchido; a opção Normal já diz onde ficam os canais.
- **"Fluxo" no passo 1 abre CRM › Fluxos com "Novo fluxo"**, sem as sugestões do protótipo (elas dependem do servidor das automações do CRM, S18).
- **"Duplicar" faz duas chamadas** (criar e pausar), porque o servidor não cria rotina pausada. Uma rota própria fica para quando houver PR de servidor das rotinas.
- **O fuso aparece como o sistema o nomeia** ("Sao Paulo (GMT-3)"), só para leitura. Ele muda em Configurações › Conta.
- **O histórico mantém o texto que cada execução entregou** embaixo da linha; o protótipo mostra só hora, rotina e situação.
- **Textos:** "automação" virou "rotina" na tela, na paleta, nos erros do servidor, nas ferramentas da conversa, no backup e no Telegram. "Automação" fica só para as do CRM.

Diferenças da S13 (servidor do consumo), para a S16 não as desfazer:

- **Só servidor.** Duas rotas de leitura novas, `GET /api/usage/hours` e `GET /api/usage/months`, e a migration 37 com `zur_usage_hourly` e `zur_usage_monthly`. O painel de consumo de hoje continua como está; "Dia" e "Ano" no seletor entram com a S16. Semana e Mês já saem de `GET /api/usage/history?days=7|30`.
- **As horas são UTC**, como o dia dos contadores (a cota da Cloudflare recomeça às 00:00 UTC). A resposta traz `day` e `hour` (0 a 23); a S16 mostra cada coluna no fuso do dono (para quem está em UTC−3, o "dia" vai das 21:00 de ontem às 20:59 de hoje) e diz na tela que a contagem recomeça nessa hora, como o cartão do uso de hoje já diz.
- **Só vêm as horas e os meses com uso.** A tela preenche as colunas vazias (24 horas; 12 meses de `from` a `to`).
- **A hora mostra o que foi gasto de fato**, depois que a chamada termina. O cartão "uso de hoje" inclui também o que está reservado para chamadas em andamento, então, com uma resposta sendo escrita, a soma das horas pode ficar um pouco abaixo do total do dia por alguns segundos.
- **O mês não tem a divisão por modelo** nem o gasto pago por modelo (o plano pede duas tabelas pequenas). No "Ano", a S16 esconde a tabela de modelos ou mostra a dos últimos 90 dias dizendo o período. O mês traz `days`, os dias com uso, para a média.
- **Ontem entra no mês um dia depois** (o plano dizia "a partir do dia anterior"): uma chamada que começou antes da meia-noite ainda pode ser acertada no dia de ontem, e a soma feita na hora perderia esse acerto. A leitura do ano junta os meses já somados com os dias ainda abertos, então o número na tela não atrasa.
- **Quem já usava a Zuri** ganha os meses dos últimos 90 dias na primeira chamada depois da atualização. O mês mais antigo deles pode vir incompleto, porque os dias anteriores já tinham sido apagados.
- **Custo:** cada chamada de IA grava uma linha a mais (a da hora). Os tetos do teste de orçamento subiram só essa linha.

## 12. Riscos

- **Link antigo quebrado.** Mitigação: redirecionamentos permanentes e o teste que percorre os endereços do servidor.
- **Teto do JS.** Mitigação: a casca dividida em partes sob demanda (folha "Mais", painel da conta); medir antes de usar a folga de 141 kB.
- **e2e quebrando por nome acessível.** Mitigação: teste mudado no mesmo commit, nunca pulado.
- **Tela antiga dentro da casca nova** durante a transição. Mitigação: a S01 troca os tokens de todas de uma vez, então a diferença é só de arranjo.
- **Duas PRs de servidor com a mesma migration.** Mitigação: regra da seção 4.3, item 6.

## 13. Suposições

- O "Vamos iniciar a implementação" de 10/11, 16:07 aprova o Sinal refinado (pergunta 1 do plano antigo) e libera as PRs #204 e #249 para a `develop`.
- A tela de Clientes sai e o CRM interno continua no servidor (C5). Os avisos do CRM e os eventos do n8n vão para os lugares da seção 4.1.
- Tailwind atual com tokens em variáveis CSS; lucide como família de ícones.

## 14. Entrevista com o Pablo

### Perguntas abertas

1. Ordem da seção 11? Recomendação: como está, telas que já existem primeiro (S01 a S08) e as novidades depois. As S01 a S08 não dependem de nenhuma outra resposta.
2. As que já estavam abertas e só travam da S18 em diante: lista e ordem dos fluxos do n8n, aprovação de cada automação que escreve a pacientes, ensaio de 3 dias úteis, e as três de `link-de-avaliacao.md` e de `envios-monitoramento.md`.

Diferenças da S07 para o que as tabelas previam:

- "Duplicar" do menu da nota não entrou. A cópia de uma nota marcada como "nunca enviar para fora" precisa nascer já marcada, e hoje isso são duas chamadas (criar e marcar); entre uma e outra a cópia ficaria desprotegida. Entra quando o servidor criar a nota com a marca num passo só.
- A nota salva 2,5 s depois da última tecla e, sem pausa, a cada 30 s (o protótipo não fixa o tempo). O número vem da regra P4: cada salvamento grava 6 linhas.
- O servidor passou a recusar o salvamento de uma nota que mudou em outro lugar (`ifUpdatedAt`, resposta 409). Sem isso, o salvamento automático passava por cima da outra versão antes de a tela saber dela.
- Nota sem título é salva como "Nota sem título" (o servidor exige título). Nota vazia não é criada.
- A linha "Salva às 08:12" não é anunciada pelo leitor de tela a cada salvamento; só a falha é (`role="alert"`). Anunciar a cada 2,5 s atrapalharia quem dita ou digita.
- "Nunca enviar para fora" continua com a linha de explicação visível, e a dica da busca fica só para o leitor de tela.
- Em Tarefas, a visão Concluídas continua existindo e a prioridade aparece em todas as linhas (o protótipo mostra só a alta). O prazo continua como data ("10/11/2026 às 18:00"); "Ontem, 18:00" fica para quando a Agenda (S08) trouxer o texto relativo comum.
- O microfone é um componente só, em `components/voice/`, para a Conversa, o Início e a nota. Na nota ele fica no corpo; título e busca não têm (decisão de 10/11).
- O ícone de pasta sai de `pages/productivity/shared.tsx` e o estado "esperando sua escolha" usa o ícone de histórico: um ícone que só duas telas sob demanda dividem vira um pedaço novo e pesa no primeiro carregamento (regra P11).
- O alvo de toque dos botões é de 44 px (critério 5), maior que o do protótipo.
- Achados da revisão de QA e da auditoria, corrigidos nesta PR: "Manter a minha" grava a versão inteira da tela (SEC-S07-01); o editor fechado não navega nem salva um ditado que termina depois; a lixeira não recebe a nota quando o salvamento pendente falha. Ficou aberto (baixo): nota apagada em outro lugar com o editor aberto deixa só "Tentar de novo" e sair sem salvar.
