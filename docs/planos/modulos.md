# Plano · Módulos: fluxos do n8n reescritos dentro da Zuri

Situação: plano. Nada aqui foi implementado. Pedido do Pablo em 09/11/2026, 20:19; nome e conexões compartilhadas revistos a pedido dele às 21:51.

> **Atualização de 10/11/2026 (00:51):** Módulos e Conexões saem de Automações e ganham um item próprio no menu lateral, **CRM**, com as partes **Módulos** e **Credenciais** (o novo nome de Conexões). Automações fica com Rotinas e Fluxos. Onde este plano diz "Automações › Módulos" e "Automações › Conexões", leia "CRM › Módulos" e "CRM › Credenciais"; "conexão" vira "credencial" nos textos da tela. Quais fluxos do n8n viram módulo, a ordem e as credenciais de cada um estão em [modulos-crm.md](modulos-crm.md) (PR #247).


## 1. Resumo

O Pablo quer uma aba em Automações para os fluxos que hoje rodam no n8n e estão sendo validados em produção. A ideia é que eles passem a existir no código da Zuri e precisem só de ser ligados, com as chaves, tokens e endereços de cada um.

É viável e cabe no plano gratuito, com uma condição: cada fluxo do n8n é **reescrito em código**, revisado, testado e auditado. A Zuri não importa o arquivo do n8n nem roda código de fora. O que muda para o Pablo é o fim do caminho: o fluxo chega desligado, ele informa as chaves, a Zuri roda um **ensaio** junto com o n8n sem enviar nada, e só depois ele liga de verdade.

Nome: **Módulos**. O Pablo achou que "Prontos" não dizia o que é (21:51). "Módulo" é a palavra de quem liga uma peça pronta num sistema: ela já vem feita, testada e com limites, e você só ativa e escolhe a conexão. "Workflows" seria a mesma palavra que "Fluxos" em inglês e confundiria com a aba dos fluxos montados na tela. Automações passa a ter quatro partes, que aparecem no menu lateral logo abaixo de "Automações" quando ela está aberta: **Rotinas**, **Fluxos**, **Módulos** e **Conexões**.

As chaves ficam em **Conexões**, num lugar só: o Chatwoot é configurado uma vez e todo módulo que fala com ele escolhe essa conexão pelo nome (seção 7, "Conexões compartilhadas").

O primeiro módulo é o **Pedido de avaliação pelo Chatwoot**, que já tem plano ([envio-chatwoot-pela-zuri.md](envio-chatwoot-pela-zuri.md)).

## 2. Contexto no sistema

- **Motor de fluxos (etapa 22a):** catálogo fechado de passos, conexões com endereço https fixo, métodos liberados (POST, PUT e PATCH; nunca DELETE), credencial cifrada (`flows-v1`), bloqueio de rede privada e de redirecionamento, tudo no alarme único do objeto, com contador de subrequisições por despertar (#159). Código em `apps/agent/src/flows/`.
- **CRM (etapa 22b):** recebe eventos do n8n em `/api/crm/events/:key`, assinados com HMAC e conferidos antes do Access. É o modelo para o retorno do ensaio.
- **Agenda e contatos nos fluxos (etapa 22c):** passos de ler a agenda, criar evento e buscar contatos.
- **Decisões que valem aqui:** 02/11, "CRM interno, atendimento no n8n" (o atendimento por IA continua no n8n); 09/11, exceção à regra de não escrever a contatos, só para o pedido de avaliação pelo Chatwoot.
- **Limites do Free:** `docs/arquitetura/orcamento-free-tier.md` e o estudo [workflows-n8n.md](workflows-n8n.md): 50 subrequisições por invocação, 100.000 linhas escritas por dia, 9.000 Neurons por dia para a Zuri, alarme de até 15 minutos.

## 3. Objetivo e critérios de aceite

1. A aba Módulos lista os módulos do código, com o estado de cada um (desligado, em ensaio, ligado, pausado, em validação no n8n) e o que cada um precisa.
2. Ligar pede as conexões do manifesto, testa cada uma e começa **sempre** em ensaio.
3. No ensaio, nenhuma chamada que muda algo fora sai. Um teste de segurança prova isso para cada fluxo.
4. O ensaio mostra o que a Zuri faria e compara com o que o n8n fez, item por item.
5. Ligar de verdade pede a senha recente. Desligar, "Pausar envios", o modo de bloqueio e `/bloquear` param tudo na hora.
6. Nenhum módulo chama endereço, caminho ou método fora do manifesto.
7. Cada módulo entra numa PR própria, com plano, testes, QA e auditoria de segurança completa.

## 4. Escopo

Dentro:

- Infraestrutura dos módulos: manifesto, registro, estados, ensaio, comparação com o n8n, aba Módulos.
- Um módulo por PR, na ordem que o Pablo escolher.

Fora:

- Importar o arquivo JSON do n8n, rodar o n8n dentro da Zuri, nó de código livre e HTTP para qualquer endereço.
- Mudar os passos de um módulo pela tela. A tela muda só as opções que o manifesto permite (limites, horário, textos). Quem quiser montar passo a passo usa a aba Fluxos.
- Atendimento por IA aos pacientes (agente do n8n): continua no n8n pela decisão de 02/11, até uma decisão nova.

## 5. Como funciona para o Pablo

### Fluxo 1 · Ligar um módulo

Automações › Módulos › **Ligar**. Abre um painel com três partes:

1. **Conexão:** uma lista com as conexões do tipo que o módulo pede (por exemplo, "Chatwoot do consultório"). Nada de digitar endereço e chave de novo: eles ficam na conexão. Se ainda não há nenhuma, o botão "Nova conexão com o Chatwoot" abre o mesmo diálogo de Automações › Conexões. "Testar conexão" faz só leituras e diz o que achou ("Conectou. Caixa: WhatsApp do consultório (API).").
2. **Limites:** as opções do manifesto, com padrão e faixa (por exemplo, 20 mensagens por dia, das 09:00 às 18:00).
3. **Como começa:** sempre em ensaio. "Salvar e começar o ensaio" pede a senha se passou de 15 minutos.

### Fluxo 2 · Ensaio

Por alguns dias, a Zuri roda o fluxo no horário de verdade, mas troca cada chamada que muda algo fora por uma anotação: "Enviaria a Thiago Moura". As leituras acontecem de verdade, dentro dos tetos.

Enquanto isso, o n8n continua fazendo o trabalho. No fim do fluxo do n8n, um nó a mais avisa a Zuri do que ele fez (assinado, como os eventos do CRM). A Zuri compara e mostra: "12 iguais, 1 só no n8n, 0 só na Zuri". Cada diferença abre o motivo.

### Fluxo 3 · Ligar de verdade

Quando o ensaio fecha sem diferença por 3 dias úteis seguidos (sugestão), aparece "Ligar de verdade". Pede a senha e lembra de desligar o fluxo no n8n no mesmo dia. A Zuri confere a chave única de cada envio, então um item que o n8n já fez não sai de novo pela Zuri.

### Fluxo 4 · Voltar atrás

"Desligar" para na hora. O fluxo do n8n fica desligado, não apagado, por 30 dias depois da troca; para voltar, basta religá-lo lá.

### Textos visíveis

Aba "Módulos"; estados "Desligado", "Em ensaio", "Ligado", "Pausado" e "Em validação no n8n"; botões "Ligar", "Testar conexão", "Salvar e começar o ensaio", "Ligar de verdade", "Desligar", "Acompanhar" e "Avisar quando chegar". Todos no catálogo de i18n (`pt-BR-modulos.ts` e `en`).

## 6. Regras de negócio e limites

| Regra | Valor |
| --- | --- |
| Estados | Desligado → Em ensaio → Ligado; qualquer um → Pausado (disjuntor) ou Desligado |
| Ensaio mínimo para ligar | 3 dias úteis seguidos sem diferença, ou o Pablo assume o risco com a senha |
| Módulos ligados ao mesmo tempo | até 10 |
| Tetos | No manifesto de cada fluxo: execuções por dia, chamadas por execução, linhas escritas por dia, Neurons por execução |
| Disjuntor | 2 falhas seguidas do serviço, recusa da chave (401/403), resposta fora do formato, teto do dia batido. Pausa e avisa |
| Versão nova do fluxo no código | Se muda o que sai para fora, volta para ensaio sozinha e avisa. Se só corrige texto ou limite, continua ligada |
| Bloqueio | No modo de bloqueio, nada externo roda, como em todo o resto da Zuri |

## 7. Desenho técnico

### Arquivos

| Arquivo | O que tem |
| --- | --- |
| `packages/shared/src/module-schemas.ts` | Esquema Zod do manifesto, dos estados, da configuração e dos eventos de comparação |
| `apps/agent/src/flows/modules/registry.ts` | Lista fixa dos módulos (import estático; nada carregado de fora) |
| `apps/agent/src/flows/modules/<id>/manifest.ts` | O manifesto do fluxo |
| `apps/agent/src/flows/modules/<id>/run.ts` | A lógica do fluxo, que só fala com o mundo pelos "efeitos" do runtime |
| `apps/agent/src/flows/modules/runtime.ts` | Executa, aplica tetos, troca efeitos por anotações no ensaio, grava a chave única |
| `apps/agent/src/flows/modules/conn/<tipo>.ts` | Cliente de cada serviço (Chatwoot primeiro), com os caminhos fixos |
| `apps/agent/src/api/modules.ts` | Rotas |
| `apps/web/src/pages/automations/modules/` | Aba, painel de ligar e acompanhar |

### Conexões compartilhadas

Pedido do Pablo às 21:51: o Chatwoot configurado uma vez serve a todas as automações que mandam mensagem por ele.

Hoje a develop já tem conexões de fluxo reaproveitáveis (`apps/agent/src/flows/connections.ts`, tabela da etapa 22a, credencial `flows-v1`): um serviço https com métodos liberados, usado por qualquer fluxo pelo id. O plano estende isso com um **tipo** por conexão:

| Tipo | Campos | Quem usa | Chamadas |
| --- | --- | --- | --- |
| `http` (o que existe) | endereço, métodos, cabeçalho e chave | passo "Chamar um serviço" dos fluxos | as que o fluxo monta, dentro dos métodos liberados |
| `chatwoot` (novo) | endereço, número da conta, caixa de entrada, chave de acesso do agente "Zuri" | só módulos | só as do cliente fixo `conn/chatwoot.ts` (listar caixas, achar contato, criar conversa, enviar mensagem) |

Regras que valem para todas:

1. **Um lugar só.** Automações › Conexões lista as conexões, de que tipo são, o final da chave e quem usa cada uma ("Usada por 2: Pedido de avaliação · módulo, Preço da passagem · fluxo"). Módulos, fluxos e rotinas guardam só o **id** da conexão, nunca uma cópia do endereço ou da chave.
2. **A chave não volta.** Cifrada no servidor com `MCP_CREDENTIAL_KEY` e o rótulo do tipo (`flows-v1` para `http`, `chatwoot-v1` para `chatwoot`); a tela mostra só o final. Fora do backup.
3. **Mudou o endereço, digita a chave de novo.** O servidor recusa salvar endereço novo com a chave velha (`VALIDATION_FAILED`, campo `secret`). Assim uma chave nunca segue para outro servidor por engano ou por um invasor que pegou a sessão.
4. **Senha recente** para criar, editar, trocar a chave e remover.
5. **Remover uma conexão em uso é recusado** (`CONFLICT`, com a lista de quem usa). Primeiro troca a conexão nas automações ou desliga.
6. **Trocar a chave vale na hora para todos** os que usam a conexão; a chave antiga é apagada, não guardada.
7. **Fluxo não usa conexão `chatwoot`.** Mensagem a paciente só sai por módulo, com texto e destino definidos no código e revisados. Isso impede que um fluxo montado na tela, ou um texto de fora que a IA leu, mande mensagem para qualquer número.
8. **Teste de conexão** só faz leitura (`GET` do perfil e das caixas) e mostra o nome da caixa.

Rotas novas (sob as de fluxos, fora dos tokens de API): `GET /api/connections`, `POST /api/connections` (tipo + campos), `PATCH /api/connections/:id`, `POST /api/connections/:id/secret`, `POST /api/connections/:id/test`, `DELETE /api/connections/:id`. A tabela atual ganha a coluna `kind` (`http` por padrão) e `meta` (JSON com conta e caixa) numa migration de acréscimo; nada muda nas conexões que já existem.

### O manifesto

Cada fluxo declara, e o Zod confere no teste e na partida:

- `id`, `version`, nome e descrição (chaves do i18n);
- **gatilho:** horário (no alarme único) ou evento (CRM, Chatwoot);
- **conexões:** tipo, campos (endereço https, conta, chave secreta) e, para cada uma, a lista fechada de chamadas: método e caminho com parâmetros validados;
- **opções:** campos que o Pablo pode mudar, com padrão e faixa;
- **efeitos:** o que muda fora (enviar mensagem, criar contato, criar evento). Só os efeitos são trocados por anotação no ensaio;
- **tetos:** execuções por dia, chamadas por execução, linhas escritas por dia, Neurons por execução (zero se não usa IA).

### Envio sem repetir

Antes de cada efeito, o runtime grava a chave única (fluxo + alvo + dia) como "pendente"; depois da resposta, "feito". Se o objeto cair no meio, o próximo despertar confere pela API do serviço antes de tentar de novo. É o mesmo cuidado do plano do Chatwoot.

### Rotas e contratos

| Rota | O que faz | Proteção |
| --- | --- | --- |
| `GET /api/modules` | Catálogo, estado e o que falta | Sessão |
| `POST /api/modules/:id/config` | Salva conexões e opções | Sessão + senha recente |
| `POST /api/modules/:id/test` | Testa as conexões (só leitura) | Sessão |
| `POST /api/modules/:id/mode` | Ensaio, ligado, desligado | Sessão + senha recente para "ligado" |
| `GET /api/modules/:id/runs` | Execuções e comparação | Sessão |
| `POST /api/modules/events/:key` | Retorno do n8n no ensaio | HMAC com carimbo de tempo (±5 min) e chave por fluxo, conferido antes do Access, como `/api/crm/events/:key` |

Erros no formato `{ code, message, details? }`. As rotas ficam fora da allowlist dos tokens de API (como `/api/flows/*`).

### Banco

Migration nova (a próxima livre; hoje 31), só de acréscimo:

- `zur_modules`: id, versão, estado, opções, ids das conexões, motivo da pausa, início do ensaio.
- `zur_module_runs`: execuções, com resumo sem conteúdo pessoal; poda em 90 dias.
- `zur_module_effects`: chave única, estado (pendente, feito, falhou, ensaio); poda em 180 dias.
- `zur_module_compare`: o que o n8n fez e o que a Zuri faria, por chave; apagada 30 dias depois de ligar.
- Coluna `modules` em `zur_area_versions`, para a tela atualizar ao vivo.

Credenciais nas conexões cifradas que já existem, com `info` próprio por fluxo (`modules-v1:<id>`).

### Ferramentas do agente

Nenhuma ferramenta nova no começo. A conversa pode responder "o que está ligado" lendo o estado. Ligar, desligar e mudar chave ficam só na tela.

### Agendamentos, IA e integrações externas

Tudo no alarme único, depois dos fluxos da etapa 22a, dividindo o contador de subrequisições do despertar. IA só se o manifesto declarar, pelo `agent.ai()`, com os modelos grátis e o teto de Neurons.

## 8. Custo e cotas do plano Free

Na Cloudflare: nenhum recurso novo. Cada fluxo declara o próprio gasto, e o teste de orçamento confere. Exemplo do pedido de avaliação: até 20 envios por dia × 4 chamadas = 80 subrequisições por dia, uma mensagem por despertar, e cerca de 100 linhas escritas por dia.

Fora da Cloudflare: depende do serviço de cada fluxo. O Chatwoot com caixa de API não cobra por mensagem (resposta do Pablo em 09/11). Qualquer fluxo que leve a custo fora ganha ⚠️ no plano e espera o OK do Pablo.

## 9. Segurança e privacidade

| Risco | Trava |
| --- | --- |
| Chave vazada | Cifrada, digitada com senha, nunca volta ao navegador nem ao backup |
| Chamada para onde não devia | Só https público, sem redirecionamento, sem rede privada, só os caminhos e métodos do manifesto |
| Dado de fora virando ordem | Tudo que chega é validado com Zod e tratado como dado; nunca vira instrução para a IA |
| Envio em massa por erro | Ensaio obrigatório, tetos, chave única, disjuntor, "Pausar envios" e bloqueio |
| Retorno falso do n8n | HMAC com carimbo de tempo e chave por fluxo; o retorno só serve para comparar, nunca para mandar a Zuri fazer algo |
| Arquivos do n8n | O JSON exportado pode ter endereços, ids e até tokens. **Nunca entra no repositório, que é público.** O Pablo coloca nos arquivos do projeto; a análise tira os segredos antes de qualquer coisa; os testes usam `exemplo.com.br` |
| Dados de pacientes | Mínimo necessário; histórico sem conteúdo de mensagem; "não quero receber" vale para sempre |

Auditoria de segurança completa em cada PR de fluxo novo, como nas etapas que abrem saída para a internet, e pentest do fluxo depois do merge.

## 10. Testes

- Unidade: esquema do manifesto, estados, tetos, chave única, regra de ensaio mínimo e a lógica de cada fluxo.
- Integração no workerd com serviços falsos, gravados a partir de execuções reais do n8n com os dados trocados por exemplos.
- Segurança: chamada fora do manifesto recusada, redirecionamento recusado, rede privada recusada, HMAC errado ou velho recusado, nada sai no bloqueio e, **no ensaio, nenhuma chamada de efeito sai** (teste por fluxo).
- Orçamento: subrequisições e linhas escritas por despertar.
- E2e: ligar, testar, começar o ensaio, ver a comparação, ligar de verdade, desligar. Acessibilidade com axe.

## 11. Entrega

| PR | O que entra | Depende de |
| --- | --- | --- |
| 1 | Infraestrutura: manifesto, registro, estados, ensaio, comparação, rotas, migration e a aba Módulos (vazia, com explicação) | Nova interface |
| 2 | Primeiro fluxo: Pedido de avaliação pelo Chatwoot (junta as PRs 2 a 4 do plano do Chatwoot) | PR 1 |
| 3 em diante | Um fluxo do n8n por PR, na ordem do Pablo | PR 1 |

Passo a passo de cada fluxo do n8n:

1. O Pablo exporta o fluxo do n8n e coloca nos arquivos do projeto (nunca no repositório).
2. Análise em `docs/planos/modulos/<id>.md`: gatilho, passos, chamadas, dados, volumes, erros e o que muda fora. Sem endereços nem ids reais.
3. O Pablo aprova a análise.
4. Código, testes, QA e auditoria; a PR entra desligada.
5. Depois do deploy, o Pablo liga em ensaio e adiciona no fim do fluxo do n8n o nó que avisa a Zuri.
6. 3 dias úteis sem diferença: "Ligar de verdade" e desligar no n8n no mesmo dia.
7. 30 dias depois, o Pablo apaga o fluxo no n8n.

## 12. Riscos

- **Diferença de comportamento com o n8n.** Mitigação: o ensaio compara item por item antes de ligar.
- **Envio duplicado na troca.** Mitigação: chave única por item e o n8n desligado no mesmo dia.
- **Mudança na API de um serviço.** Mitigação: caminhos fixos, resposta validada por Zod e disjuntor na primeira resposta estranha.
- **Fluxo grande demais para o Free.** Mitigação: o manifesto declara o gasto; a análise do passo 2 recusa ou divide antes de escrever código.

## 13. Suposições

- Os serviços chamados têm endereço https público.
- Os fluxos do n8n têm volume de consultório (dezenas de itens por dia, não milhares).
- O n8n continua no ar durante o ensaio.

## 14. Entrevista com o Pablo

### Perguntas abertas

1. O nome "Módulos" serve? Recomendação: sim (seção 1). Trocar depois custa só textos.
2. Quais fluxos do n8n vêm, em que ordem? O protótipo usa "Confirmação de consulta" e "Boas-vindas a quem escreve pela primeira vez" só como exemplos. Recomendação: começar pelo pedido de avaliação, que já tem plano.
4. Módulos que mandam mensagem a pacientes além do pedido de avaliação (confirmação de consulta, boas-vindas) abrem uma exceção nova à regra "a Zuri não escreve a contatos". Recomendação: aprovar um por um, na análise de cada fluxo (passo 3 da seção 11), nunca em bloco.
3. Ensaio mínimo de 3 dias úteis sem diferença antes de ligar de verdade? Recomendação: sim.
