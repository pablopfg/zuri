# Plano · Nome, homônimos, foto e consultas na ficha dos contatos

Origem: pedido do Pablo de 11/11/2026 (itens 1, 3, 5 e 6 da mensagem). Os itens 2 e 4 estão em outras threads.

## 1. Resumo

O dono escreve os contatos no Google como "Nome Completo / Categoria". A Zuri passa a guardar só o nome, mostra a anotação à parte, trata duas pessoas com o mesmo nome como duas pessoas, mostra a foto do Google e, na ficha, a última consulta e o retorno lidos da agenda. A primeira configuração mostra as etiquetas antes de copiar qualquer contato.

## 2. Contexto no sistema

- Cópia dos contatos: `apps/agent/src/google/contacts.ts` (`readPerson`, `FIELDS_VERSION`), tabela `zur_contacts` com `display_name`, `search_name` e `data` (JSON). Cada contato é uma linha por `resource_name` do Google, então homônimos já eram linhas separadas.
- Agenda: `apps/agent/src/google/service.ts`. Não existe cópia local de eventos; tudo é lido do Google na hora, com `q` para busca por texto.
- Tela: `apps/web/src/pages/contacts/` (S10 do Sinal, PR #291) e `apps/web/src/pages/settings/ContactsSection.tsx`.

## 3. Objetivo e critérios de aceite

1. "Beatriz Novaes Conceição / Paciente" é guardado e mostrado como "Beatriz Novaes Conceição"; a anotação fica à parte. Sem anotação, com outros separadores, espaços a mais, barra dentro do nome ou texto vazio, nada quebra e o nome nunca fica vazio à toa.
2. Ao voltar da página do Google, as etiquetas já estão na tela; nenhum contato é lido do Google antes de uma etiqueta ser escolhida; só os contatos das etiquetas escolhidas são copiados.
3. A foto do contato aparece quando o Google tem uma, sem custo e sem guardar a imagem.
4. Dois contatos com o mesmo nome completo continuam dois contatos; a lista e a ficha mostram telefone, nascimento e CPF para diferenciar. A lista mostra só o telefone abaixo do nome.
5. A ficha mostra o último atendimento e o próximo a partir da agenda, com o título pelo tipo, com evento sem tipo, cancelado, de dia inteiro, fuso do dono e homônimos tratados.

## 4. Escopo

Dentro: os cinco critérios acima, testes, documentação e capturas. Fora: intervalo de sincronização na tela (item 2) e menu lateral que recolhe (item 4); escrever no Google; guardar eventos da agenda; juntar contatos duplicados.

## 5. Como funciona para o Pablo

- **Lista:** nome limpo e, abaixo, o primeiro telefone. Homônimos ganham "nasc. …" e "CPF ***.982.247-**" na mesma linha.
- **Ficha:** foto ou iniciais, nome, a anotação numa marca, etiquetas; aviso quando existe homônimo; bloco **Atendimentos** com o último (**Última consulta** ou **Último retorno**) e o próximo (**Retorno** ou **Próxima consulta**); sem próximo, só **Último atendimento**.
- **Integrações:** depois de **Ligar contatos**, o cartão mostra as etiquetas e "Escolha abaixo as etiquetas que a Zuri copia. Nenhum contato é copiado antes disso."

## 6. Regras de negócio e limites

- Anotação: o que vem depois da primeira `/`, `|` ou `\` cujo lado esquerdo tem pelo menos duas letras, ou o que está entre parênteses ou colchetes no fim. Hífen nunca separa. Barra entre duas letras soltas ou entre números ("S/A", "A/C", "24/7") faz parte do nome. Anotação com até 60 caracteres. As partes do nome do Google (nome, nome do meio, sobrenome) perdem a anotação também.
- CPF: campo personalizado chamado CPF, depois um campo cujo valor cita "CPF", depois as observações após a palavra "CPF". Só com dígitos verificadores certos. Na lista sai mascarado.
- Foto: só endereço `https` em `*.googleusercontent.com`, sem usuário, porta ou fragmento, até 500 caracteres; a foto padrão do Google é ignorada.
- Consultas: título do evento igual ao nome (com ou sem anotação, com "Retorno - Nome", "Consulta: Nome"); "Carla Regina" nunca casa com "Carla Regina Duarte Pires". Tipo: primeira linha "Tipo | Local" das observações. Janela de 3 anos para trás e 1 para a frente, até 10 agendas, 2 páginas de 250 por agenda, 12 chamadas por abertura da ficha. Nome com acento que não acha nada é pesquisado mais uma vez sem acento.
- Homônimos nos eventos: evento com telefone, e-mail, CPF ou nascimento de um dos contatos vai só para ele; sem nada disso aparece nos dois com aviso. Evento com CPF diferente do contato é descartado.

## 7. Desenho técnico

### Arquivos

- `apps/agent/src/google/contact-name.ts` (novo): `splitName`, `nameParts`, `findCpf`, `maskCpf`, `photoUrl`.
- `apps/agent/src/google/appointments.ts` (novo): `readType`, `titleNames`, `carries`, `readAppointment`, `contactAppointments`.
- `apps/agent/src/google/contacts.ts`: `readPerson` usa os dois; `FIELDS_VERSION` 3 (pede `photos`); `sameName`, `identity`; `labelsRead` no estado.
- `apps/agent/src/api/google.ts`: lê as etiquetas no retorno do Google; rota nova.
- `apps/web/src/pages/contacts/`: `Avatar.tsx`, bloco Atendimentos, aviso de homônimo, lista só com telefone.
- CSP em `apps/web/public/_headers` e `apps/agent/src/gates/headers.ts`.

### Rotas e contratos

- `GET /api/contacts/:id/appointments` → `{ available, last, next, more }`; 404 para contato fora da cópia; erros do Google nos códigos de sempre.
- `ContactSummary` ganha `note`, `cpf` (mascarado), `photo`, `birthdayFull`; `ContactDetail` ganha `sameName`; `ContactsStatus` ganha `labelsRead`.

### Banco

Sem migration: os campos novos entram no JSON `data` de `zur_contacts`. `FIELDS_VERSION` 3 faz uma leitura inteira única, que regrava só os contatos que mudaram (com anotação, CPF ou foto).

### Ferramentas do agente

Sem mudança no contrato: `search_contacts` e `get_contact` continuam com os mesmos campos (o nome já vem limpo). Os passos de fluxo recebem os mesmos seis campos de antes; foto e CPF não viajam em fluxo.

## 8. Custo e cotas do plano Free

Nenhum recurso novo. A ficha faz uma leitura da agenda por agenda aberta quando abre (cache de 1 minuto na tela). A foto é pedida pelo navegador ao Google e não passa pelo Worker. A releitura única dos contatos grava só quem mudou.

## 9. Segurança e privacidade

- CSP: `img-src` aceita `https://*.googleusercontent.com`; só imagem. Endereço conferido no servidor e na tela; `referrerPolicy="no-referrer"`.
- A rota de consultas devolve só data, tipo e local do tipo; título, observações e convidados do evento ficam no servidor.
- CPF inteiro só na ficha (campo do Google, como antes); lista com máscara; nada de contato em log.
- Texto do Google continua tratado como dado: limpo, cortado e mostrado como texto.

## 10. Testes

`contact-name.test.ts`, `appointments.test.ts`, `google-contacts-routes.test.ts` (primeira configuração, nome, homônimos, rota de consultas), `free-tier-budget.test.ts` (ficha), `contacts-person.test.ts`, `contatos.spec.ts` e `google-contatos.spec.ts` (e2e com axe, celular e foto com CSP).

## 11. Entrega

Uma PR para a `develop`, depois da S10 (#291). Changelog em `changelog/nao-lancado/contatos-nome-ficha.md`.

## 12. Riscos

- A busca `q` do Google pode não ignorar acentos: por isso a segunda tentativa sem acento.
- Título fora do padrão (apelido, só o primeiro nome) não é achado; a ficha diz "Nenhum atendimento na agenda".
- O Google pode trocar o domínio das fotos: nesse caso voltam as iniciais, sem erro.

## 13. Suposições

- Decidido pelo Pablo (11/11/2026): o quadro do passado é o último atendimento que já começou, com o título pelo tipo ("Última consulta" ou "Último retorno"); o quadro seguinte é o próximo marcado de hoje em diante ("Próxima consulta" ou "Retorno"); sem próximo, o quadro some e o do passado vira "Último atendimento". O e-mail também separa homônimos na agenda.
- A anotação guardada à parte é útil ao dono (aparece na ficha e na busca).

## 14. Entrevista com o Pablo

### Perguntas abertas

- Nenhuma. A leitura dos títulos foi respondida pelo Pablo em 11/11/2026 (seção 13).
