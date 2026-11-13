---
paths:
  - "apps/web/**"
  - "apps/agent/src/**"
  - "packages/shared/**"
  - "docs/planos/modelos-frontend/**"
---

# Um ajuste, um lugar

Regra do Pablo (13/11/2026): o sistema não pode ter duas telas que mudam a
mesma coisa. Já aconteceu com "Dias de trabalho" (Configurações › Agenda) e
"Horário de atendimento" (Configurações › Consultório).

- Cada ajuste tem **uma** tela onde é editado e **um** registro no servidor.
  Exemplos: horário de atendimento em Configurações › Agenda; dados do
  consultório em Configurações › Consultório; agendas da conta em Integrações ›
  Google.
- Outra tela que precisa do valor só **mostra** (resumo de uma linha) e leva até
  o lugar dele com "Mudar". Ela não ganha um campo próprio.
- Antes de criar um campo de configuração, busque no código e no protótipo um
  nome parecido (`rg -i "horário|dias|endereço|nome do consultório"` etc.). Se
  achar, reaproveite o mesmo dado.
- Dois valores parecidos com sentidos diferentes (por exemplo, o horário que a
  agenda **mostra** e o horário em que o consultório **atende**) viram um só
  quando um deriva do outro. Se forem mesmo diferentes, os nomes dizem a
  diferença e cada um explica para que serve.
- O plano da tela (`docs/planos/`) lista de onde vem cada dado que ela usa.
