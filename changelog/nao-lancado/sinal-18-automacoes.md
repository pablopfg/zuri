<!-- versao: minor -->
### Adicionado

- **CRM › Automações**, a primeira parte do CRM (em `/crm`): as automações do consultório na ordem em que chegam à Zuri, com o que cada uma faz, se escreve a contatos e a base que todas usam. Nenhuma vem ligada.
- **Avisar quando chegar**: um sino em cada automação que ainda não chegou manda um aviso quando ela fica pronta.
- **Ligar** uma automação pede a credencial do tipo certo, testada antes de salvar, e começa sempre em **ensaio**: a Zuri roda tudo, mas não envia nada, só anota o que faria.
- **Acompanhar** mostra cada dia do ensaio e o que a Zuri fez. Você marca **Está certo** ou **Tem erro**, com o motivo. **Ligar de verdade** pede 3 dias úteis seguidos certos (ou assumir o risco) e a senha.
- A automação pausa sozinha depois de duas falhas, com a credencial recusada ou apagada, ou com resposta fora do esperado, e avisa você.

### Alterado

- `/crm` abre Automações; Fluxos fica em `/crm/fluxos`. "Criar fluxo" na paleta leva até lá.
- Uma credencial usada por uma automação ligada não pode ser apagada; desligada, pode.

### Atualização

- Migration 39: quatro tabelas novas para as automações do CRM (configuração, execuções, efeitos e a conferência de cada dia). Começam vazias e nada do que existia muda.
