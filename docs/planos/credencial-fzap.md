# Plano · Credencial da fzap (E6b)

Situação: aprovado (protótipo v52–v56, Pablo, 13/11/2026 12:49 UTC; ajustes de 13/11 00:37 UTC, item 2 e "Segurança das integrações"). Sem perguntas novas.

## 1. Resumo

CRM › Credenciais ganha um terceiro tipo, **fzap (Pix pelo WhatsApp)**, ao lado de Chatwoot e "Outro serviço (https)". A credencial guarda o endereço https da instância e o token dela, no mesmo cofre da S17 (AES-256-GCM, chave própria do tipo). **Testar** lê só o estado da sessão (`GET /session/status`) e diz se a instância está conectada e em qual modo: o Pix só funciona no modo WhatsApp Web. O envio do Pix em si é da E8 ("Enviar Pix"); esta entrega só guarda e testa a credencial.

## 2. Contexto no sistema

- Cofre e tipos: `apps/agent/src/flows/connections.ts` (`CONNECTION_KINDS`, `create`, `update`, `fixed`, `send`), `apps/agent/src/flows/service.ts` (`testConnection`, 5 testes por minuto), rotas em `apps/agent/src/api/flows.ts` (criar e editar pedem a senha recente e geram aviso de segurança).
- Tipos e schemas: `packages/shared/src/flows.ts` (`FLOW_CONNECTION_KINDS`, `FlowConnection`, `FlowConnectionTest`) e `packages/shared/src/flows-schemas.ts` (`chatwootConnectionCreateSchema`, `connectionOriginSchema`).
- Tela: `apps/web/src/pages/automations/flows/CredentialDialog.tsx` (escolha do tipo), `ChatwootDialog.tsx` (modelo), `FlowsPanel.tsx` (lista).
- API da fzap: o token vai no cabeçalho `token` (não `Authorization`); a resposta vem em `{ code, success, data }`; `GET /session/status` devolve `connected`, `loggedIn` e, no modo Cloud API, o bloco `cloudapi`.
- Protótipo: `fzDlg()` e a linha da lista ("Instância conectada · modo WhatsApp Web · Pix disponível · só envia Pix, nada mais").

## 3. Objetivo e critérios de aceite

| Nº | Critério | Origem |
| --- | --- | --- |
| CA1 | "Nova credencial" oferece **fzap (Pix pelo WhatsApp)**, com nome, endereço da instância e token da instância (só escrita, "Em branco, fica o atual" ao editar) | protótipo `fzDlg` |
| CA2 | O endereço é https, só o domínio (sem caminho, IP ou rede interna); o token é obrigatório ao criar e quando o endereço muda | protótipo, segurança das integrações |
| CA3 | Criar e editar pedem a senha recente e ficam em Atividade de acesso; remover segue as outras credenciais (sem senha, sem segredo exposto) | segurança das integrações |
| CA4 | **Testar** chama só `GET /session/status` com o cabeçalho `token` e mostra: conectada no modo WhatsApp Web ("o Pix funciona"), conectada no modo Cloud API ("a fzap não envia Pix por ele"), não conectada ao WhatsApp, ou o problema da chamada | protótipo |
| CA5 | A lista mostra a etiqueta "fzap", o endereço e "só envia Pix e lê o estado da sessão"; o token aparece só pelo final | protótipo |
| CA6 | Um fluxo não usa a credencial da fzap (só o cliente fixo dela chama) | segurança das integrações |
| CA7 | pt-BR e en, teclado, leitor de tela, celular, tema escuro, axe, 44 px | regras da interface |

## 4. Escopo

**Entra:** o tipo `fzap` no cofre, o diálogo, o teste e a linha da lista.

**Fica fora:** "Enviar Pix" e a chave Pix (E8), que leem esta credencial.

## 5. Como funciona para o Pablo

1. Em CRM › Credenciais, toca em **Nova credencial** › **fzap (Pix pelo WhatsApp)**.
2. Escreve "fzap do consultório", `https://fzap.exemplo.com.br` e cola o token da instância. **Salvar credencial** pede a senha se ela não foi digitada há pouco.
3. Na lista, toca em **Testar**: "Conectada. Modo WhatsApp Web: o Pix funciona."

## 6. Regras de negócio e limites

- Nome: o mesmo limite das outras credenciais (`FLOW_LIMITS.name`); token até `FLOW_LIMITS.credential`; teto de credenciais `FLOW_LIMITS.connections`, somando todos os tipos.
- Endereço: `connectionOriginSchema` (https, sem caminho, sem usuário) e a mesma checagem de DNS público de toda chamada.
- Teste: 5 por minuto por credencial (o mesmo das outras); 1 chamada e 2 consultas de DNS; resposta de até 256 KB lida só nos três campos.

## 7. Desenho técnico

- `FLOW_CONNECTION_KINDS` ganha `fzap`; `CONNECTION_KINDS.fzap = { info: "fzap-v1" }`, então a chave do cofre é outra.
- `fzapConnectionCreateSchema` e `fzapConnectionUpdateSchema` em `flows-schemas.ts`; `fzapStatusSchema` lê a resposta.
- `connections.create`/`update` gravam `auth = 'header'`, `header_name = 'token'`; mudar o endereço sem token novo é recusado (`error.flowConnectionKeyAgain`).
- `apps/agent/src/flows/fzap.ts`: `fzapStatus()` com `connections.fixed(row, "fzap", { method: "GET", path: "/session/status" })`.
- `FlowConnectionTest` (ok) ganha `fzap: { connected, loggedIn, cloud } | null`.
- Tela: `FzapDialog.tsx` (sob demanda junto das outras credenciais), opção nova em `CredentialDialog.tsx`, etiqueta e linha em `FlowsPanel.tsx`.

## 8. Custo e cotas do plano Free

- Banco: criar ou editar grava uma linha de `zur_flow_connections` e a Atividade, como as outras credenciais. Medido em `free-tier-budget.test.ts`.
- Rede: o teste faz 1 chamada à instância e 2 consultas de DNS, só com o toque do dono.
- JS inicial: nada (CRM é tela sob demanda). Medir com o build.

## 9. Segurança e privacidade

| Ameaça | Defesa | Teste |
| --- | --- | --- |
| Token lido pela tela, backup ou IA | cofre com chave do tipo, só o final na tela; backup e exportação sem credenciais; nenhuma ferramenta do agente | rota e lista |
| Token de um tipo aberto como outro | `info` próprio (`fzap-v1`) | unitário do cofre |
| Token mandado a outro servidor (SSRF) | https, DNS público, sem redirecionamento; endereço novo pede o token de novo | rota |
| Sessão roubada trocando a credencial | senha recente e aviso de segurança | rota |
| Resposta hostil da instância | só `connected`, `loggedIn` e a presença de `cloudapi` são lidos, com Zod | integração |
| Fluxo usando o token | `call()` recusa todo tipo que não é `http` | integração |

## 10. Testes

- `apps/agent/test/fzap-credential.test.ts`: criar, editar (endereço sem token recusado), senha recente, teste nos três estados, resposta fora do formato, redirecionamento, 401 da instância, fluxo recusado, a chave do cofre de outro tipo não abre.
- `packages/shared/test`: schemas da fzap.
- e2e `tests/e2e/credencial-fzap.spec.ts`: criar pela tela com a senha, testar, editar com o endereço novo pedindo o token, celular, inglês, axe.

## 11. Entrega

Uma PR para a `develop`, com changelog, `docs/` da área das credenciais e capturas do diálogo e da lista.

## 12. Riscos

- Instâncias da fzap com outro formato de resposta: o teste diz "resposta fora do formato", e nada mais quebra.

## 13. Suposições

1. O teste não confere se a conta é Business: o Pix só depende do modo WhatsApp Web.

## 14. Entrevista com o Pablo

Sem perguntas: o protótipo aprovado define o comportamento.
