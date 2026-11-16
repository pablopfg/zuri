### Adicionado

- Configurações › Consultório ganhou a **Mensagem de confirmação**: o texto que vai ao paciente, com um botão para cada variável (nome, tipo, dia, hora, local, link, prazo, consultório e WhatsApp da equipe), a prévia de como chega no WhatsApp, com o negrito, e "Voltar ao modelo padrão". A Zuri recusa mensagem sem `{link}` ou com variável que não conhece.
- Nos detalhes da consulta, **Enviar pelo WhatsApp** abre o WhatsApp Web com a mensagem pronta para o celular do paciente, e a Zuri registra o envio ("Enviado pelo WhatsApp…", depois "Enviar de novo"). **Copiar mensagem** copia o mesmo texto.

### Alterado

- O quadro "Confirmação do paciente" começa em "Ainda não enviado", e "Copiar link" virou "Copiar mensagem". Consulta já confirmada não oferece envio.
- O backup leva a mensagem de confirmação.

### Segurança

- A mensagem de confirmação não aceita endereço da web nem telefone escritos à mão: eles entram só por `{link}` e `{whatsapp}`. Assim uma sessão roubada não manda os pacientes para outro lugar. Endereço no título do evento ou no nome do consultório também fica fora da mensagem.

### Atualização

- Migration 47: tabela `zur_confirm_sends`, o registro dos envios da confirmação (link, horário, canal e hora, sem o texto e sem o telefone), fora do backup.
