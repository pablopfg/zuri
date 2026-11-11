### Alterado

- A Zuri não recebe mais eventos do n8n. O cartão **Eventos do n8n** e o aviso **Cliente novo vindo do n8n** saíram da tela **CRM**. Os clientes que já tinham chegado por eventos continuam guardados.

### Segurança

- O endereço `POST /api/crm/events/<chave>`, que aceitava eventos assinados sem sessão, e as rotas da chave dos eventos deixaram de existir. Uma chave que estivesse ligada não abre mais nada.
