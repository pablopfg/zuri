### Adicionado

- O paciente remarca pelo próprio link de confirmação: **Preciso remarcar** leva em 4 passos ao dia, à manhã ou tarde, à hora de preferência e a um horário livre, só dentro do horário de atendimento e nos próximos 8 dias. O mesmo evento muda de dia e hora no Google e fica Reagendado, e o aviso com o sino diz de quando para quando.
- O aviso de cancelar pelo link oferece **Prefiro remarcar**. Sem dia livre, a página oferece **Combinar pelo WhatsApp** com a mensagem pronta.
- O quadro **Confirmação do paciente** nos detalhes da consulta mostra "Remarcou pelo link", com o horário de antes.

### Segurança

- A remarcação mostra só dias e horários livres, nunca outro evento. O servidor confere de novo o horário na hora de gravar, uma remarcação por vez, e vale até 2 vezes por consulta e só até o prazo de cancelar.

### Atualização

- A migration 46 acrescenta à tabela dos links de confirmação a contagem das remarcações e o horário de antes. Nada muda nos dados que já existem. Com o Cloudflare Access ligado, a passagem `api/c/*` já cobre as rotas novas.
