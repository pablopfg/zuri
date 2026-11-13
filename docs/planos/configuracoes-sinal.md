# Plano · Configurações do Sinal (S16)

Situação: implementado (PR da S16). Linha S16 de [implementacao-frontend-sinal.md](implementacao-frontend-sinal.md) (P21 e C2), com o protótipo aprovado (`docs/planos/modelos-frontend/prototipo-interativo.html`, `#configuracoes`).

## 1. Resumo

Configurações passa a ter o menu do protótipo: onze seções em cinco grupos (Você, A Zuri, Seu dia, Conexões, Sistema). Duas seções são novas, Assistente e Sobre a Zuri. Alguns cartões mudam de lugar, o Uso da IA ganha as visões Dia e Ano (rotas da S13) e "Relatar no GitHub" mostra uma prévia antes de abrir o GitHub. Nenhum cartão de hoje some.

## 2. Contexto no sistema

- Tela: `apps/web/src/pages/SettingsPage.tsx` e `pages/settings/*`; cartões de segurança em `components/security/*`.
- Rotas de consumo da S13: `GET /api/usage/hours` (horas em UTC) e `GET /api/usage/months` (12 meses, sem divisão por modelo).
- Versão: `APP_VERSION` em `packages/shared/src/version.ts`, gravada pelo workflow `Versão`; o `CHANGELOG.md` tem a seção de cada versão.
- Relatar no GitHub: `apps/web/src/lib/issue-report.ts` e o modelo `.github/ISSUE_TEMPLATE/erro.yml`.
- Decisões que valem: "O design segue o protótipo", "texto não cita infraestrutura", sem acesso por token (o cartão "Acesso pela API" do protótipo não existe no app).

## 3. Critérios de aceite

| Nº | Critério |
| --- | --- |
| CA1 | O menu tem as onze seções nos cinco grupos, na ordem do protótipo; no celular, uma lista "Seção" com os grupos troca de seção |
| CA2 | Todo endereço de hoje abre a seção certa (`conta`, `seguranca`, `ia`, `modelos`, `agenda`, `avisos`, `integracoes`, `dados`, `diagnostico`) e `/acessos` continua abrindo; nome desconhecido volta para Configurações |
| CA3 | Assistente tem "A Zuri de olho", "Prioridades que a Zuri aprendeu" e "Memória" com "Revisão de conflitos" (C2), que sai da tela de Memória |
| CA4 | Senha fica no alto de Segurança; Telegram fica em Integrações, depois do Google; Avisos diz onde conectar o Telegram |
| CA5 | A atividade de acesso mostra o IP em linha própria |
| CA6 | Sobre a Zuri mostra a versão da tela, confere a do servidor (`GET /api/version`) e diz "Tudo na mesma versão" ou pede para recarregar; lista as novidades da versão (tiradas do `CHANGELOG.md` no build) e leva às versões e ao código |
| CA7 | A linha "Versão" do menu do perfil e a do Diagnóstico levam a Sobre a Zuri |
| CA8 | "Relatar no GitHub" abre uma prévia com cada campo de texto como vai chegar, inclusive Passos e Esperado; "Onde aconteceu" e "Impacto" são listas que o GitHub não preenche pelo link, e a prévia pede para escolher lá; nada do que o dono escreveu vai no link |
| CA9 | Uso da IA: Dia (por hora, no fuso do dono, dizendo a hora em que a contagem recomeça), Semana, Mês e Ano (por mês); no Ano, a tabela de modelos é a dos últimos 90 dias e diz isso |
| CA10 | `GET /api/version` exige sessão e CSRF, devolve só `{ version }`, sem cache, e só aceita GET |
| CA11 | axe sem violações, teclado, leitor de tela, claro e escuro, 390 e 1440 px; JS inicial dentro do teto |

## 4. Escopo

Dentro: os itens acima, testes, `docs/`, README e changelog.

Fora, com o motivo:

- Cartão "Conversas" (conversa nova todo dia): depende do servidor da S05b, então não aparece até lá.
- "Acesso pela API" e "Instalada em": não existem no servidor (o acesso por token saiu por decisão do Pablo; a data de instalação não é guardada).
- "Agendas da conta" em Configurações › Agenda: continua só em Integrações › Google, sem repetir o mesmo controle em dois lugares.
- Catálogo de modelos conferido sozinho (P24): S21.

## 5. Desenho técnico

- `SettingsPage.tsx`: lista única de seções com grupo; `/configuracoes` abre Conta nos dois tamanhos; no celular, `<select>` com `<optgroup>` no lugar da lista de seções.
- Diferenças para o protótipo: seção "Diferenças da S16" de [implementacao-frontend-sinal.md](implementacao-frontend-sinal.md).
- Seções novas: `assistente` (`AssistantTab.tsx`) e `sobre` (`AboutTab.tsx`).
- Novidades: `vite.config.ts` lê a seção mais nova do `CHANGELOG.md` no build (`apps/web/src/lib/release-notes.ts`, com teste) e a entrega como texto puro pela constante `__RELEASE_NOTES__`, que só Sobre a Zuri usa.
- Servidor: `GET /api/version` em `apps/agent/src/api/app.ts`, schema `versionSchema` em `packages/shared`. Sem banco, sem IA, sem subrequisição.
- Uso da IA: `UsageCharts.tsx` ganha o seletor Dia, Semana, Mês e Ano; Dia lê `/usage/hours`, Ano lê `/usage/months` e, para a tabela de modelos, `/usage/history?days=90`.

## 6. Segurança e custo

- A rota nova é de leitura, atrás dos mesmos portões das outras (sessão, CSRF, origem), e não devolve nada além do número da versão.
- O link do GitHub continua só com dados do registro de falhas; a prévia mostra o texto exato.
- Nenhum recurso novo da Cloudflare, nenhuma migration.

## 7. Testes

- Unitários: novidades do changelog, passos e esperado do relato, horas e meses no fuso do dono.
- Rota: `GET /api/version` (200 com sessão, 401 sem, 403 sem CSRF, 404 para outros verbos, `no-store`).
- e2e: grupos e seções, endereços antigos, seleção no celular, Assistente com a revisão de conflitos, Sobre a Zuri, prévia do relato, Dia e Ano do consumo, axe.
