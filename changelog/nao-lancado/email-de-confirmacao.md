### Adicionado

- Integrações › E-mail para pacientes ganhou o **E-mail de confirmação de consulta**: assunto, texto e botão, com as variáveis, a prévia de como chega, "Voltar ao modelo padrão" e "Copiar o texto do WhatsApp". O link do paciente vai sempre no botão.
- Nos detalhes da consulta, **Enviar por e-mail** manda a confirmação para o e-mail do paciente guardado na consulta, pela forma de envio salva, uma vez por horário, e a Zuri registra o envio ("Enviado por e-mail…").

### Alterado

- O backup leva o e-mail de confirmação.

### Segurança

- O e-mail de confirmação não aceita endereço da web nem telefone escritos à mão, e o HTML do e-mail escapa tudo o que vem do modelo, da consulta e do consultório.
- A mensagem do WhatsApp e o e-mail de confirmação recusam caracteres invisíveis, que escondiam um endereço da regra acima.
