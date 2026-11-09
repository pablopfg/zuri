# Plano · Modelos de interface

Situação: rodada 4 entregue, esperando o Pablo aprovar
Origem: pedido do Pablo em 09/11/2026 ("use a skill taste para criar 5 novos modelos de frontend para eu aprovar") ; na rodada 2, "Aperfeiçoe o modelo 4 - menta… inclua também a tela de login… avalie a skill ui-skills, se for segura, crie 3 novos modelos"; e, na rodada 4, "Crie 5 novos frontend, faça um rebranding completo… crie uma nova identidade visual, ícones e logomarca. Verifique as skills abaixo e crie 3 novos modelos com cada skill" (ui-ux-pro-max e open-design)

Dependências: nenhuma para escolher. A implementação, se houver, vira PR própria.

## 1. Resumo

Na rodada 4 o Pablo pediu um rebranding completo: cinco identidades novas (logomarca, ícone do app, família de ícones, cores, letras e jeito de falar) e mais três modelos com cada uma das skills `ui-ux-pro-max` e `open-design`. São onze modelos, cada um com as nove telas e uma tela nova de identidade visual (seção 2). A tela de entrar de todos mostra só a marca e uma frase, sem pistas do sistema. As rodadas anteriores ficam abaixo como histórico.

Na rodada 3 o Pablo achou as interfaces anteriores feias e fora da função do sistema. Os três exemplos novos (Sinal, Painel e Caderno) foram refeitos do zero a partir das telas reais do app, conciliando a `taste-skill` e a `ui-skills` (seção 2). As rodadas 1 e 2 ficam abaixo como histórico.

Na rodada 2 o Pablo ficou com o Menta, que foi refinado e ganhou todas as telas do sistema e a de entrar, e chegaram três modelos novos feitos com a skill `ui-skills` (seção 2). A rodada 1, abaixo, trouxe cinco direções visuais para a Zuri, todas com a mesma organização aprovada em 03/11 (barra lateral com Nova conversa, Buscar, seções, Recentes e a conta no rodapé; gaveta no celular). O que muda entre elas é a cara: fonte, cores no claro e no escuro, espaçamento, cantos e o jeito de montar o Início e a Conversa.

Paletas e pares de fontes saíram do sorteio da skill `taste-skill` para "produto de IA, software, fintech e ferramenta" (avaliação de segurança em `docs/planos/skill-taste.md`). As cores foram ajustadas para os dois temas passarem no contraste.

Nada no app muda até o Pablo escolher. Vale lembrar que em 03/11 ele preferiu manter as cores atuais (Sinal); estes modelos são a nova rodada que ele pediu.

- Protótipo: `docs/planos/modelos-frontend/prototipo.html` (abra no navegador; a barra do topo troca modelo, tela e tema).
- Capturas: `docs/capturas/pr/modelos-frontend/`, nome `<modelo>-<inicio|conversa>-<computador|celular>-<claro|escuro>.png` (40 imagens).
- Acessibilidade: axe (WCAG 2.1 A/AA e boas práticas) sem nenhuma violação nas 40 combinações.

## 2. Rodada 4 · Rebranding e seis modelos das skills

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

## 3. Rodada 3 · Sinal, Painel e Caderno

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

## 4. Rodada 2 · Menta refinado e três modelos da `ui-skills`

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

## 5. Rodada 1 · Os cinco modelos

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

## 6. O que vale para todos

- Mesmos textos e dados de exemplo (a dona "Ana", nada real), em pt-BR, "a Zuri" no feminino, sem citar infraestrutura.
- Alvos de toque de 44 px, foco visível na cor do destaque, texto de leitura com 16 px ou mais, "Pular para o conteúdo", pontos que piscam param com "reduzir movimento".
- Claro e escuro em todos.
- Ícones no traço do lucide, que o app já usa.

## 7. Custo de implementar (rodada 1)

- **JS inicial:** nenhum dos modelos pede biblioteca nova. A troca é de CSS (tokens em `apps/web/src/styles.css`) e de montagem das telas Início e Conversa, que já são carregadas à parte.
- **Fontes:** hoje o app usa a fonte do sistema. Cada modelo traz arquivos `woff2` da sua família e da mono (o Lima tem uma família a mais, a Red Hat Display para títulos), uns 60 a 120 KB, servidos pelo próprio Worker e fora do JS inicial. Nada é buscado no Google na hora de abrir. Dá para ficar com a fonte do sistema e levar só cores e montagem.
- **Floresta** é o que mais mexe na estrutura (conversa fixa ao lado e lista de conversas própria). **Lima** e **Cobalto** são os que menos mexem.
- Sem custo na Cloudflare.

## 8. Recomendação (rodada 1)

**Lima.** É o que mais conversa com a marca atual (verde, escuro forte), muda pouco a estrutura e traz a faixa de estado do dia, que é útil. Se a ideia for algo mais leve para usar o dia todo no claro, a segunda opção é **Petróleo**.

## 9. Próximo passo

O Pablo aprova um dos modelos da rodada 4 (ou uma mistura, por exemplo "logomarca do Farol com a montagem do Norte"). Aí sai um plano de implementação pela skill `planejar`, com testes, axe, capturas antes e depois e o teto de JS conferido.
