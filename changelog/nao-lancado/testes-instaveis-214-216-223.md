### Corrigido

- Na conversa, um plano de tarefas aberto para edição logo no fim da resposta não perde mais a edição: antes, o cartão era montado de novo quando a resposta terminava de ser guardada e voltava ao estado inicial.
- Três testes que falhavam de vez em quando ficaram estáveis: o do lint de i18n (passava do tempo com a máquina carregada), o do título escondido do modelo externo (o número do título podia aparecer num id aleatório) e o do plano editado no celular.
