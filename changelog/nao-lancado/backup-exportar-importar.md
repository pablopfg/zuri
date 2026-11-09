### Adicionado

- **Baixar backup** em Configurações › Dados: um arquivo JSON com tarefas,
  notas, projetos, memórias (com o "Nunca enviar para fora"), conversas,
  automações, clientes do CRM e as configurações que não mexem com custo nem
  sessão. O arquivo traz a versão do formato e a da base, e dá para ler sem
  nada da Cloudflare. Senhas, 2FA, passkeys, sessões, tokens, vínculo do
  Telegram, conexões com outros serviços, contatos e avaliações do Google
  ficam de fora.
- **Importar backup**, com arquivos de até 10 MB. Os itens entram como novos,
  ao lado dos que já existem; automações chegam pausadas e rotinas com IA
  esperam a sua aprovação.
- Cartão **Uso do armazenamento**: quanto de cada tipo você já guardou contra
  o limite, e o espaço total contra os 900 MB.

### Segurança

- Baixar e importar pedem a senha digitada nos últimos 15 minutos, não
  funcionam no modo de bloqueio nem com token de acesso remoto e geram alerta
  de segurança em todos os canais.
- A importação confere o arquivo inteiro antes de gravar: um campo que o
  formato não conhece (um servidor MCP, uma automação ligada, um modelo de IA),
  um limite passado ou um texto com caractere de controle recusa tudo, sem
  gravar nada.
- Antes de montar o arquivo na memória, a importação conta objetos, listas e
  profundidade, e só lê os 10 MB de quem traz a sessão e o cabeçalho contra
  CSRF. Um arquivo feito para inchar a memória é recusado sem ser montado.
