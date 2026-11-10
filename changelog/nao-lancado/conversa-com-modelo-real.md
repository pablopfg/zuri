### Alterado

- A Zuri passa a levar em conta as suas restrições de saúde e alimentação (alergia, intolerância, o que você não come) em qualquer conversa, mesmo quando a pergunta não cita o assunto. Antes, pedir uma sugestão de jantar podia ignorar uma alergia guardada na memória.
- A busca de notas e de memórias encontra o plural pelo singular e o contrário: "presentes" acha "presente" e "reunião" acha "reuniões".
- Com um modelo da Anthropic, a parte repetida de cada pedido fica 5 minutos no cache da empresa e custa um décimo nas chamadas seguintes. Em teste, o custo de entrada caiu cerca de 80%. O painel de uso mostra o valor já com esse desconto.

### Corrigido

- A conversa com os modelos da Anthropic voltou a funcionar. A empresa recusava todo pedido por causa do padrão de e-mail da ferramenta de clientes, e a Zuri respondia "A IA não aceitou este pedido" a qualquer mensagem.
- Quando a Zuri fala antes de usar uma ferramenta e de novo depois, as duas partes da resposta saem em parágrafos separados, e não mais coladas.
- A Zuri sabe, nas mensagens seguintes da mesma conversa, quais ferramentas usou antes. Um modelo de fora deixava de reconhecer o que já tinha feito e pedia desculpas por uma ação que tinha concluído.
- Com um modelo de fora, a Zuri não diz mais que um telefone, e-mail ou CPF "veio como marcador": ela usa o dado normalmente.

### Segurança

- Um CPF seguido de ponto final, no fim da frase ou colado na palavra seguinte, agora também é trocado por um marcador antes de ir a um modelo de fora. Antes só era escondido quando vinha seguido de espaço ou vírgula.
