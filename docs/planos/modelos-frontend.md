# Plano · Modelos de interface

Situação: rodada 2 entregue, esperando o Pablo aprovar
Origem: pedido do Pablo em 09/11/2026 ("use a skill taste para criar 5 novos modelos de frontend para eu aprovar") e, na rodada 2, "Aperfeiçoe o modelo 4 - menta… inclua também a tela de login… avalie a skill ui-skills, se for segura, crie 3 novos modelos"

Dependências: nenhuma para escolher. A implementação, se houver, vira PR própria.

## 1. Resumo

Na rodada 2 o Pablo ficou com o Menta, que foi refinado e ganhou todas as telas do sistema e a de entrar, e chegaram três modelos novos feitos com a skill `ui-skills` (seção 2). A rodada 1, abaixo, trouxe cinco direções visuais para a Zuri, todas com a mesma organização aprovada em 03/11 (barra lateral com Nova conversa, Buscar, seções, Recentes e a conta no rodapé; gaveta no celular). O que muda entre elas é a cara: fonte, cores no claro e no escuro, espaçamento, cantos e o jeito de montar o Início e a Conversa.

Paletas e pares de fontes saíram do sorteio da skill `taste-skill` para "produto de IA, software, fintech e ferramenta" (avaliação de segurança em `docs/planos/skill-taste.md`). As cores foram ajustadas para os dois temas passarem no contraste.

Nada no app muda até o Pablo escolher. Vale lembrar que em 03/11 ele preferiu manter as cores atuais (Sinal); estes modelos são a nova rodada que ele pediu.

- Protótipo: `docs/planos/modelos-frontend/prototipo.html` (abra no navegador; a barra do topo troca modelo, tela e tema).
- Capturas: `docs/capturas/pr/modelos-frontend/`, nome `<modelo>-<inicio|conversa>-<computador|celular>-<claro|escuro>.png` (40 imagens).
- Acessibilidade: axe (WCAG 2.1 A/AA e boas práticas) sem nenhuma violação nas 40 combinações.

## 2. Rodada 2 · Menta refinado e três modelos da `ui-skills`

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

## 3. Rodada 1 · Os cinco modelos

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

## 4. O que vale para todos

- Mesmos textos e dados de exemplo (a dona "Ana", nada real), em pt-BR, "a Zuri" no feminino, sem citar infraestrutura.
- Alvos de toque de 44 px, foco visível na cor do destaque, texto de leitura com 16 px ou mais, "Pular para o conteúdo", pontos que piscam param com "reduzir movimento".
- Claro e escuro em todos.
- Ícones no traço do lucide, que o app já usa.

## 5. Custo de implementar (rodada 1)

- **JS inicial:** nenhum dos modelos pede biblioteca nova. A troca é de CSS (tokens em `apps/web/src/styles.css`) e de montagem das telas Início e Conversa, que já são carregadas à parte.
- **Fontes:** hoje o app usa a fonte do sistema. Cada modelo traz arquivos `woff2` da sua família e da mono (o Lima tem uma família a mais, a Red Hat Display para títulos), uns 60 a 120 KB, servidos pelo próprio Worker e fora do JS inicial. Nada é buscado no Google na hora de abrir. Dá para ficar com a fonte do sistema e levar só cores e montagem.
- **Floresta** é o que mais mexe na estrutura (conversa fixa ao lado e lista de conversas própria). **Lima** e **Cobalto** são os que menos mexem.
- Sem custo na Cloudflare.

## 6. Recomendação (rodada 1)

**Lima.** É o que mais conversa com a marca atual (verde, escuro forte), muda pouco a estrutura e traz a faixa de estado do dia, que é útil. Se a ideia for algo mais leve para usar o dia todo no claro, a segunda opção é **Petróleo**.

## 7. Próximo passo

O Pablo aprova o Menta refinado ou escolhe outro da rodada 2 (ou uma mistura, por exemplo "Menta com o menu escuro do Ardósia"). Aí sai um plano de implementação pela skill `planejar`, com testes, axe, capturas antes e depois e o teto de JS conferido.
