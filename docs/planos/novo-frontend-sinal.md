# Plano · Levar o Sinal refinado para o app

Situação: plano. Pedido do Pablo em 09/11/2026, 20:19; revisto com os pedidos das 21:51 e 22:08 (seção 11, cronograma). Base: o protótipo da rodada 5 (`docs/planos/modelos-frontend/prototipo-v5.html`), o desenho das funcionalidades ([sinal-refinado-funcionalidades.md](sinal-refinado-funcionalidades.md)) e a develop de 09/11.

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
| Contatos (pessoas, clientes do CRM, avaliações) | Pessoas, com todos os campos do Google, etiquetas no topo e contagem regressiva. Clientes sai da tela (o CRM continua guardando). Avaliações vira item próprio do menu | G e G2 |
| Automações (rotinas, sugestão da Zuri, fluxos, conexões, editor de fluxo, menu ⋯) | Sim, em quatro partes no menu lateral: Rotinas, Fluxos, Módulos e Conexões | H |
| Memória ("Nova memória" em diálogo, tipos, filtros, conflitos, "nunca enviar para fora" marcável no menu ⋯) | Sim, com o microfone dentro do diálogo | D |
| Configurações › Conta (preferências, senha, tema; sem o cartão "Sair deste aparelho") | Sim, tema só com ícones | H |
| Configurações › Segurança (duas etapas, passkeys, limites de sessão, atividade, acesso pela API) | Sim; limites de sessão em "Saída automática". Encerrar as sessões abertas continua só no Telegram (`/sessoes`, `/encerrar_sessoes`), como na develop | H |
| Configurações › Uso da IA (uso de hoje, consumo por período por dia, semana, mês e ano) e › Modelos e limites (modelo, catálogo, "Limites avançados" recolhidos, agentes, modelos pagos, busca por significado) | Sim, nas duas seções, com o painel "Ajustar" | H |
| Configurações › Avisos (canais, o que vai para cada canal, Telegram, resumo do dia, a Zuri de olho, prioridades aprendidas e últimos envios no fim) | Sim, na ordem da develop | H |
| Configurações › Integrações (Google, servidores MCP) | Sim | H |
| Configurações › Dados (backup, importar, backup automático, restaurar, lixeira com "Voltar" e "Ver tudo") | Sim; "Baixar backup" baixa um arquivo de exemplo | H |
| Configurações › Diagnóstico | Sim | H |
| Acessos (`/acessos`) | "Ver todos os acessos" em Segurança abre a lista com filtro | H |
| Paleta ⌘K | Sim | B |
| Lembrete de duas etapas, aviso de sessão perto do fim, senha de novo, confirmação | Estados das telas | A |
| Entrar, primeiro acesso, segundo passo, recuperação, troca de senha, bloqueio, `/aprovar`, 404 | Entrar e "Esqueci minha senha" no protótipo, com a verificação de robô; o resto segue o mesmo desenho | I |

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
| Configurações › Agenda (horário visível) | nova preferência; hoje a semana mostra o dia todo |

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

- **Textos:** "Seu dia em ordem, sem esforço." no lado da marca e "Continue de onde parou." embaixo de "Entrar". Só a marca e uma frase, como decidido às 13:37.
- **Campo de e-mail sem exemplo dentro.** O texto de exemplo some quando a pessoa digita, tem pouco contraste e confunde com campo já preenchido. Fica o rótulo "E-mail" sempre visível em cima, `type="email"`, `autocomplete="username"`, `inputmode="email"`, `autocapitalize="none"` e `spellcheck="false"`, para o gerenciador de senhas preencher. Erro embaixo do campo, ligado por `aria-describedby`: "Digite o seu e-mail." ou "Confira o e-mail: falta alguma parte.".
- **Verificação de robô.** Já existe na develop (`components/TurnstileWidget.tsx`, `auth/turnstile.ts`): é o Turnstile da Cloudflare, grátis, no modo "só quando precisa" (`appearance: interaction-only`). Na maioria das vezes passa sozinho, sem clique; só quando a Cloudflare desconfia da conexão aparece a caixa para marcar. O servidor confere cada token com a chave secreta, e o token vale uma vez. O cartão "Verificação concluída" do protótipo antigo sai: no lugar, uma linha discreta com três estados, "Conferindo a conexão…", "Conexão conferida" e, se o script não carregar, "A verificação de segurança não carregou." com "Recarregar a verificação". Entrar antes do fim mostra "Preparando a verificação de segurança…".
- **"Esqueci minha senha"** fica ao lado do rótulo da senha e abre a recuperação que já existe (`/recuperar-senha`, etapa 11): e-mail, verificação, "Enviar o link" e a mesma resposta para qualquer e-mail ("Se o e-mail for o da conta, o link chega em alguns minutos. Ele vale por 30 minutos e funciona uma vez só."). O link pede o código de duas etapas quando ele está ligado. A tela deixa de dizer quando o envio de e-mail não está configurado; isso fica para o achado de auditoria já registrado (resposta uniforme), que precisa da decisão do Pablo.

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
| 2 | B · Casca | Menu lateral com Avaliações e as partes de Automações, menu de baixo no celular, folha "Mais", perfil e avisos em painel, ⌘K | A; teto do JS aprovado | G |
| 3 | I · Entrada | Textos novos, campo de e-mail sem exemplo, linha da verificação, "Esqueci minha senha" ao lado da senha, recuperação no desenho novo | A | P |
| 4 | C · Início | Saudação pela hora, cortina do que passou, pendências | B | M |
| 5 | Servidor · sugestões | [sugestoes-do-inicio.md](sugestoes-do-inicio.md) e as sugestões no Início | C | M |
| 6 | D · Conversa e Memória | Sem clipe; um componente de gravação para todos os microfones | B | M |
| 7 | E · Tarefas e Notas | "Pastas", "Nova nota", salvamento automático | B | M |
| 8 | F · Agenda | Linha de agora, legenda, rodapé "Configurações", preferência do horário visível (servidor pequeno junto) | B | M |
| 9 | Servidor · sincronização | Contatos 5 min, Avaliações 10 min, etiquetas por hora, recarga só com mudança, campos novos ([plano](sincronizacao-contatos-avaliacoes.md), PR 1) | — | M |
| 10 | G · Contatos | Sem Clientes, etiquetas no topo, contagem, ficha com todos os campos e "Vazio no Google" | B, 9 | M |
| 11 | Servidor · métricas | Métricas das avaliações ([plano](sincronizacao-contatos-avaliacoes.md), PR 2) | — | P |
| 12 | G2 · Avaliações | Área própria: Visão geral, Avaliações, Pedidos | B, 11 | M |
| 13 | Servidor · consumo | Contadores por hora e resumo por mês | — | P |
| 14 | H · Automações e Configurações | Rotinas, Fluxos, Módulos (vazia até a 16), Conexões, Configurações, consumo por dia/semana/mês/ano | B, 13 | G |
| 15 | Servidor · conexões | Tipo de conexão (`http`, `chatwoot`), senha, troca de chave, remoção bloqueada em uso ([modulos.md](modulos.md)) | H | M |
| 16 | Servidor · módulos | Manifesto, ensaio, comparação, rotas ([modulos.md](modulos.md), PR 1) | 15 | G |
| 17 | Módulo · Pedido de avaliação | Fila, dias úteis, homônimos, Chatwoot ([envio-chatwoot-pela-zuri.md](envio-chatwoot-pela-zuri.md)) | 16, 12 | G |
| 18 | Catálogo de modelos | Conferido sozinho uma vez por dia | H | P |
| 19 em diante | Um módulo por fluxo do n8n | Na ordem do Pablo, cada um com a aprovação da exceção, se mandar mensagem a pacientes | 16 | M cada |

Em paralelo depois da B: I, C, D, E, F; os servidores 9, 11 e 13 não dependem de interface e podem começar já. A PR de README da outra thread troca as capturas quando as PRs B a H entrarem.

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
2. Teto do JS inicial para a casca nova: medir na PR B e pedir com o número. Recomendação: aceitar até 141 kB se a economia não bastar.
3. Configurações › Agenda (horário visível da semana) entra como preferência nova? Recomendação: sim, numa PR pequena de servidor junto da F.
4. Ordem do cronograma da seção 11? Recomendação: como está, com os servidores 9, 11 e 13 começando já, porque não dependem da interface.
