# Backup

Como tirar os seus dados da Zuri e trazer de volta. A etapa 23 chegou em duas
partes: a 23a (exportar, importar e uso do armazenamento) e a 23b (o backup
automático diário, cifrado). O plano completo está em
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
automático, abaixo.

## Backup automático (23b) ⚠ R2

Precisa do espaço de backups da instalação, o binding `BACKUP_BUCKET` (R2,
dentro da faixa grátis; veja
[configuracao-cloudflare.md](configuracao-cloudflare.md#backup-automático-opcional)).
Sem ele, o cartão **Backup automático** diz que está desligado e nada roda.

1. **Criar chave do backup** (pede a senha dos últimos 15 minutos). O
   navegador gera um par de chaves P-256, manda ao servidor só a parte pública
   e baixa `zuri-chave-do-backup.json` uma única vez. A chave privada nunca
   vai ao servidor nem ao R2. Sem esse arquivo nenhuma cópia abre, nem para
   você: guarde fora da Zuri. Criar ou trocar a chave gera alerta de segurança.
2. Todo dia, a partir das 3 h no seu fuso, sai uma cópia de tudo o que o
   backup manual leva. Ficam as 7 mais novas; as mais antigas só são apagadas
   depois que a nova chegou inteira. Se o envio falhar, nada é apagado, a
   tela mostra a falha e a Zuri tenta de novo em uma hora (até três vezes no
   dia).
3. O cartão lista as cópias (data e tamanho) com **Baixar**. Baixar também
   pede a senha recente.
4. **Restaurar uma cópia** pede a cópia `.zuri` e o arquivo da chave. O
   navegador abre a cópia, mostra o que ela tem e importa com as mesmas
   travas da importação manual. Uma cópia acima de 10 MB vai em partes: tudo
   menos as conversas primeiro, depois as conversas em lotes, cada parte tudo
   ou nada.
5. No dia 1 de cada mês a cópia também vai como documento para o seu chat
   privado com o bot, só se ele estiver ligado ao `TELEGRAM_ADMIN_ID`. Acima
   de 50 MB (o limite do Telegram), vai só o aviso com o botão para a tela. No
   modo de bloqueio nada vai ao Telegram.
6. Quando o último backup que você baixou (o JSON, uma cópia ou a do
   Telegram) passa de 30 dias, o bot avisa, uma vez a cada 30 dias. Se você
   nunca baixou, os 30 dias contam do primeiro acesso. `/backup` no bot diz a
   idade do último backup baixado e a data da última cópia.

### O arquivo `.zuri`

```
ZURI-BACKUP 1
{"key":"<id da chave>","epk":"<chave pública efêmera>","salt":"<16 bytes>"}
<pedaços: 4 bytes de tamanho + texto cifrado>
```

O conteúdo é o mesmo JSON do backup manual, compactado com gzip e cifrado em
pedaços de 1 MiB com AES-256-GCM. A chave de cada arquivo sai de HKDF-SHA256
sobre o segredo ECDH entre uma chave efêmera e a sua. Cada pedaço usa o número
dele como nonce e leva o cabeçalho e a marca de "último pedaço" como dado
associado: um arquivo trocado, cortado ou com bytes a mais não abre. O nome no
R2 é `zuri/AAAA-MM-DD-<8 hex aleatórios>.zuri`, sem nada sobre você.

Tudo usa Web Crypto padrão, então a cópia abre fora da Zuri. Em Node 24+, na pasta do repositório:

```js
// node abrir.mjs zuri-backup-2026-11-09-0a1b2c3d.zuri zuri-chave-do-backup.json > backup.json
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { openBackup, parseBackupKeyFile } from "./packages/shared/src/backup-file.ts";

const [copy, key] = process.argv.slice(2);
const gzip = await openBackup(readFileSync(copy), parseBackupKeyFile(readFileSync(key, "utf8")));
process.stdout.write(gunzipSync(gzip));
```

O código do formato está em `packages/shared/src/backup-file.ts`.

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
Nada disso usa IA.

O backup automático roda no alarme único das automações, num despertar que
tenha lugar para as suas chamadas (senão espera o próximo, um minuto depois).
Por dia: uma leitura do banco igual à do backup manual, um `put` (ou, acima de
8 MiB, um envio em partes de 8 MiB) e uma listagem, todas operações Classe A
do R2; apagar é grátis. São uns 60 por mês contra 1 milhão grátis, e 7 cópias
de até ~100 MB cabem nos 10 GB grátis. Abrir o cartão lista o bucket uma vez;
baixar uma cópia é uma operação Classe B. A memória fica numa parte de 8 MiB
e um pedaço de 1 MiB por vez, longe dos 128 MB.
