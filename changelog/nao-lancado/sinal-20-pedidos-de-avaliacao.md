<!-- versao: minor -->
### Adicionado

- **Avaliações › Pedidos** (`/avaliacoes/pedidos`): todo dia a Zuri olha a agenda e lista quem teve consulta há 8 dias (no próximo dia útil) e ainda não avaliou. **Enviar link de avaliação** abre o seu WhatsApp com a mensagem e um link só daquela pessoa. Você confere e envia; a Zuri nunca manda nada sozinha.
- O link pessoal (`/a/<código>`) leva direto à página de avaliação do perfil no Google e anota a primeira abertura. A prévia do WhatsApp não conta.
- Um lembrete por pessoa, 7 dias depois, se ainda não avaliou, e um aviso nos dias úteis com quantos pedidos estão prontos.
- **Ajustes › Pedidos e link**: o link de avaliação puxado do perfil (ou colado por você), a mensagem e **Quando pedir**.
- Cada avaliação é ligada ao contato pelo nome. Um nome que dois contatos têm (mesmo com um título, como "Dra.") nunca liga sozinho: a avaliação mostra as pessoas e espera **É esta** ou **Nenhuma das duas**.
- A Visão geral mostra o funil dos pedidos: quantos receberam, abriram e avaliaram.

### Segurança

- O link pessoal só leva ao endereço guardado, e só a uma página de avaliação do Google com `https`. Código errado dá 404. Mais de 30 aberturas por minuto da mesma rede, ou 300 no total, dão 429, e quem abre um código errado não grava nada no banco.
- Trocar o link de avaliação pede a senha digitada há pouco e gera um alerta de segurança.
- O nome inteiro de quem avaliou não é guardado: só duas impressões HMAC.
- A mensagem do pedido não aceita outro endereço além do `{link}`, para uma sessão roubada não mandar os pacientes a outro lugar.
- As respostas do link levam HSTS e não abrem dentro de um quadro.

### Atualização

- Migration 41: quatro tabelas novas (pedidos, códigos e a ligação de cada avaliação ao contato) e colunas novas nas tabelas das avaliações. Começam vazias e nada do que existia muda. A primeira leitura depois da atualização lê, uma página por vez e no máximo 20 por dia, as avaliações antigas para calcular as impressões do nome.
