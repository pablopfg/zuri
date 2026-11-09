### Adicionado

- **Agentes padronizados.** O resumo da conversa, o passo de IA dos fluxos, o
  rascunho e a segunda leitura das avaliações e a nova conferência das rotinas
  seguem o mesmo contrato: regras fixas de segurança primeiro, depois o estilo
  e a tarefa, dados sempre em blocos `<data>`, resposta conferida e uma versão
  do prompt para saber com qual texto cada resposta foi feita.
- Cada agente tem temperatura e máximo de tokens próprios. A conversa passa a
  usar temperatura 0,4 em qualquer modelo, em vez do padrão de cada um (que ia
  de 0,15 a 0,6).
- `node scripts/avaliar-prompts.ts`: testa os prompts com a IA de verdade na
  sua conta (datas, idioma, ordem escondida em dado, avaliações, rotinas),
  com teto de 300 Neurons por rodada. `--seco` mostra os casos e o custo sem
  chamar nada.

### Segurança

- Quando você pede uma ação e a Zuri responde que fez, mas nenhuma ferramenta
  de escrita deu certo, a resposta ganha o aviso "Não consegui confirmar que
  isso foi feito". É uma conferência fixa, sem IA.
- Uma rotina que chamaria um serviço externo sozinha agora confere a chamada
  antes: nenhum link, e-mail, @ ou número longo que a rotina não citou nem leu,
  e uma segunda leitura pela IA (cerca de 7 a 19 Neurons). Reprovou ou deu
  dúvida, vira proposta para você aprovar.
- O passo de IA dos fluxos para com "a resposta da IA trouxe um link ou
  contato que não estava nos dados" antes de o passo seguinte enviar o texto,
  e caracteres escondidos saem da resposta.
- Um conjunto fixo de frases de ataque (pt-BR e inglês, letras parecidas,
  texto invisível, ordens dentro de avaliação, CRM, agenda e MCP) roda na CI
  contra as defesas, e os prompts montados ficam num instantâneo que aparece
  no diff de toda mudança.
