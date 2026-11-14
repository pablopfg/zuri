# Plano · E-mail para pacientes (E6c)

Situação: aprovado (protótipo v52–v56, Pablo, 13/11/2026 12:49 UTC; ajustes de 13/11 00:37 UTC, item 1 e "Segurança das integrações"; 13/11 08:42, "a integração mostra todos os campos"). Sem perguntas novas.

## 1. Resumo

Configurações › Integrações ganha a seção **E-mail para pacientes**: por onde sai o e-mail aos pacientes, com dois modos e um ativo por vez.

- **Gmail (recomendado):** a permissão `gmail.send` entra na conexão do Google que já existe. A Zuri só envia e não guarda senha.
- **Outro provedor (SMTP):** servidor, porta 465 (TLS direto) ou 587 (STARTTLS obrigatório), usuário, senha de app e e-mail do remetente. A senha fica cifrada.

Os dois modos têm "Nome do remetente" e "Responder para", e um botão **Enviar teste para você**, que manda um e-mail curto ao e-mail do dono. A seção mostra quantos e-mails saíram hoje, com o teto de 100 por dia.

O texto do e-mail de confirmação (assunto, texto e botão, com prévia) e o envio aos pacientes chegam com a E7 (link de confirmação). Esta entrega só configura o canal e prova que ele funciona.

## 2. Contexto no sistema

- **Configurações › Integrações:** `apps/web/src/pages/settings/IntegrationsTab.tsx` (já tem `GoogleCard.tsx`). A seção nova é um download à parte (`lazy`).
- **Google:** `apps/agent/src/google/service.ts` (`GooglePurpose`, `JOINED_SCOPE`, `connect`/`finish`, `granted(scope)`, `accessToken`, `accountEmail()`), rota `apps/agent/src/api/google.ts` (`/google/connect`, `/google/callback`). A permissão de Contatos já entra pelo mesmo caminho (`purpose: "contacts"`).
- **Cofre:** `McpCredentials` (AES-256-GCM, chave derivada por `info` com HKDF, id como dado associado), o mesmo da S17. O SMTP usa `info` próprio (`smtp-v1`).
- **Senha recente e aviso:** `auth.requireRecentAuth` e `auth.events.record(..., { alert: true })`, como em `apps/agent/src/api/flows.ts`.
- **Rede:** `assertPublicHost` (DNS público) dos fluxos; `connect()` de `cloudflare:sockets` para o SMTP (a porta 25 é bloqueada pela Cloudflare; 465 e 587 passam).
- **Protótipo:** `mailSec()` e `smtpSave()` em `docs/planos/modelos-frontend/prototipo-interativo.html`.

## 3. Objetivo e critérios de aceite

| Nº | Critério | Origem |
| --- | --- | --- |
| CA1 | Integrações mostra **E-mail para pacientes**, depois de Contatos: "Como o e-mail sai" com Gmail e Outro provedor (SMTP), um ativo por vez, e "Até 100 por dia; hoje saíram N." | protótipo `mailSec` |
| CA2 | Gmail: sem a permissão, "Conectar o Gmail" leva ao Google pedindo só `gmail.send`; com ela, "Gmail conectado: <conta>" e o texto da permissão. "Desconectar" deixa de usar o Gmail | protótipo, item 1 |
| CA3 | SMTP: servidor (nome, sem IP nem rede interna, até 120), porta 465 ou 587, usuário (e-mail), senha de app (só escrita, "Em branco, fica a atual"), e-mail do remetente (opcional). Mudar o servidor ou o usuário pede a senha de novo | protótipo `smtpSave` |
| CA4 | Nome do remetente (até 60, sem `<`, `>`, aspas nem quebra de linha) e Responder para (e-mail, opcional), com a linha "De: Nome <endereço>" | protótipo |
| CA5 | Salvar pede a senha recente e gera aviso de segurança; fica em Atividade | segurança das integrações |
| CA6 | **Enviar teste para você** manda um e-mail ao e-mail do dono pelo modo salvo e diz o resultado: enviado, servidor recusou o usuário, sem TLS, servidor fora do ar, Gmail sem permissão, teto do dia | protótipo |
| CA7 | SMTP só com TLS: 465 com TLS direto; 587 só segue depois de STARTTLS aceito. Sem STARTTLS, nada de usuário nem senha sai | item 1 |
| CA8 | Teto de 100 e-mails por dia (contando o teste), no fuso do dono | protótipo |
| CA9 | pt-BR e en, teclado, leitor de tela, celular, tema escuro, axe, 44 px | regras da interface |

## 4. Escopo

**Entra:** a seção, o modo Gmail (permissão e envio), o cliente SMTP, o teste, o teto diário e a tabela `zur_mail`.

**Fica fora:** o modelo do e-mail de confirmação e o envio aos pacientes (E7); "Também por e-mail" em Consultório (E7); e-mail de aniversário (módulos do CRM).

## 5. Como funciona para o Pablo

1. Em Configurações › Integrações › E-mail para pacientes, Gmail já vem marcado. Toca em **Conectar o Gmail**; o Google pede só "enviar e-mail em seu nome". Volta com "Gmail conectado: ana@exemplo.com.br".
2. Escreve "Consultório Exemplo" em Nome do remetente e toca em **Salvar o e-mail** (a senha é pedida se não foi digitada há pouco).
3. Toca em **Enviar teste para você**: "E-mail de teste enviado para dono@exemplo.com.br pelo Gmail."

Com SMTP: escolhe Outro provedor, preenche `smtp.exemplo.com.br`, 465, `contato@exemplo.com.br` e a senha de app, salva e testa.

Estados: carregando, erro com "Tentar de novo", salvando (botão ocupado), erro ao salvar (mensagem do servidor, foco no campo), teste enviando e o resultado em um aviso.

## 6. Regras de negócio e limites

- Endereços (`replyTo`, `from`, `user`): até 120 caracteres, parte local até 64, um `@`, domínio com ponto, sem espaço, controle, `<`, `>`, aspas, vírgula ou ponto e vírgula.
- Nome do remetente: até 60, uma linha, sem `<`, `>`, `"` nem controle.
- Servidor: até 120, letras, dígitos, hífen e pontos, com domínio de topo; nunca IP, `localhost` ou nomes internos (`.local`, `.internal`, `.lan`, `.home`, `.corp`); o DNS tem de dar endereço público.
- Senha de app: 1 a 200 caracteres imprimíveis.
- Teto: 100 e-mails por dia no fuso do dono; o teste conta. O teste: até 3 a cada 10 minutos e 10 por dia, guardados no banco (achado SEC-E6c-01: a sessão roubada não gasta o teto dos pacientes).
- SMTP: prazo de 15 s por envio; respostas do servidor lidas até 8 KB; só `AUTH PLAIN` ou `AUTH LOGIN`, dentro do TLS.

## 7. Desenho técnico

- `packages/shared/src/mail.ts`: `MAIL_LIMITS`, `GMAIL_SEND_SCOPE`, `mailAddressSchema`, `smtpHostSchema`, `mailSaveSchema` (modo, nome, responder para, SMTP com senha opcional), `MailStatus`.
- Migration 44 `zur_mail`: uma linha (`id = 1`) com modo, nome, responder para, servidor, porta, usuário, remetente, senha cifrada, final da senha, dia e contagem de envios, `updated_at`.
- `apps/agent/src/mail/message.ts`: monta a mensagem (RFC 5322, cabeçalhos com RFC 2047, corpo em base64 UTF-8); nenhum cabeçalho aceita quebra de linha.
- `apps/agent/src/mail/smtp.ts`: cliente SMTP mínimo com `connect` injetável (testes com um servidor falso em memória).
- `apps/agent/src/mail/gmail.ts`: `POST gmail/v1/users/me/messages/send` com o token do Google.
- `apps/agent/src/mail/service.ts`: `status()`, `save()`, `test()`, `send()` (que a E7 usa), teto diário.
- `GooglePurpose` ganha `gmail` (`JOINED_SCOPE.gmail = GMAIL_SEND_SCOPE`).
- Rotas: `GET /api/mail`, `PUT /api/mail` (senha recente, aviso), `POST /api/mail/test`.
- Tela: `apps/web/src/pages/settings/MailCard.tsx`, sob demanda, textos em `packages/shared/i18n/pt-BR-mail.ts`.

## 8. Custo e cotas do plano Free

- Banco: salvar grava 1 linha de `zur_mail` e a Atividade; o teste lê 1 linha e grava 1 (a contagem). Medido em `free-tier-budget.test.ts`.
- Rede: o teste faz 1 conexão TCP (SMTP) e 2 consultas de DNS, ou 1 chamada ao Gmail; só com o toque do dono. TCP de saída e a API do Gmail não têm custo.
- JS inicial: nada (a seção é um download à parte). Medir com o build.

## 9. Segurança e privacidade

| Ameaça | Defesa | Teste |
| --- | --- | --- |
| Senha do SMTP lida pela tela, backup ou IA | cofre com `info` próprio e servidor e usuário como dado associado; só o final na tela; backup sem `zur_mail.credential`; nenhuma ferramenta do agente | rota, unitário do cofre, backup |
| Senha mandada a outro servidor | mudar servidor ou usuário pede a senha de novo; o dado associado impede abrir a senha com outro servidor | rota |
| SMTP para rede interna (SSRF) | nome sem IP, DNS público antes de conectar, portas 465 e 587 só | unitário |
| Senha em texto claro | 587 só segue com STARTTLS aceito; 465 é TLS desde o começo | unitário com servidor falso |
| Injeção de cabeçalho no e-mail | Zod sem quebra de linha; cabeçalhos codificados; endereços com a mesma regra | unitário |
| Sessão roubada mudando o remetente ou o "Responder para" | senha recente e aviso de segurança | rota |
| Abuso do envio | teto diário e limite do teste; o teste só vai ao e-mail do dono | unitário |
| Resposta hostil do servidor | lida até 8 KB por resposta, só o código; o texto do servidor não volta à tela | unitário |

## 10. Testes

- `packages/shared/test/mail.test.ts`: limites n−1, n, n+1, endereços e servidores hostis.
- `apps/agent/test/mail-smtp.test.ts`: servidor falso (465, 587 com e sem STARTTLS, AUTH recusado, prazo, resposta grande).
- `apps/agent/test/mail.test.ts`: salvar, senha de novo, teste pelos dois modos, teto, rota, Gmail sem permissão.
- e2e `tests/e2e/email-pacientes.spec.ts`: Gmail conectar e testar, SMTP salvar com a senha e testar, erros, celular, inglês, axe.

## 11. Entrega

Uma PR para a `develop`, com changelog, `docs/` da área (e-mail para pacientes) e capturas da seção.

## 12. Riscos

- Provedor que só aceita `AUTH CRAM-MD5` ou OAuth: o teste diz "o servidor recusou o usuário"; Gmail continua sendo a recomendação.
- `connect()` resolve o nome de novo ao conectar: um DNS que troca de endereço entre a checagem e a conexão poderia apontar para outro lugar. A porta é só 465 ou 587 e a senha só sai depois do TLS com o nome certo, então o risco é baixo.

## 13. Suposições

1. "Desconectar" do Gmail deixa de usar o Gmail (o modo vira "nenhum"). O Google não tira uma permissão só; para tirar tudo, Integrações › Google › Desconectar.
2. O e-mail de teste vai para o e-mail do dono (o da entrada na Zuri).
3. A senha do SMTP fica numa tabela própria (`zur_mail`), cifrada pelo mesmo cofre da S17 com `info` próprio, e não em CRM › Credenciais, porque a tela dela é a de Integrações (regra "Um ajuste, um lugar").

## 14. Entrevista com o Pablo

Sem perguntas: o protótipo aprovado e os ajustes de 13/11 definem o comportamento.
