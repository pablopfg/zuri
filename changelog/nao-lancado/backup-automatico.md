<!-- versao: minor -->
### Adicionado

- ⚠️ **Backup automático** em Configurações › Dados, com o espaço de backups
  do R2 (opcional, dentro da faixa grátis, aprovado pelo dono). Sai uma cópia
  por dia, depois das 3 h no seu fuso, e ficam as 7 mais novas. As antigas só
  são apagadas depois que a nova chegou inteira; se o envio falhar, nada é
  apagado e a Zuri tenta de novo em uma hora.
- **Criar chave do backup**: o navegador cria a chave e baixa o arquivo
  `zuri-chave-do-backup.json` uma única vez. A Zuri guarda só a parte que
  fecha as cópias; sem o arquivo, nenhuma cópia abre.
- Lista das cópias com **Baixar** e **Restaurar uma cópia**, que abre o
  arquivo no navegador, mostra o que ele tem e importa em partes quando passa
  de 10 MB.
- A primeira cópia de cada mês vai como documento para o seu chat com o bot
  (acima de 40 MB, só o aviso; se falhar, tenta de novo no dia seguinte). O bot avisa quando o último backup que você
  baixou passa de 30 dias.

### Alterado

- `/backup` no bot diz a idade do último backup baixado e a data da última
  cópia automática, ou por que o backup automático está desligado.

### Segurança

- A cópia é compactada e cifrada com a sua chave pública (ECDH P-256, HKDF e
  AES-256-GCM em pedaços): trocar, cortar ou acrescentar bytes impede a
  abertura. O nome no R2 não diz nada sobre você.
- Criar ou trocar a chave e baixar uma cópia pedem a senha digitada nos
  últimos 15 minutos; a chave nova gera alerta de segurança. Nada vai ao
  Telegram no modo de bloqueio, e só para a conta do `TELEGRAM_ADMIN_ID`.
- Quem trocar a chave com uma sessão roubada não apaga as suas cópias numa
  semana: a cópia mais nova de cada chave anterior fica 30 dias.

### Atualização

- ⚠️ Opcional: para ligar o backup automático, crie um bucket privado no R2
  (dentro da faixa grátis, mas ligar o R2 pede cartão) e ponha o nome dele na
  segredo `ZURI_BACKUP_BUCKET` do ambiente `production`; o deploy cria o
  binding `BACKUP_BUCKET`. Passo a passo em
  `docs/configuracao-cloudflare.md` › Backup automático. Nenhuma migration.
