<!-- versao: minor -->
### Corrigido

- A lixeira aberta de Tarefas ou de Notas conta e lista só aquele tipo, direto do servidor. Antes, uma lixeira cheia de notas podia mostrar "nenhuma tarefa".
- Diagnóstico nomeia as telas Agenda e Contatos, que apareciam como "outra".
- A busca de clientes com um texto longo voltava erro. Agora encontra normalmente.
- Uma rotina com a repetição ilegível é pausada e aparece na atividade, em vez de travar o alarme das outras.

### Segurança

- Ler a agenda, os contatos ou um texto encaminhado do Telegram agora também faz as ferramentas externas perguntarem antes de rodar, como já acontecia com o MCP e os clientes.
- Uma resposta da Zuri escrita com um item "Nunca enviar para fora" à vista não volta mais no histórico nem no resumo que vão para um modelo de outra empresa.
- A trava de contato das respostas a avaliações também pega domínios de final pouco comum e domínios escritos por extenso.
- Depois de redefinir a senha pelo painel da Cloudflare, os tokens de acesso remoto param na hora, sem esperar o próximo login.

### Atualização

- Migration 31: a coluna `local_only` em `zur_messages`. Ela é aplicada sozinha na primeira requisição, sem nada a fazer.
