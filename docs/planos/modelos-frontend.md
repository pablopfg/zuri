# Plano · Cinco modelos de interface

Situação: esperando o Pablo escolher
Origem: pedido do Pablo em 09/11/2026 ("use a skill taste para criar 5 novos modelos de frontend para eu aprovar")
Dependências: nenhuma para escolher. A implementação, se houver, vira PR própria.

## 1. Resumo

Cinco direções visuais para a Zuri, todas com a mesma organização aprovada em 03/11 (barra lateral com Nova conversa, Buscar, seções, Recentes e a conta no rodapé; gaveta no celular). O que muda entre elas é a cara: fonte, cores no claro e no escuro, espaçamento, cantos e o jeito de montar o Início e a Conversa.

Paletas e pares de fontes saíram do sorteio da skill `taste-skill` para "produto de IA, software, fintech e ferramenta" (avaliação de segurança em `docs/planos/skill-taste.md`). As cores foram ajustadas para os dois temas passarem no contraste.

Nada no app muda até o Pablo escolher. Vale lembrar que em 03/11 ele preferiu manter as cores atuais (Sinal); estes modelos são a nova rodada que ele pediu.

- Protótipo: `docs/planos/modelos-frontend/prototipo.html` (abra no navegador; a barra do topo troca modelo, tela e tema).
- Capturas: `docs/capturas/pr/modelos-frontend/`, nome `<modelo>-<inicio|conversa>-<computador|celular>-<claro|escuro>.png` (40 imagens).
- Acessibilidade: axe (WCAG 2.1 A/AA e boas práticas) sem nenhuma violação nas 40 combinações.

## 2. Os cinco modelos

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

## 3. O que vale para todos

- Mesmos textos e dados de exemplo (a dona "Ana", nada real), em pt-BR, "a Zuri" no feminino, sem citar infraestrutura.
- Alvos de toque de 44 px, foco visível na cor do destaque, texto de leitura com 16 px ou mais, "Pular para o conteúdo", pontos que piscam param com "reduzir movimento".
- Claro e escuro em todos.
- Ícones no traço do lucide, que o app já usa.

## 4. Custo de implementar

- **JS inicial:** nenhum dos modelos pede biblioteca nova. A troca é de CSS (tokens em `apps/web/src/styles.css`) e de montagem das telas Início e Conversa, que já são carregadas à parte.
- **Fontes:** hoje o app usa a fonte do sistema. Cada modelo traz arquivos `woff2` da sua família e da mono (o Lima tem uma família a mais, a Red Hat Display para títulos), uns 60 a 120 KB, servidos pelo próprio Worker e fora do JS inicial. Nada é buscado no Google na hora de abrir. Dá para ficar com a fonte do sistema e levar só cores e montagem.
- **Floresta** é o que mais mexe na estrutura (conversa fixa ao lado e lista de conversas própria). **Lima** e **Cobalto** são os que menos mexem.
- Sem custo na Cloudflare.

## 5. Recomendação

**Lima.** É o que mais conversa com a marca atual (verde, escuro forte), muda pouco a estrutura e traz a faixa de estado do dia, que é útil. Se a ideia for algo mais leve para usar o dia todo no claro, a segunda opção é **Petróleo**.

## 6. Próximo passo

O Pablo escolhe um modelo (ou mistura, por exemplo "cores do Lima com o Início do Petróleo"). Aí sai um plano de implementação pela skill `planejar`, com testes, axe, capturas antes e depois e o teto de JS conferido.
