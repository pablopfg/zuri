---
paths:
  - "apps/web/**"
  - "packages/shared/i18n/**"
  - "apps/agent/src/**"
---

# Textos e controles da interface

Decisão do Pablo (02/11/2026): textos padronizados e sem cara de IA, no padrão
dos grandes apps de chat. A revisão completa é a etapa 26; até lá, **todo texto
novo ou mexido** já segue isto. Detalhes, glossário completo e exemplos:
`docs/planos/revisao-de-textos-e-experiencia.md`.

- Fechar é um X no canto superior direito (44 px, nome acessível "Fechar"),
  nunca um botão "Fechar" em texto no pé. Esc fecha.
- Botão = verbo no infinitivo, até 3 palavras ("Apagar tarefa"). Sem
  "Sim/Não" nem "OK" em confirmação: o botão repete o verbo do título.
- Toast de sucesso no particípio, curto, sem "com sucesso" e sem "!"
  ("Tarefa criada").
- Erro diz o que houve e o que fazer ("Não deu para salvar. Tente de novo.").
  Nada de "Ops", "Erro!" ou código cru na frente.
- Glossário: Apagar (não Excluir), Remover só para ligações sem perda de dado,
  Conectar/Desconectar para contas (Telegram, Google; nunca Desvincular),
  Salvar, Editar, Cancelar, Tentar de novo, Ligar/Desligar, Aprovar/Recusar,
  Aviso, Automação (e "Rotina da Zuri" para a com IA), Conversa, Entrar/Sair
  ("a entrada", nunca "login").
- O lint de microcopy (`scripts/lint-microcopy.ts`, dentro de
  `npm run lint`) barra o que dá para barrar; exceção só em `i18n-ignore.json`
  › `microcopy`, por chave e regra, com o motivo. `node
  scripts/inventario-de-textos.ts` lista todas as chaves com o tipo.
- Sem marcas de IA: sem travessão (—), sem "!" em texto de sistema (só no
  cumprimento da Zuri), sem "não é só X, é Y", trios forçados, "com
  certeza", "perfeito", emoji. Passe o `humanizer:humanizer` antes do commit.
- Sem citar infraestrutura nas telas de uso (Worker, Turnstile, cron,
  SQLite). Pode citar a Cloudflare só em instrução de configuração em que o
  dono age no painel dela; Neurons só na aba IA.
- A Zuri é "a Zuri", no feminino; texto de sistema não fala como ela.
- Todo texto sai do catálogo em pt-BR e en (`.claude/rules/i18n.md`).
