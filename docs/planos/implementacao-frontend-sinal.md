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
| C8 | Estados "ainda não ligado" (Agenda sem Google, Contatos desligados, Avaliações desligadas, nenhuma agenda aberta) e os vazios de cada lista | Padrão único de vazio da S01 (ícone, título, uma frase, um botão) | cada PR de tela |
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
| S01 | `apps/web/src/styles.css`, `components/ui.tsx`, `components/ThemeSwitcher.tsx`, `components/Switch.tsx`, `apps/web/public/fonts/`, `_headers` (cache da fonte), `docs/interface.md` |
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
| S01 | Fundamentos | Tokens do Sinal refinado (claro com fundo `#f1f1f3`), Figtree, botão, campo, interruptor, segmentado, selo, cartão, diálogo, folha, vazio, esqueleto com a linha verde, tema só com ícones | Toda tela de hoje continua funcionando e passa no axe com as cores novas; a fonte carrega do próprio endereço; nenhum texto cortado | — |
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
| S01 | a fazer |

(As linhas seguintes entram quando cada PR abre.)

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
