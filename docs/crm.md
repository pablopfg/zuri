# CRM interno

A Zuri guarda os seus clientes com a etapa do funil, etiquetas, anotações,
retorno e aniversário. Os clientes entram pela conversa com a Zuri. Ela não
manda mensagem a cliente nenhum.

A Zuri **não recebe eventos do n8n** nem de outro sistema no CRM (decisão do
Pablo de 11/11/2026). O que o n8n fazia vai sendo reescrito como
funcionalidade da própria Zuri. Clientes que chegaram por eventos antes dessa
data continuam guardados.

O plano técnico está em `docs/planos/etapa-22b-crm-interno.md`.

> **Tela em mudança.** A aba **Clientes** saiu de Contatos com o novo visual
> (o endereço antigo, `/contatos/clientes`, leva a Contatos). Até as telas
> próprias do CRM chegarem, os clientes são vistos e mudados pela conversa
> ("quem volta esta semana?", "anote no cadastro da Ana…"). O que esta página descreve da lista, do funil e de **Apagar cliente**
> vale para o servidor e volta à tela com o CRM novo. O cartão **Avisos do
> CRM** fica em **CRM**, no menu lateral, abaixo dos fluxos.

## Para o dono

### Clientes e funil

- **Novo cliente** cadastra nome, telefone, e-mail, aniversário (`AAAA-MM-DD`,
  ou `MM-DD` sem o ano), etapa, etiquetas separadas por vírgula, retorno e
  anotações.
- O funil começa com **Novo, Em conversa, Agendado, Cliente** e **Inativo**.
  **Editar funil** renomeia, reordena, acrescenta e tira etapas (de 2 a 12).
  Os clientes de uma etapa que você tirar vão para a primeira.
- Os botões do funil e dos retornos (atrasados, hoje, próximos 7 dias) filtram
  a lista. A busca acha por nome (sem acento), por qualquer pedaço do telefone
  ou pelo e-mail.
- Cada cliente guarda as 100 entradas mais novas do histórico: anotações,
  mudanças de etapa, etiquetas e retorno.
- Cabem 5.000 clientes, 200 etiquetas diferentes e 20 por cliente.
- **Apagar cliente** leva junto as anotações e o histórico, e não dá para
  desfazer. Só a tela apaga: a conversa nunca apaga um cliente.

### Avisos

Em **Avisos do CRM**, na tela **CRM**, você escolhe o que a Zuri avisa, pelos
canais da central de avisos:

- **Retorno**: na hora marcada. Até 10 avisos de uma vez; se vencerem mais, o
  resto vem num aviso só.
- **Aniversários**: na hora que você escolher em **Hora do aviso de
  aniversários** (9 h no seu fuso, se não mexer), com até 5 nomes por aviso.
  Quem faz aniversário em 29 de fevereiro é lembrado no dia 28 nos anos comuns.

Cada dia tem um aviso de aniversários só. Se você mudar a hora depois do aviso
do dia, a hora nova vale a partir de amanhã. Se mudar para uma hora que já
passou, antes do aviso do dia, o de hoje sai na hora antiga e a nova vale a
partir de amanhã.

### Na conversa

Peça, por exemplo, "quem tem retorno atrasado?", "como está o funil?" ou
"passa a Ana para Agendado e marca retorno na sexta". A Zuri:

- busca e mostra clientes, sem telefone e e-mail a menos que você peça;
- cadastra cliente e muda etapa, etiquetas, retorno e anotações **sem pedir
  confirmação** (decisão do Pablo de 03/11/2026);
- nunca apaga cliente, mexe no funil nem fala com cliente.

As rotinas leem o CRM (por exemplo, um resumo do funil toda segunda), mas não
mudam nada.

### Sugestões de fluxo

Quando você pede na conversa um fluxo ("me avisa se o site cair"), a Zuri
deixa uma **sugestão** em **CRM › Fluxos**, na seção **Sugestões da
Zuri**. Nada roda: você toca em **Revisar**, confere e salva com a sua senha.
O fluxo salvo começa **desligado**. Uma sugestão some em 7 dias se você não a
salvar, e cabem 5 de cada vez.

## Segurança e privacidade

- O CRM não tem porta para outros sistemas: só a sua sessão e a conversa
  gravam nele. O endereço `/api/crm/events/…` e a chave dos eventos deixaram
  de existir, e nenhum token de acesso remoto alcança `/api/crm`.
- O que está no cadastro e no histórico é dado, nunca instrução: entra no
  prompt só em `<data source="crm">`.
- Nome, telefone, e-mail, anotações e histórico dos clientes nunca vão para os
  logs, nem os de erro.
- Os avisos de retorno levam o nome do cliente e a nota do retorno. Se eles chegam por push no celular, podem aparecer na tela
  bloqueada: desligue esses avisos em **Avisos do CRM** se os seus clientes
  forem dados sensíveis (por exemplo, de saúde).
- Depois que a conversa lê o CRM, nenhuma ferramenta de serviço externo (MCP)
  roda sem pedir, nem nas mensagens seguintes: um texto plantado por um
  estranho no histórico não manda os seus dados para fora sem você ver.
- A conversa recebe telefone e e-mail só quando você pede.

## Custo no plano gratuito

A lista lê o funil e as etiquetas de contadores mantidos pelo banco, não dos
5.000 clientes; uma página da lista lê 50 clientes e as etiquetas deles. O alarme olha o próximo
retorno e o próximo aniversário por índice. Os números ficam conferidos em
`apps/agent/test/free-tier-budget.test.ts`.
