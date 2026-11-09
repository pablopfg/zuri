# Sinal refinado: desenho das funcionalidades pedidas em 09/11

Respostas e desenho para os pedidos do Pablo de 09/11 às 18:03 e às 18:23, feitos sobre o protótipo [`prototipo-v5.html`](modelos-frontend/prototipo-v5.html). É um plano: nada aqui está no código da `develop` ainda. Quando o modelo for aprovado, cada bloco vira uma PR própria, com plano no modelo de `modelo-de-plano.md`.

## 1. O protótipo segue a develop

Antes, o protótipo tinha só duas seções de Configurações funcionando. Conferi as telas, os campos e as configurações da `develop` em 09/11 (catálogo `packages/shared/i18n/pt-BR-*.ts` e `apps/web/src/pages/`) e o protótipo agora mostra o que existe:

| Área | O que existe na develop e agora aparece no protótipo |
| --- | --- |
| Configurações | As 7 abas reais (Conta, Segurança, IA, Avisos, Integrações, Dados, Diagnóstico), cada uma com os cartões de verdade: nome, idioma, fuso, tema, senha e sair; duas etapas, passkeys, saída automática, atividade de acesso e acesso remoto por token; uso do dia, modelo e limites, agentes, modelos pagos desligados, busca por significado e consumo; resumo do dia, "A Zuri de olho", canais, o que vai para cada canal, Telegram com grupo e tópicos, prioridades aprendidas; Google (agendas com Fechada / Só ler / Ler e editar), contatos por etiqueta, avaliações (perfil, assinatura, tom, nível), serviços MCP; armazenamento, exportar e importar, backup automático, lixeira; situação, versão e falhas. |
| Tarefas | Abas Hoje, Próximas, Atrasadas e Todas (saiu "Concluídas", que não existe). |
| Notas | Escrever e Prévia (Markdown), "Nunca enviar para fora" e projeto. |
| Memória | Os 7 tipos, filtro por tipo, Atuais / Incertas / Passadas, "Para revisar" com as 4 saídas de um conflito e "Nunca enviar para fora". |
| Automações | Abas Rotinas e Fluxos; sugestão da Zuri esperando aprovação na própria tela; "Só avisa quando houver algo"; histórico com "No horário", "Recuperada", "Entregue" e "Nada a avisar"; fluxos, sugestões, conexões e os 10 passos que existem. |
| Criar automação | Os tipos reais (Lembrete, Resumo das tarefas, Rotina da Zuri, Fluxo), as 5 frequências (inclui "A cada algumas horas"), modelos de rotina (Briefing da manhã, Fechamento do dia, Resumo do funil), ferramentas externas por rotina, prioridade Baixa / Normal / Alta e "Só me avise quando houver algo". O passo "Onde avisar" virou "Avisos": os canais ficam em Configurações › Avisos, como no código. |
| Contatos › Clientes | Retornos (atrasados, hoje, 7 dias), novos na semana, funil com "Editar funil", retorno no cliente, "Anotar no histórico" e "Editar cliente". O CRM é editável na Zuri; o texto "só leitura" saiu. |
| Contatos › Avaliações | Filtro "Precisa de você / Publicadas sozinha / Todas", nota, "Conferir agora", "Pausar respostas", motivos (Nota baixa, Tem reclamação), origem do rascunho, contador de 600 caracteres, prazo da aprovação, "Escrever de novo", "Descartar rascunho" e "Já resolvi fora da Zuri". |

Continuam como proposta, sem nada parecido na develop: a seção Configurações › Agenda, o salvamento automático das notas, o microfone da memória, todos os campos do contato, os pedidos de avaliação e os painéis de perfil e avisos. A aba "Google" de Contatos aparece como "Pessoas" no protótipo; dá para manter "Google" se preferir.

## 2. Carregando

Aparece em todo lugar que espera dado: ao abrir cada tela pela primeira vez (esqueleto com o sinal da Zuri pulsando e uma frase do que está vindo), ao trocar de semana na agenda (linha no topo, sem apagar a semana anterior), no botão Entrar ("Entrando…") e em todo botão que demora. Regras: nada aparece antes de 300 ms, o esqueleto tem o formato do que vai chegar, "Reduzir movimento" para tudo, e depois de 15 s entra "Está demorando mais que o normal". O protótipo mostra todos os casos na tela "Estados".

## 3. Rolagem no celular

O defeito era real e estava no protótipo: textos escondidos para leitor de tela usam posição absoluta e, sem um pai posicionado, escapavam do corte da página. A página inteira ganhava altura e rolava junto com o conteúdo, levando a barra de baixo e o perfil. Agora a página fica presa à tela e só a área do conteúdo rola. O teste de clique confere isso no computador e no celular. Quando o modelo for para o código, a mesma regra entra no `AppShell` com um teste e2e.

## 4. Agenda em tempo real

Já existe desde a etapa 19 (`docs/planos/etapa-19-google-agenda.md`, seção 15). O Google avisa a Zuri quando algo muda (`events.watch`), o aviso chega assinado, a Zuri responde sempre 200 e a tela relê só a janela aberta pelo canal ao vivo. Os canais são renovados um dia antes de vencer, no máximo 4 por despertar, até 10 agendas. O aviso do Google é grátis e não gasta cota: a Zuri só chama a API quando algo mudou de verdade. Não há o que mudar.

A linha "Mostrar das 08:00 até 18:00" saiu da agenda. O horário fica em Configurações › Agenda, e a legenda da agenda leva até lá.

## 5. Contatos quase em tempo real

A People API do Google não avisa quando um contato muda (não existe `watch` para contatos). O jeito mais leve é a leitura incremental que já existe (`syncToken`): uma pergunta que volta vazia quando nada mudou.

| Situação | Quando a Zuri pergunta |
| --- | --- |
| App aberto em Contatos | A cada 5 minutos, e ao abrir a tela (no máximo 1 vez por minuto) |
| Botão "Atualizar agora" | Na hora, com espera de 30 s entre toques |
| App fechado | De hora em hora, como hoje |

Conta: no pior caso, 12 perguntas por hora com o app aberto, quase todas vazias. A cota de leitura da People API é contada por minuto e fica muito acima disso (o número exato do seu projeto aparece no Google Cloud, em Cotas). Se o token vencer (7 dias sem uso) ou o Google responder `EXPIRED_SYNC_TOKEN`, a Zuri relê tudo uma vez. O próprio Google avisa que uma mudança pode levar alguns minutos para aparecer na leitura, e a tela diz isso.

## 6. Todos os campos do contato

Passam a vir também endereço e foto, além do que já vem (nomes, apelidos, telefones, e-mails, aniversário, datas, empresa, etiquetas, relações, campos personalizados e observações). Isso muda uma decisão anterior, que deixava endereço e foto de fora: precisa do seu OK. A ficha organiza tudo em grupos com ícone e mostra só o que existe.

Telefone: no computador, o botão "Telefone" abre um menu com "Copiar" e "Ligar pelo computador" (`tel:`, que abre o app de chamadas que você tiver). No celular, o botão vira "Ligar" e liga direto.

WhatsApp: o ícone aparece em todo celular brasileiro (DDD e 9 dígitos começando com 9), com um link `wa.me`. Não existe jeito gratuito e oficial de saber se um número tem WhatsApp antes de abrir a conversa. Se o número não tiver, o próprio WhatsApp avisa.

## 7. Avaliações por contato e índice de recomendação

Cada contato mostra a avaliação dele no Google: quando avaliou, a nota, quando editou (a nota antiga fica no histórico) e quando apagou. A edição aparece porque o Google muda a data da avaliação. A exclusão aparece porque a avaliação some da lista: entra uma leitura completa por dia, que compara o que existia com o que existe. A leitura de 15 em 15 minutos que já roda continua cuidando das novas e das editadas.

O índice de recomendação usa as estrelas: 5 estrelas recomenda, 4 é neutro, de 1 a 3 não recomenda. Índice = % que recomenda − % que não recomenda, de −100 a 100. Não é o NPS de 0 a 10. O nome na tela é "Índice de recomendação" para não confundir.

## 8. Pedido de avaliação (decisão de 09/11: opção A)

Você envia com um toque. A Zuri monta a fila, abre o WhatsApp com a mensagem e o link prontos, e você aperta enviar. A Zuri continua sem escrever para contatos.

### 8.1 Primeiro, ligar as avaliações que já existem aos contatos

Antes de qualquer pedido sair, a Zuri lê todas as avaliações do perfil (a primeira leitura da etapa 19c já guarda o histórico) e tenta ligar cada uma a um contato:

1. Nome completo igual a um único contato: sugestão forte.
2. Primeiro e último nome iguais, ou o contato abriu o link pessoal pouco antes: sugestão fraca.
3. Nada parecido: avaliação sem contato.

A regra de segurança é assimétrica: qualquer sugestão, forte ou fraca, tira a pessoa da fila até você decidir. Errar para menos (deixar alguém sem pedido) é aceitável; errar para mais (pedir de novo a quem já avaliou) não é. "É ele" confirma; "Não é" devolve a pessoa à fila.

Um cuidado: hoje a Zuri guarda só o primeiro nome de quem avaliou (minimização de dados da etapa 19c). Para ligar avaliação a contato, ela precisa comparar o nome inteiro. Proposta: guardar apenas uma impressão digital do nome inteiro (HMAC do nome normalizado, sem acento e em minúsculas) e calcular a mesma impressão para cada contato. O nome inteiro de quem avaliou não fica guardado.

### 8.2 Quem entra na fila e quando

- Só quem nunca avaliou e não pediu para não receber.
- A data vem da consulta: o evento na agenda Pessoal com o telefone do contato na descrição (o jeito mais seguro), ou o agendamento que o n8n já manda ao CRM. Evento só com o nome casa como sugestão e pede a sua confirmação.
- O pedido sai 8 dias depois da consulta. Se cair em sábado, domingo ou feriado, passa para o próximo dia útil.
- Feriados: os nacionais vêm calculados no código, sem chamada a API (1/1, Carnaval, Sexta-feira Santa, 21/4, 1/5, Corpus Christi, 7/9, 12/10, 2/11, 15/11, 20/11 e 25/12). Carnaval e Corpus Christi vêm marcados, mas dá para desmarcar. Feriados da cidade, recesso e férias entram em "Dias sem expediente".
- Às 09:00 de cada dia útil, um aviso diz quantos pedidos estão prontos para hoje. A lista fica em Contatos › Avaliações › Pedidos de avaliação.
- Um lembrete só, 7 dias depois do envio e também em dia útil, se a pessoa não avaliou. Depois disso, a Zuri não sugere de novo.

Exemplos do protótipo, com hoje sendo segunda, 09/11/2026:

| Consulta | 8º dia | Pedido |
| --- | --- | --- |
| Sexta, 30/10 | Sábado, 07/11 | Segunda, 09/11 |
| Sexta, 06/11 | Sábado, 14/11 | Segunda, 16/11 |
| Quinta, 12/11 | Sexta, 20/11 (Consciência Negra) | Segunda, 23/11 |

### 8.3 Travas contra o envio repetido

1. Na hora do toque, o servidor confere de novo: avaliação nova, sugestão de ligação pendente, pedido já enviado ou "não quer receber". Qualquer uma barra o envio.
2. Cada pedido tem uma chave única (contato + campanha). O segundo toque, em outra aba ou no celular, vira "já enviado".
3. O mesmo telefone em dois contatos conta como uma pessoa.
4. O link é pessoal: um código aleatório, sem nome nem telefone, que registra a abertura e leva para a página de avaliação do Google. Ajuda a ligar a avaliação ao contato.
5. Uma nova leitura de avaliações que ligue alguém da fila tira a pessoa na hora.
6. Nada de filtrar quem vai avaliar: todos recebem o mesmo link, não só quem parece satisfeito. Pedir avaliação só para quem está satisfeito ("review gating") é proibido pelas regras do Google.

Estados de cada pessoa: Agendado, Para enviar hoje, Enviado sem resposta, Lembrado, Avaliou, Avaliou e apagou, Não quer receber.

## 9. Envio automático pelo Chatwoot (futuro): viabilidade

É viável, e o caminho mais seguro passa pelo n8n que você já usa, sem a Zuri falar direto com o Chatwoot.

```
Zuri (decide quem e quando) ──POST──▶ n8n ──API──▶ Chatwoot ──▶ WhatsApp do contato
   ▲                                    │
   └──── evento "message_out" assinado ─┘
```

1. Às 09:00 de cada dia útil, um fluxo da Zuri usa o passo "Chamar um serviço" (que já existe: só POST, PUT e PATCH, credencial cifrada, teto de chamadas) e manda ao n8n só o necessário: código do pedido, primeiro nome, telefone e link pessoal. Só vai quem passou por todas as travas da seção 8.3.
2. O n8n procura o contato no Chatwoot (`GET /api/v1/accounts/{conta}/contacts/search?q=<telefone>`), cria se não existir, abre ou reaproveita a conversa na caixa do WhatsApp (`POST /api/v1/accounts/{conta}/conversations`) e manda a mensagem (`POST /api/v1/accounts/{conta}/conversations/{id}/messages`).
3. O n8n devolve à Zuri o evento `message_out` com o código do pedido, pelo endereço de eventos do CRM que já existe (assinado com HMAC). Só aí a Zuri marca "Enviado". Sem esse retorno, o pedido fica como "não confirmado" e não sai de novo sozinho.

O que precisa:

| Item | Onde fica |
| --- | --- |
| Token de acesso do Chatwoot, id da conta e da caixa do WhatsApp | Só no n8n, nunca na Zuri |
| Endereço do webhook do n8n e o segredo dele | Conexão de fluxo da Zuri (já cifrada) |
| Modelo de mensagem aprovado pela Meta, se a caixa usar a API oficial do WhatsApp | Meta / Chatwoot |
| Saída "Não quero receber" na mensagem, que o n8n devolve como evento | n8n → CRM da Zuri |

Pontos de atenção:

- ⚠️ Custo: na API oficial do WhatsApp, mensagem fora da janela de 24 horas só sai como modelo aprovado, e a Meta cobra por mensagem conforme a categoria que ela mesma dá ao modelo. Se a caixa usar uma API não oficial, não há modelo, mas envio repetido para muitos números pode levar ao bloqueio do número. Nos dois casos: teto diário (sugestão: 20), só das 09:00 às 18:00 e espaçado.
- Regra do projeto: hoje "a Zuri nunca envia nada a contatos" (decisão de 02/11). Com este desenho, a Zuri decide e o n8n envia, mas a regra precisa ser revista por você antes.
- Uma chave para desligar tudo na hora, e parada automática na primeira falha seguida de outra.

Etapas: (1) o envio com um toque deste plano; (2) o fluxo do n8n em teste, mandando só para você; (3) o modelo de mensagem aprovado; (4) um contato real por dia, com você olhando; (5) automático com teto. A integração direta Zuri → Chatwoot (token na Zuri) não é recomendada: põe uma credencial de envio no Worker e abre uma saída nova para a internet.

## 10. Notas: Nova nota e salvamento automático

É possível. "Nova nota" cria a nota e põe o cursor no título. O texto se salva sozinho cerca de 1 segundo depois que você para de digitar. Ao trocar de nota ou fechar a aba, salva na hora. O status mostra "Salvando…" e depois "Salva às HH:MM". Se a mesma nota mudou em outro aparelho, aparece "Esta nota mudou em outro aparelho", com "Ver a versão nova" e "Manter a minha". Essa conferência de versão já existe no código. Uma nota nova vazia não é guardada.

## 11. Memória por voz

É possível com o mesmo microfone da conversa (transcrição pelo Workers AI, no plano grátis, contando no limite de áudio do dia). Você fala, a Zuri transcreve e o texto aparece no campo para você conferir antes de "Guardar". O áudio não é guardado. O tempo máximo é o mesmo da gravação na conversa.

## 12. Criar automação

Assistente em 5 passos, com os campos que o código já aceita: Tipo, Quando (frequência, dias, horário e as próximas execuções), O que (texto do lembrete, recado do resumo ou instrução da rotina, com modelos e ferramentas externas), Avisos (prioridade; os canais ficam em Configurações › Avisos) e Revisar (nome, resumo e custo). "Fluxo" leva para o editor de fluxos. Rotina sugerida pela Zuri na conversa chega esperando a sua aprovação na tela de Automações.

## 13. Perfil e avisos

O nome no rodapé da lateral (no celular, a letra no topo) abre um painel com Conta e perfil, Agenda, Segurança, Avisos, tema e Sair. O sino abre os avisos com "Marcar tudo como lido" e "Escolher o que avisar". No celular, os dois viram uma folha que sobe de baixo, fecha com Esc, com o X ou tocando fora, e devolve o foco a quem abriu.

## Decisões que ficam com o Pablo

1. Endereço e foto no contato (muda a decisão anterior).
2. Guardar a impressão digital do nome inteiro de quem avaliou, para ligar avaliação a contato.
3. Quando for a hora do Chatwoot: rever a regra de 02/11 e o custo da Meta (⚠️).
