# Inventário da 26c: o que reorganizar

Feito em 09/11/2026 a partir das capturas de todas as telas (computador e
celular, base vazia) e conferido no código de `apps/web/src`. P, M e G dão o
esforço. "Pequena" quer dizer que a 26c faz direto. "Pergunta" quer dizer
mudança grande de navegação, que vai ao Pablo com uma recomendação.

| # | Tela | O que se vê | Mudança | Esforço | Tipo |
| --- | --- | --- | --- | --- | --- |
| 1 | Automações, Memória, Integrações, Fluxos | Linhas com quatro a seis ações soltas, que quebram em várias linhas no celular | Fora do menu fica só a ação principal; o resto vai para o menu "⋯ Mais opções", com apagar ou remover por último, separado e em vermelho | M | Pequena |
| 2 | Segurança | Um cartão "Em breve nesta aba" | Tirar o cartão | P | Pequena |
| 3 | Notas | Sem a linha de contexto; ações só com ícone; dois botões principais quando a lista está vazia | Linha de contexto, "Nova nota" com texto, lixeira igual à de Tarefas | P | Pequena |
| 4 | Tarefas, lixeira, conversas, Diagnóstico, Automações, IA | Estados vazios sem ícone ou sem a frase; "nenhuma falha" repetido | Título curto mais uma frase; no Diagnóstico, um cartão só | P | Pequena |
| 5 | Configurações > IA | Cerca de 3.600 px no computador e mais de 14.000 px no celular | Dividir em "Uso da IA" e "Modelos e limites"; os nove limites recolhidos | M | Pergunta |
| 6 | Configurações > Avisos | O resumo dos canais fica no fim e repete os cartões do meio | Canais primeiro, depois o que vai para cada canal, depois resumo, Zuri de olho e prioridades; últimos envios no fim | M | Pequena |
| 7 | Configurações no celular | Quatro níveis de título antes do conteúdo | Dentro de uma aba, o título é o da aba, com "‹ Configurações" acima | P | Pequena |
| 8 | Conversa | Dois "Nova conversa" no computador; o histórico numa linha só para ele no celular | Um só "Nova conversa"; o histórico vai para as ações do cabeçalho | P | Pequena |
| 9 | Memória | O formulário de guardar ocupa o topo, antes da lista | "Nova memória" no cabeçalho, abrindo um diálogo | M | Pergunta |
| 10 | Tarefas, Notas, Dados | Três portas para a lixeira; as duas primeiras tiram o dono do contexto | A lixeira abre filtrada pelo tipo de onde veio | M | Pergunta |
| 11 | Conta | "Sair deste aparelho" repete o menu da conta; o nome salva por botão e o resto sozinho | Tirar o cartão de sair; "Salvar nome" ao lado do campo também no celular | P | Pequena |
| 12 | Dados no celular | Nove cartões de uso empilhados | Duas colunas também no celular | P | Pequena |
| 13 | Tarefas no celular | Ações numa linha própria; abas no limite da largura | Abas com rolagem horizontal; busca e filtro na mesma linha | M | Pequena |
| 14 | Início | "Próximos dias" tem subtítulo e "Hoje" não | Subtítulo nos dois | P | Pequena |

## Confirmações no lugar: ligar a pergunta aos botões

O leitor de tela diz só "Cancelar, botão", sem a pergunta. O grupo de botões
ganha `role="group"` com `aria-labelledby` na pergunta:

- `components/security/PasskeysCard.tsx`: remover passkey.
- `components/security/RemoteAccessCard.tsx`: revogar um token e revogar todos.
- `pages/agenda/AgendaPage.tsx`: apagar evento.
- `pages/contacts/crm/ClientsPanel.tsx`: apagar cliente.
- `pages/settings/AiTab.tsx`: refazer o índice da busca.
- `pages/memory/MemoryPage.tsx`: conflito de memória (o "Cancelar" também
  ganha o foco).
