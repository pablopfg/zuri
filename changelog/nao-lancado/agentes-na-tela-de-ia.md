### Adicionado

- **Agentes na tela de IA.** Em Configurações › IA, o cartão "Agentes" mostra
  cada parte da Zuri que usa IA (conversa, resumo, passo de IA dos fluxos,
  rascunho e segunda leitura das avaliações, conferência das rotinas). Em
  "Ajustar" você muda a temperatura, o `top_p`, o tamanho máximo da resposta e
  o estilo e a tarefa de cada um, e lê as regras fixas de segurança, que valem
  acima do que você escrever.
- Cada mudança vira uma versão com data. Dá para voltar a qualquer uma das 20
  mais recentes ou ao padrão. Cada resposta, rodada de rotina e rascunho de
  avaliação guarda a versão do prompt com que foi feito.

### Segurança

- Salvar pede a senha digitada nos últimos 15 minutos e não funciona no modo de
  bloqueio. Só a tela muda esses ajustes: nenhuma ferramenta, comando do bot,
  MCP, fluxo ou token de acesso remoto chega a eles. O estilo aceita até 2.000
  caracteres, sem `<`, `>` nem caracteres invisíveis, e os dois agentes que só
  conferem não aceitam estilo nenhum.
