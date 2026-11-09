<!-- versao: minor -->
### Adicionado

- ⚠️ **Modelos pagos opcionais** em **Configurações › IA**: Claude Haiku 5.5 e
  Claude Sonnet 5.5 (Anthropic) e GPT-6 Luna e GPT-6.1 Terra (OpenAI), como
  modelo de conversa ou como reserva do Workers AI. Tudo começa desligado. Para
  usar, você cadastra a chave da empresa como segredo do Worker
  (`ANTHROPIC_API_KEY` ou `OPENAI_API_KEY`; basta uma) e escolhe o modelo. A
  cobrança é da empresa, na sua conta de lá.
- **Teto de gastos em US$** por dia, opcional e desligado por padrão. Com um
  valor, os modelos pagos param quando o gasto do dia passaria dele.
- **Consumo por período**: gasto em US$ por dia e por modelo, Neurons por dia
  contra o teto, pedidos, falhas, vezes que a reserva respondeu, média, projeção
  de 30 dias e os modelos mais usados, para 7, 30 ou 90 dias. Os números mudam
  sozinhos enquanto a tela está aberta.
- Cartão **Modelos pagos** com o estado de cada empresa (sem chave, pronta, sem
  crédito ou chave recusada) e os botões **Já recarreguei** e **Tentar de
  novo**.
- **Nunca enviar para fora** nas memórias e nas notas: o que estiver marcado só
  vai para o modelo grátis da sua conta.

### Segurança

- Antes de salvar um modelo pago, a Zuri mostra o que vai para a empresa, o que
  fica na sua conta, por quanto tempo a empresa guarda os dados e o link das
  regras dela, e pede a senha de novo. Mudar o teto também pede a senha.
- Para um modelo de fora vai menos coisa: as últimas 8 mensagens, até 600
  caracteres de cada nota lida, e nada marcado como "Nunca enviar para fora".
  E-mails, telefones, CPFs, cartões, IBANs e chaves de API vão trocados por
  marcadores como `[EMAIL_1]`, e voltam ao normal só na resposta que você lê e
  nas ferramentas.
- Só entram empresas que não treinam modelos com o que recebem pela API. A
  OpenAI recebe `store: false`. O AI Gateway não é usado.
- Sem crédito ou com a chave recusada, a empresa fica de lado até você tocar no
  botão, e a reserva grátis responde no lugar.
- Fluxos e respostas a avaliações nunca usam modelo pago: eles têm teto próprio
  em Neurons e ficam no modelo grátis.
- A marca "Nunca enviar para fora" acompanha a memória corrigida, a nota que
  volta da lixeira e o título da nota.

### Atualização

- Migration 29: colunas novas nos contadores de uso (gasto dos modelos pagos e
  vezes que a reserva respondeu) e a marca "Nunca enviar para fora" nas
  memórias e notas. Nada é apagado; tudo nasce desmarcado.
