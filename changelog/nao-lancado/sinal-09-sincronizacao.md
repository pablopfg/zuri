<!-- versao: minor -->
### Alterado

- Os contatos do Google passam a ser lidos a cada 5 minutos (antes, de hora em hora) e as avaliações a cada 10 (antes, 15). Uma leitura sem novidade não regrava nada e não faz a tela recarregar.
- "Sincronizar agora", nos contatos, vale uma vez por minuto, como o "Conferir agora" das avaliações.
- A Zuri guarda mais do que o Google tem de cada contato: nome do meio, endereços, sites, relações e nomes de usuário em aplicativos de conversa. Na conversa, ela já responde com esses dados; a ficha completa chega com a tela nova de Contatos.
- Cada contato guarda até 10 telefones, 10 e-mails e 10 datas (antes, 5 de cada).
- Quando o Google fica fora do ar, a Zuri tenta de novo mais cedo (a partir de 5 minutos nos contatos e de 10 nas avaliações) e avisa depois de pouco mais de uma hora de falhas.

### Atualização

- Migration 32: colunas novas em `zur_contact_sync` e `zur_review_settings`. Ela é aplicada sozinha na primeira requisição, sem nada a fazer.
- Na primeira leitura depois da atualização, a Zuri lê todos os contatos de novo, uma única vez, para trazer os campos novos. Com muitos contatos, isso leva alguns minutos.
