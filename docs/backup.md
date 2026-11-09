# Backup

Como tirar os seus dados da Zuri e trazer de volta. A etapa 23 chega em duas
partes: esta (exportar, importar e uso do armazenamento) e o backup automático
diário, cifrado, que vem na próxima PR. O plano completo está em
[planos/etapa-23-backup.md](planos/etapa-23-backup.md).

## Para o dono

Em **Configurações › Dados**:

- **Uso do armazenamento** mostra, para cada tipo (tarefas, notas, projetos,
  memórias, conversas, mensagens, automações e clientes), quanto você já
  guardou e o limite. A barra muda de cor a partir de 80%. O espaço total
  conta contra o teto de 900 MB do banco.
- **Baixar backup** gera `zuri-backup-AAAA-MM-DD.json`. Pede a senha digitada
  nos últimos 15 minutos e manda um alerta de segurança para todos os canais,
  para você saber se alguém baixou os seus dados com uma sessão roubada.
- **Importar backup** lê um arquivo `.json` de até 10 MB, mostra o que vai
  acontecer e só grava depois do **Importar**. Também pede a senha e manda um
  alerta.

O arquivo não é cifrado: guarde num lugar seguro. A cópia cifrada é a do backup
automático.

## O que o arquivo leva

| Seção | O que vai | Observação |
| --- | --- | --- |
| `settings` | idioma, fuso, revisão de conflitos da memória, como você quer ser chamado, resumo do dia e hora, vigias, canais e limites dos avisos, prioridade que aprende | modelo de IA, limites de IA, teto em US$, limites da sessão e "Texto completo" do Telegram ficam de fora |
| `projects`, `tasks`, `notes` | tudo, com `localOnly` das notas | itens da lixeira não vão |
| `memories` | texto, categoria, estado, substituição, datas citadas, autor e `localOnly` | |
| `conversations` | título e mensagens (papel, texto, estado e a marca do modelo reserva) | sem o resumo interno, as ferramentas e os trechos citados do Telegram; caracteres de controle saem do texto e uma mensagem acima de 64.000 caracteres é cortada |
| `automations` | nome, tipo, instrução, horário, vigia e prioridade, sempre com `paused: true` | sem histórico de execuções |
| `alertLearning` | o que a prioridade dos avisos aprendeu | |
| `crm` | etapas do funil, clientes com etiquetas e histórico, e os interruptores dos avisos | nunca a chave dos eventos do n8n |

Nunca vão: senha, segredo do 2FA, códigos de recuperação, passkeys, sessões,
aparelhos, tokens de acesso remoto, vínculo e estado do Telegram, servidores MCP
e suas credenciais, conexão Google e credenciais dos fluxos, fluxos e conexões,
contatos e avaliações do Google, fila de eventos do CRM, avisos, uso da IA,
atividade, diagnóstico, chaves dos modelos pagos nem os valores internos que o
servidor guarda para si. A lista do que vai é fechada no código
(`apps/agent/src/backup/export.ts`): uma coluna nova nunca sai por descuido.

## Formato

```json
{
  "format": "zuri-backup",
  "version": 1,
  "schema": 29,
  "exportedAt": "2026-11-09T03:00:00.000Z",
  "data": { "settings": {}, "projects": [], "tasks": [], "notes": [], "memories": [], "conversations": [], "automations": [], "alertLearning": [], "crm": null }
}
```

`version` é a versão do formato (a importação aceita a 1 para sempre e recusa
uma mais nova com aviso). `schema` é o número da última migration do banco que
escreveu o arquivo, para quem for ler fora da Zuri. O esquema completo, com
os limites de cada campo, está em `packages/shared/src/backup.ts`.

O arquivo é JSON puro: abre em qualquer editor e em qualquer linguagem. Para
migrar para uma VPS (`planos/migracao-vps.md`), basta importar o arquivo na
Zuri nova.

## As travas da importação

Um arquivo de backup é entrada não confiável (regra 8 de
[seguranca.md](seguranca.md)):

- Até 10 MB, conferido no Worker antes de chegar ao banco. O Worker só lê
  esse tamanho de quem traz o cookie da sessão e o cabeçalho contra CSRF; os
  outros pedidos ficam no teto comum.
- Antes de montar o JSON, uma passada conta objetos, listas e profundidade:
  um arquivo feito para inchar na memória (milhões de `{}`) é recusado sem
  ser montado.
- O arquivo inteiro passa pelo esquema estrito antes de qualquer gravação.
  Campo desconhecido (um servidor MCP, `enabled`, `aiModel`), automação com
  `paused: false`, texto com caractere de controle, data inválida, versão nova
  ou formato errado recusam tudo, sem gravar nada. O erro cita até 20 campos e
  nunca os valores.
- Limites por tipo: 10.000 memórias, 20.000 tarefas, 5.000 notas, 1.000
  projetos, 5.000 conversas, 200.000 mensagens, 500 automações e 5.000
  clientes. Somando o que já existe com o que chega, passou de um limite ou do
  teto do banco, nada fica gravado (507 `STORAGE_LIMIT_REACHED`).
- Dois registros com o mesmo id na mesma seção recusam o arquivo.
- Tudo entra com id novo, ao lado do que já existe. Importar o mesmo arquivo
  duas vezes duplica os itens; um cliente do CRM com o mesmo `ref` do n8n é o
  mesmo cliente e não se repete.
- Nada liga sozinho: automações chegam pausadas, rotinas com IA esperam a sua
  aprovação em Automações (com a senha, se alguma ferramenta MCP roda em
  rotinas), memórias chegam marcadas como importadas e mensagens como
  `import`, sem ferramentas nem propostas.
- Ligações para itens que não estão no arquivo (projeto, memória substituta)
  e substituições em ciclo são descartadas.
- Etapas do funil casam pelo nome com as suas; um nome novo vira etapa enquanto
  houver lugar (até 12), senão o cliente vai para a primeira.

## Custo no plano gratuito

Exportar lê uma linha por registro, em páginas de 500, sem montar o arquivo
inteiro na memória. Importar grava uma linha por registro, mais índices e
contadores: um arquivo enorme pode gastar boa parte das 100.000 escritas do
dia, uma vez. `GET /api/storage` lê só os contadores (uma linha por tipo).
Nada disso usa IA, R2 nem serviço de fora.
