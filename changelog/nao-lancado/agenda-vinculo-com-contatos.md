### Adicionado

- O nome do paciente no formulário da Agenda procura em Contatos a partir de duas letras, sem acento. Cada pessoa aparece com o celular, a data de nascimento e a última consulta, e a última opção é sempre **Agendar “nome” sem vínculo**.
- **Vincular** a consulta a um contato: o nome, o celular e o e-mail vêm de Contatos e ficam só para leitura, com **Remover vínculo**. Mudar o nome desfaz o vínculo. Nada se vincula sozinho.
- Homônimos: com dois ou mais contatos do mesmo nome, a consulta só é salva com o contato certo ou com **É outra pessoa**, que pede o celular.
- Os detalhes da consulta mostram o contato vinculado com **Abrir em Contatos** e a etiqueta **Homônimo**, ou "Pessoa nova, com o mesmo nome de N contatos" com **Vincular**.

### Atualização

- Migration 43: o índice `zur_agenda_record_contact` no registro do dia, para achar a última consulta de cada contato. Só acrescenta; nada a fazer.
