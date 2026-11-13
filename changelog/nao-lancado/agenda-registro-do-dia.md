### Adicionado

- Registro do dia na Agenda: à 0h, os eventos do dia que terminou congelam. A ficha mostra "Congelado" com a situação final, e editar, mudar a situação, arrastar ou apagar é recusado na tela, na conversa e nos fluxos. Uma mudança feita depois no Google Agenda aparece marcada na cópia e gera um aviso. A cópia entra na cópia de segurança.

### Alterado

- Feriado nacional sempre fecha a agenda: o botão "Atendo" saiu de Configurações › Agenda.
- Dias sem expediente aceitam um período (férias, recesso, viagem), com "De" e "Até", até 90 dias cada. Quando o período tem consultas marcadas, a tela diz quantas precisam de outro horário.

### Atualização

- Migration 41 (`agenda_record`) cria as tabelas do registro do dia. Ela só acrescenta tabelas e roda sozinha na próxima inicialização. O registro começa no dia da atualização: nenhum dia anterior é copiado.
