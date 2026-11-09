<!-- versao: minor -->
### Alterado

- Textos revistos em todo o app, no bot e nos avisos, em português e em
  inglês, com as mesmas palavras para a mesma ação: **Apagar** (não mais
  Excluir), **Desconectar** o Telegram (não mais Desvincular), **Ligar** e
  **Desligar** (não mais Ativar), **Entrar** e "a entrada" (não mais login),
  **Rotina da Zuri** para as rotinas com IA, "conversa" em vez de "chat".
- Mensagens de erro dizem o que fazer: a falha genérica deixou de ser "Algo
  deu errado", os limites dizem quando voltam e o que continua funcionando, e
  as instalações sem um recurso configurado apontam para o guia.
- Confirmações rápidas ("Tarefa criada", "Conversa apagada") sem ponto final,
  e nenhum ponto de exclamação fora do cumprimento da Zuri.
- No bot, `/pausar_rotinas` passa a se chamar "Pausar as rotinas da Zuri" no
  menu, que é enviado de novo ao Telegram.
- A descrição do app instalado no celular deixou de citar a Cloudflare.

### Adicionado

- Lint de textos na CI: barra os termos que o glossário evita, "com sucesso",
  "Ops", "Por favor", travessão, três pontos no lugar de reticências, "!" fora
  do cumprimento e nomes de infraestrutura nas telas, com exceções comentadas.
- `node scripts/inventario-de-textos.ts` lista todas as chaves do catálogo com
  o tipo de cada uma, ou só as que mudaram desde um commit.
