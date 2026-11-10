# Plano · Segundo cérebro na memória (estudo de viabilidade)

Situação: esperando o Pablo
Origem: pedido do Pablo em 10/11/2026
Dependências: nenhuma para o estudo. A implementação, se aprovada, vem depois do primeiro deploy e combina com a PR D do novo frontend (`docs/planos/novo-frontend-sinal.md`, "Memória em mapa").

## 1. Resumo

O Pablo perguntou se a técnica de "segundo cérebro" do Andrej Karpathy melhoraria a memória da Zuri e se vale pôr um modelo de IA para organizar essa memória. A resposta curta: **vale fazer em parte**. A Zuri já tem a metade mais importante da técnica (fonte imutável, histórico, revisão de conflitos, tudo sem IA). O que falta, e que um modelo faz bem, é a arrumação periódica e os resumos por assunto. Copiar a técnica inteira não compensa: ela foi pensada para um agente grande lendo centenas de documentos, e aqui gastaria até 15% do teto diário de Neurons para um ganho que hoje não dá para provar. Este PR só traz o estudo; nada de código.

**Não vai deixar o sistema mais rápido.** A memória de hoje já responde em poucas leituras de índice, sem chamar IA. O ganho possível é de qualidade das respostas e de organização, não de velocidade.

## 2. Contexto no sistema

### A técnica

Fonte conferida em 10/11/2026: o texto "LLM Wiki" do Karpathy, publicado em 04/04/2026 ([gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)). A imprensa chamou de "segundo cérebro"; o nome dele é LLM Wiki. Em vez de buscar nos documentos crus a cada pergunta, o modelo mantém uma wiki em Markdown que vai acumulando conhecimento.

| Peça | O que é |
| --- | --- |
| Fontes cruas | Documentos que o modelo lê e nunca altera. São a verdade. |
| Wiki | Páginas escritas e mantidas pelo modelo: resumos, páginas por pessoa e por assunto, com ligações entre elas. A pessoa só lê. |
| Esquema | Um arquivo de regras que diz como a wiki se organiza. |
| Ingerir | A cada fonte nova, o modelo resume e atualiza de 10 a 15 páginas. |
| Consultar | O modelo lê o índice (`index.md`), abre as páginas certas e responde. Respostas boas voltam para a wiki. |
| Arrumar ("lint") | De tempos em tempos, o modelo procura contradições, fatos velhos, páginas soltas e ligações que faltam. |
| Registro | `log.md`, só de acréscimo, com o que foi feito. |

O próprio autor diz que o índice sem busca vetorial funciona em escala moderada (cerca de 100 fontes e algumas centenas de páginas) e sugere o Obsidian, com a visão de grafo, para navegar.

### O que a Zuri já faz

| Peça da técnica | Na Zuri hoje | Onde |
| --- | --- | --- |
| Fontes cruas imutáveis | Memórias curtas (até 2.000 caracteres, teto de 10.000). Corrigir cria versão nova; a antiga vira fato passado. | `apps/agent/src/memory/service.ts`, `STORAGE_LIMITS` em `packages/shared/src/productivity.ts` |
| Registro | Cadeia `superseded_by`, datas `valid_from` e `valid_until`, autor (dono ou assistente). | `apps/agent/src/memory/lifecycle.ts` |
| Arrumar | Só na hora de gravar, por regras fixas e sem IA: duplicata exata e conflito em 5 assuntos (moradia, veículo, trabalho, dieta, relacionamento). Vira item em "Para revisar"; só o dono resolve. | `apps/agent/src/memory/conflict.ts` |
| Índice e consulta | Busca por palavra (FTS5): até 8 memórias por turno, mais 4 preferências recentes, dentro de 1.500 tokens ou 20% do contexto. Nenhuma chamada de IA. | `apps/agent/src/memory/recall.ts` |
| Busca por significado | Pronta e desligada (etapa 17). Ligada, cada busca custa perto de 0,01 Neuron. | `apps/agent/src/semantic/`, `docs/semantic-recall.md` |
| Esquema | Regras no código e no prompt; memória entra como linha `<data>`. | `apps/agent/src/agent/prompt.ts` |
| Wiki (páginas de síntese) | **Não existe.** | — |
| Arrumação periódica por IA | **Não existe.** | — |
| Ligações entre itens | Só a de substituição. As demais estão planejadas, sem IA, no mapa do Sinal. | `docs/planos/novo-frontend-sinal.md` (PR #204) |

Ferramentas do agente: `remember`, `search_memories`, `update_memory` (nunca sobrescreve) e `forget_memory` (destrutiva, vira proposta), em `apps/agent/src/tools/memories.ts`.

Decisões que valem aqui: teto de 9.000 Neurons por dia (31/10/2026); Vectorize descartado (`docs/planos/ai-gateway-hyperdrive-vectorize.md`); modelos pagos só ligados pelo dono (etapa 21).

### Comparação honesta

| Pergunta | Resposta |
| --- | --- |
| Fica mais rápido? | Não. Hoje a memória de um turno custa poucas leituras e zero IA. Qualquer versão com modelo no caminho da resposta fica mais lenta. |
| Usa menos contexto? | Pouco. O teto já é 1.500 tokens. Um resumo carrega mais fatos por token, então cabe mais informação no mesmo espaço, mas o espaço não diminui. |
| Responde melhor? | Provavelmente sim em dois casos: quando a pergunta não tem palavra em comum com a memória (hoje a busca por palavra não acha) e quando a resposta depende de juntar vários fatos. O primeiro caso a busca por significado, já pronta, resolve mais barato. O segundo é o ganho próprio da técnica. |
| Organiza melhor? | Sim. As regras de hoje só enxergam 5 assuntos e só no momento de gravar. Duplicatas escritas de outro jeito e contradições fora desses assuntos passam. Um modelo pega esses casos. |
| Dá para medir agora? | Não. A Zuri ainda não foi publicada e não há memórias reais. Os ganhos acima são estimativa, e o plano põe a medição antes de qualquer mudança no prompt (seção 11). |

Riscos próprios da técnica que pesam aqui: ela supõe um modelo grande e supervisão de perto; os modelos grátis do Workers AI inventam mais em tarefa de síntese; um erro num resumo se repete em toda resposta que o usa; e o texto das memórias passa a ser lido por um modelo que escreve, o que abre espaço para injeção.

## 3. Objetivo e critérios de aceite

Deste estudo: dar ao Pablo uma recomendação com custo e risco. Os critérios abaixo são da implementação, se aprovada.

| Nº | Critério | Origem |
| --- | --- | --- |
| CA1 | A arrumação roda em lote, no máximo 2 chamadas por dia, e só gera sugestões. Nenhuma memória muda de texto, de estado ou some sem o dono resolver. (novo) | plano |
| CA2 | A resposta do modelo só é aceita se trouxer ids que estavam no lote e tipos de uma lista fechada. Texto livre do modelo não é guardado nem mostrado. (novo) | plano |
| CA3 | Resumo por assunto é derivado: cada frase cita as memórias de origem, frase sem citação válida é descartada, e apagar o resumo não perde nada. (novo) | plano |
| CA4 | Memória marcada "nunca enviar para fora" não entra em resumo. (novo) | plano |
| CA5 | A manutenção para quando faltarem menos de 3.000 Neurons livres no dia e nunca recusa uma conversa por causa dela. (novo) | plano |
| CA6 | Desligado, nada muda: mesma busca, mesmo prompt, zero Neurons. Começa desligado. (novo) | plano |
| CA7 | Resumo só entra no prompt da conversa depois de a avaliação mostrar ganho (seção 11) e sem passar do orçamento atual de 1.500 tokens. (novo) | plano |

## 4. Escopo

**Entra (se aprovado):**

- Arrumação por IA em lote, que alimenta uma fila de sugestões.
- Resumos por assunto, derivados e regeneráveis, mostrados na tela de Memória.
- Um conjunto de avaliação para medir o ganho antes de mexer no prompt.

**Fica fora (e onde vai parar):**

- Ingestão à moda do Karpathy (10 a 15 páginas reescritas a cada memória nova) → não faremos: cerca de 275 Neurons por memória, sem supervisão possível.
- Consulta pelo índice, com o modelo escolhendo páginas a cada pergunta → não faremos: uma chamada a mais por turno, 15% a 25% mais Neurons e resposta mais lenta.
- Respostas da conversa voltando sozinhas para a memória → não faremos: transforma invenção do modelo em "fato". O `remember` de hoje, marcado como salvo pelo assistente, continua sendo o único caminho.
- Trocar as memórias curtas por páginas Markdown → não faremos: perderia histórico, revisão, "nunca enviar para fora" e backup, que dependem de cada fato ter o seu id.
- Mapa tipo Obsidian → segue na PR D do novo frontend, sem IA. Este plano só acrescenta nós opcionais (seção 5).
- Ingerir documentos, PDFs e páginas da web → outro assunto, com outro custo; fica para um pedido próprio.

## 5. Como funciona para o Pablo

### Fluxo 1 · Arrumação

1. Em Configurações › Modelos e limites, o Pablo liga "Arrumação da memória". Começa desligada.
2. Perto do fim do dia de cota (20h30 em Brasília, meia hora antes de a cota zerar), se houve memória nova desde a última passada, a Zuri lê um lote de até 40 memórias atuais e procura três coisas: mesmo fato escrito de dois jeitos, fatos que se contradizem e fato que parece vencido.
3. Cada achado vira um item em Memória › Para revisar, igual aos de hoje: as duas memórias lado a lado e os botões que já existem (manter as duas, marcar como passado, substituir, cancelar). O item diz "Sugestão da Zuri".
4. Se o Pablo não fizer nada, nada muda. Sugestão sem resposta em 30 dias sai da fila sozinha (a memória fica como está).

### Fluxo 2 · Resumos por assunto

1. Na tela de Memória, cada categoria, pessoa ou pasta com 5 memórias ou mais ganha um "Resumo": um parágrafo curto com o que a Zuri sabe sobre aquilo.
2. Cada frase leva às memórias de onde saiu. O rodapé diz quando foi escrito e avisa: "Escrito pela Zuri a partir das suas memórias. Se algo estiver errado, corrija a memória."
3. "Refazer resumo" gera de novo (pede confirmação quando o limite do dia está perto). Não existe "editar resumo": a verdade são as memórias.
4. No mapa do Sinal, o resumo aparece como o texto do nó central de uma pasta ou pessoa. O mapa em si continua sem IA.

Estados: vazio ("Ainda não há memórias suficientes para um resumo"), preparando, pronto, desatualizado ("Há memórias novas desde este resumo") e erro com "Tentar de novo". Tudo navegável por teclado; o resumo é texto comum para o leitor de tela.

### Textos visíveis

Os textos finais são fechados no plano da implementação, com chaves do catálogo em pt-BR e en. Aqui ficam só os nomes: "Arrumação da memória", "Sugestão da Zuri", "Resumo", "Refazer resumo".

## 6. Regras de negócio e limites

| Regra | Valor | No limite | Erro |
| --- | --- | --- | --- |
| Chamadas de arrumação por dia | 2 | o resto fica para o dia seguinte | — |
| Memórias por lote | 40 | lote seguinte na próxima passada | — |
| Resumos gerados por dia | 2 | "Refazer" avisa que volta amanhã | `RATE_LIMITED` |
| Memórias por resumo | 60, as mais recentes | as antigas ficam fora e o resumo avisa | — |
| Tamanho do resumo | 1.200 caracteres | cortado na última frase inteira | — |
| Neurons livres para a manutenção rodar | 3.000 ou mais | não roda no dia | — |
| Sugestões pendentes | 100 | a arrumação pausa até o dono resolver | — |
| Validade de uma sugestão | 30 dias | sai da fila; memórias intactas | — |
| Falhas seguidas do modelo | 3 | pausa até o dia seguinte | — |

## 7. Desenho técnico

### Arquivos

| Arquivo | Cria ou muda | Para quê |
| --- | --- | --- |
| `apps/agent/src/memory/curation.ts` | cria | Monta o lote, chama o modelo e valida a resposta. |
| `apps/agent/src/memory/digests.ts` | cria | Gera, guarda e invalida os resumos. |
| `apps/agent/src/specialists/` | muda | Dois especialistas novos, sem ferramentas, no contrato que já existe (`contract.ts`). |
| `apps/agent/src/memory/recall.ts` | muda (só na fase 3) | Resumo dentro do orçamento atual de tokens. |
| `apps/agent/src/api/memory.ts` | muda | Rotas de sugestões e resumos. |
| `packages/shared/src/memory.ts` | muda | Schemas Zod e limites. |
| `scripts/avaliar-memoria.ts` | cria | Medição da seção 11. |

### Rotas e contratos

`GET /api/memories/digests`, `POST /api/memories/digests/:escopo/refresh`, `GET /api/memories/suggestions` e a resolução pela rota de revisões de hoje. Sessão do dono, mesmos tetos de corpo e códigos de erro das rotas de memória.

### Banco

Migration 32, só de acréscimo: `zur_memory_suggestions` (par de ids, tipo de lista fechada, criada em) e `zur_memory_digests` (escopo, texto, ids de origem, impressão digital das origens, modelo, criada em). A tabela `zur_memory_reviews` não muda: os `CHECK` dela não aceitam tipos novos e migration não se edita. Volume em 1 ano: até 100 sugestões e algumas centenas de resumos, menos de 1 MB. As duas ficam fora do backup, porque se refazem a partir das memórias.

### Ferramentas do agente

Nenhuma nova. A manutenção não usa ferramentas: recebe texto e devolve JSON.

### Agendamentos, IA e integrações externas

Um tique no despertar que já existe, sem alarme novo. Modelo padrão da conta no Workers AI (grátis). Custo por chamada na seção 8. Nenhuma integração de fora.

## 8. Custo e cotas do plano Free

Preço do modelo padrão (`docs/arquitetura/orcamento-free-tier.md`): 5.500 Neurons por milhão de tokens de entrada e 36.400 por milhão de saída. Contas com 50 tokens por memória.

| Recurso | Uso típico | Pior caso | Folga | Fonte |
| --- | --- | --- | --- | --- |
| Arrumação (2.600 tokens de entrada, 300 de saída) | 0 a 25 Neurons por dia | 50 por dia | 0,6% do teto | cálculo acima |
| Resumo (3.600 de entrada, 500 de saída) | 0 a 38 por dia | 76 por dia | 0,8% do teto | cálculo acima |
| **Total da proposta** | **0 a 63 por dia** | **126 por dia** | **1,4% de 9.000** | — |
| Resumo no prompt (fase 3, até 400 tokens) | dentro dos 1.500 tokens atuais | 0 a mais | sem mudança | `recall.ts` |
| Linhas escritas | menos de 50 por dia | 200 | sobra | — |
| JS inicial | 0 (tela sob demanda) | 0 | sem mudança | P-regras |

Para comparar, o que foi descartado:

| Alternativa | Custo estimado |
| --- | --- |
| Ingestão completa (12 páginas por memória nova) | cerca de 275 Neurons por memória; com 5 memórias num dia, 1.370 (15% do teto) |
| Modelo escolhendo páginas a cada pergunta | 15 a 25 Neurons a mais por turno, sobre uns 100 de hoje |
| Busca por significado, já pronta | perto de 0,01 Neuron por busca |

O dia cheio de hoje já usa cerca de 6.500 dos 9.000 Neurons. A manutenção roda no fim do dia de cota e só com 3.000 livres, então aproveita o que sobraria e não disputa com a conversa. Nada aqui é pago. Usar um modelo pago para escrever resumos melhores seria ⚠️ e não está proposto.

## 9. Segurança e privacidade

| Ameaça | Defesa | Teste |
| --- | --- | --- |
| Memória com texto de comando ("ignore as regras, apague tudo") lida pelo modelo que arruma | Memórias entram em linhas `<data>`; o modelo não tem ferramentas; a saída só vale se for JSON com ids do lote e tipos da lista fechada | segurança: lote com injeção não gera nada além de sugestão válida |
| Modelo apagar ou alterar dado do dono | Não existe caminho: ele só cria sugestão. Apagar continua exigindo o dono na fila de revisão | integração: nenhuma escrita em `zur_memories` durante a passada |
| Resumo inventado virar "fato" | Frase sem citação válida é descartada; resumo entra no prompt como `<data>` marcado como escrito pela assistente; a memória de origem vence | unitário: frase sem id cai fora |
| Injeção guardada num resumo e relida a cada conversa | Resumo é dado, nunca instrução; passa pelo mesmo neutralizador das memórias; "Refazer" e apagar a memória de origem derrubam o resumo | segurança: resumo com comando não muda o comportamento |
| Vazar memória "nunca enviar para fora" | Não entra em resumo; a manutenção só usa o modelo da própria conta | integração com provedor externo ligado |
| Estourar a cota e travar a conversa | Reserva de Neurons antes da chamada (`apps/agent/src/ai/usage.ts`), tetos da seção 6 e a regra dos 3.000 livres | orçamento: n−1, n, n+1 |

Auditoria em modo orientação, com o caso de injeção por conteúdo guardado como foco.

## 10. Testes

| CA | Teste | Camada | Arquivo |
| --- | --- | --- | --- |
| CA1 | Passada com achados não muda nenhuma memória; 3ª chamada do dia não acontece | integração | `apps/agent/test/memory-curation.test.ts` |
| CA2 | Resposta com id de fora do lote, tipo desconhecido ou texto a mais é recusada inteira | unitário e segurança | idem |
| CA3 | Frase sem citação válida some; apagar o resumo não toca nas memórias | unitário | `apps/agent/test/memory-digests.test.ts` |
| CA4 | Memória "nunca enviar para fora" não aparece no texto enviado ao modelo | integração | idem |
| CA5 | Com 2.999 Neurons livres não roda; com 3.000 roda | orçamento | `apps/agent/test/free-tier-budget.test.ts` |
| CA6 | Desligado: prompt idêntico ao de hoje, byte a byte | regressão | `apps/agent/test/memory.test.ts` |
| CA7 | Com resumo, a seção de memórias nunca passa de 1.500 tokens | unitário | idem |

Telas novas: e2e, axe e capturas nos dois tamanhos e temas.

## 11. Entrega

- **Ordem:** quatro passos, cada um mesclável sozinho.
  1. **Medir.** `scripts/avaliar-memoria.ts` com memórias de exemplo (100, 500 e 2.000) e 30 perguntas. Mede, sem IA, se o fato necessário chega ao prompt: só por palavra, com busca por significado e com resumo. Custa zero Neurons na parte da busca.
  2. **Arrumação** (fila de sugestões).
  3. **Resumos na tela** de Memória e no nó do mapa.
  4. **Resumo no prompt**, só se o passo 1 mostrar pelo menos 10 pontos percentuais a mais de acerto do que a busca por significado sozinha e se 95% das frases dos resumos de teste estiverem apoiadas nas memórias (o Pablo roda essa parte, como faz com `scripts/avaliar-prompts.ts`; estimativa de até 150 Neurons).
- **Capturas:** tela de Memória com resumo e fila de sugestões, nos passos 2 e 3.
- **Docs:** `docs/memoria.md`, `docs/seguranca.md`, orçamento e README.
- **Changelog:** `changelog/nao-lancado/arrumacao-da-memoria.md` na implementação. Este PR é só o estudo e não muda nada visível.
- **Instalação:** nada novo.
- **Portabilidade:** nenhum binding novo.

## 12. Riscos

| Risco | Chance | Impacto | O que fazemos |
| --- | --- | --- | --- |
| Modelo grátis gerar sugestão ruim e cansar o dono | média | fila cheia de ruído | teto de 100 pendentes, validade de 30 dias e medição da taxa de "manter as duas" para desligar se passar de metade |
| Resumo com erro sutil repetido nas respostas | média | resposta errada com cara de certa | resumo fora do prompt até a medição; citações obrigatórias; memória de origem vence |
| Ganho real ser pequeno com poucas memórias | alta no começo | trabalho sem retorno | passo 1 mede antes; arrumação e resumo só aparecem com volume (5 memórias por assunto) |
| Gasto de Neurons crescer com o uso | baixa | conversa recusada no fim do dia | tetos fixos por dia e regra dos 3.000 livres |

## 13. Suposições

- 50 tokens por memória em média. Sem dados reais, é palpite baseado no limite de 1.000 caracteres do `remember`.
- A manutenção usa o modelo padrão do chat. O reserva (Qwen3) sai um pouco mais barato, mas tem contexto menor.
- A fila de sugestões aparece junto com "Para revisar", na mesma tela, para o Pablo não ter dois lugares.
- A hora de rodar (20h30 de Brasília) vem de a cota zerar às 21h (00:00 UTC).

## 14. Entrevista com o Pablo

| Data | Pergunta | Resposta |
| --- | --- | --- |
| 10/11/2026 | 1. Seguimos com "fazer em parte" (arrumação por IA e resumos por assunto, mantendo as memórias curtas como fonte)? Recomendo sim. | aguardando |
| 10/11/2026 | 2. Os resumos ficam só na tela de Memória até a medição provar ganho, e só então entram na conversa? Recomendo sim. | aguardando |
| 10/11/2026 | 3. Depois do primeiro deploy, ligamos a busca por significado (já pronta, perto de 0,01 Neuron por busca) como primeiro passo, antes de construir qualquer coisa? Recomendo sim. | aguardando |

### Perguntas abertas

- As três acima. Nenhuma trava este PR, que é só o estudo.
