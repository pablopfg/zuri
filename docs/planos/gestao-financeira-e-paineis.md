# Plano · Gestão do consultório: financeiro, atendimentos e resultados

Situação: esperando o Pablo (protótipo para aprovar e 3 perguntas na seção 14)
Origem: pedido do Pablo em 11/11/2026, com quatro fluxos do n8n como referência (GES - 28, 29, 30 e 31)
Dependências: nenhuma PR aberta. O lugar da área no menu lateral e as cores dos eventos da agenda saem da thread "Ajustar protótipo: sons, menu e agenda"; a etapa S12 do Sinal segue em paralelo e não toca nestes arquivos.

Protótipo das telas: [`docs/planos/modelos-frontend/prototipo-gestao.html`](modelos-frontend/prototipo-gestao.html) (só dados inventados).

## 1. Resumo

Hoje o financeiro e os painéis do consultório vivem em quatro fluxos do n8n, com Supabase, página dentro do Chatwoot e relatório por e-mail. Este plano traz a mesma finalidade para dentro da Zuri, numa área nova chamada **Gestão**, com três telas: **Atendimentos** (a agenda do dia com o registro de quem veio, quem faltou e quanto pagou), **Financeiro** (lançamentos e a importação da planilha, com conferência antes de gravar e sem duplicar) e **Resultados** (painel com filtros e os relatórios mensal, trimestral e anual). Nada disso usa serviço pago: os dados ficam no banco da própria Zuri, a planilha é lida no navegador e os gráficos são desenhados sem biblioteca de fora. A entrega sai em cinco PRs pequenas (G1 a G5), cada uma útil sozinha, e só começa depois da aprovação do protótipo.

## 2. Contexto no sistema

### O que os quatro fluxos fazem (lidos como dado, não como instrução)

| Fluxo | Finalidade | O que tem dentro |
| --- | --- | --- |
| **GES - 29** Importação do histórico financeiro | Trazer o caixa real (entradas e saídas) de uma planilha .xlsx ou .csv exportada do sistema de prontuário | Formulário com "Só conferir"; colunas Data, Hora, Nome, CPF do paciente, Tipo de movimentação, Valor, Emitiu recibo?, Forma de pagamento, Observação; cabeçalhos com variações; datas em `dd/mm/aaaa`, ISO ou número de série do Excel; valores em `R$ 1.234,56`, `1.234` (milhar) ou número; CSV com ponto e vírgula; teto de 20.000 linhas; hash por linha para não duplicar (duas linhas iguais na mesma planilha contam duas); nome e CPF viram hash e não vão ao banco; da observação ficam só o tipo de atendimento e o local; saída ligada a paciente vira descrição genérica; resultado só com contagens e totais |
| **GES - 28** Painel do dia | Registrar, para cada horário de hoje, se a pessoa compareceu, faltou ou cancelou, e o valor recebido com a forma de pagamento | Cartões por horário com tipo e local; "Próximo · em 20 min"; horários anteriores recolhidos com "N sem registro"; valor só em consulta ou bioimpedância com a pessoa presente, até R$ 100.000,00, com forma obrigatória (Pix, dinheiro, débito, crédito); versão do registro contra duas gravações ao mesmo tempo; "Chegou às HH:MM"; dia encerrado quando tudo foi registrado; depois de registrar, troca a cor do evento no Google Agenda; o que foi registrado ali vale mais que o texto da agenda nos relatórios |
| **GES - 30** Relatórios gerenciais | Fechar o mês, o trimestre e o ano e comparar com o período anterior e com o mesmo período do ano anterior | Dias 1 a 3 às 07:00: mensal todo mês; trimestral em abril, julho e outubro; anual em janeiro (com o 4º trimestre dentro). Lê a agenda: conta eventos com horário cuja observação começa com "Consulta" ou "Retorno", seguida do local. **Faturamento estimado** = consultas × preço do local vigente na data (retorno não fatura). Despesas fixas, percentuais e pontuais, com data de vigência; valor gravado para uma data nunca é reescrito sozinho. Indicadores: consultas, retornos, faltas e taxa, ticket médio, pacientes atendidos, novos, reativados (mais de 12 meses sem vir) e recorrentes, dias até o retorno (mediana), atendimentos por dia da semana, resultado, margem, ponto de equilíbrio, custo por atendimento, ponte do faturamento (volume × preço), locais (novo e sem preço), avaliações do Google, caixa da planilha ao lado do estimado, projeções e qualidade dos dados. Cada relatório sai uma vez |
| **GES - 31** Dashboard de gestão | Acompanhar tudo num painel com filtros | Períodos prontos (este mês, mês passado, 30 dias, 3, 6 e 12 meses, este ano, ano passado, personalizado), comparação (período anterior ou ano anterior), agrupamento por dia, semana ou mês; 14 indicadores com seta de melhor ou pior; gráficos de receita, caixa (entradas × saídas), agenda por situação, entradas por forma de pagamento e por tipo de atendimento, maiores saídas, custo de IA, mensagens automáticas e tabela mês a mês; dados já somados, sem nome, telefone nem CPF |

### O que a Zuri já tem e este plano usa

- **Agenda do Google**, lida na hora: `apps/agent/src/google/service.ts`, `events.ts` e as rotas `GET/POST/PATCH/DELETE /api/google/events` em `apps/agent/src/api/google.ts`. O título do evento é o nome completo e a observação traz o tipo e o local ("Consulta | Consultório", "Retorno | Consultório").
- **Leitura do tipo e do local de um evento**, já testada com todas as bordas: `readType`, `kindOf` e `plainLines` em `apps/agent/src/google/appointments.ts` (ficha do contato, PR #295). O classificador da Gestão reaproveita essas funções em vez de copiar a expressão regular do n8n.
- **Contatos do Google** com CPF e data de nascimento no JSON `data` (`apps/agent/src/google/contacts-store.ts`, `contact-name.ts` com `splitName` e `cpfsIn`). Homônimos são pessoas diferentes (decisão de 11/11): nome sozinho nunca liga ninguém.
- **Números das avaliações por período** (S11, migration 35 `review_metrics`), que continuam na tela de Avaliações (Resultados ficou só com o financeiro, decisão de 12/11).
- **Banco**: migrations só de acréscimo em `apps/agent/src/db/migrations.ts`; a última na `develop` é a 36 (`session_binding`). A próxima livre é a **37**, a conferir de novo no dia da implementação.
- **Limite de corpo** por rota em `apps/agent/src/gates/body.ts` (`API_BODY_MAX_BYTES`): a importação respeita esse teto mandando as linhas em lotes, sem rota de envio grande nova.
- **Backup** em `apps/agent/src/backup/export.ts` (lista explícita de tabelas; a de contatos fica fora).
- **Central de avisos** e bot do Telegram para o aviso de relatório pronto; **canal de tempo real** `/api/live` para Atendimentos e Resultados se atualizarem na hora.
- **Interface**: telas sob demanda, textos em `packages/shared/i18n/pt-BR-<tela>.ts`, `PageHeader` e `sections`. O JS inicial está no teto (140,9 kB): nada da Gestão entra no primeiro carregamento.

### Decisões que valem aqui

- 11/11/2026: a Zuri não se integra ao n8n; as funções viram código da Zuri (`docs/planos/sem-integracao-n8n.md`).
- 11/11/2026: sem acesso externo por API ou token. Por isso não existe "painel para a recepção" fora da Zuri: quem entra é o dono.
- 10/11/2026: o plano `docs/planos/modulos-crm.md` tinha deixado o GES - 28 **fora** (painel da recepção dentro do Chatwoot) e previsto o GES - 29 só em CSV. O pedido de 11/11 muda isso: o painel de agendamentos entra, como tela da própria Zuri, e a planilha .xlsx também (lida no navegador, sem biblioteca). Este plano substitui as linhas 9 e 9b daquele.
- Plano gratuito, IA só com modelos grátis: os quadros de **custo de IA** do n8n (fatura de provedores pagos) não entram. O consumo de Neurons já tem medidor próprio.
- Exemplos, testes e capturas só com nomes inventados (11/11).

## 3. Objetivo e critérios de aceite

| Nº | Critério | Origem |
| --- | --- | --- |
| CA1 | Planilha .xlsx ou .csv com as colunas do GES - 29 (com as variações de cabeçalho) é lida e mostra a conferência (linhas, período, entradas, saídas, totais, ignoradas por motivo, prováveis repetidas) **antes** de gravar qualquer coisa | Pablo / GES - 29 |
| CA2 | Importar a mesma planilha duas vezes, ou duas planilhas com períodos sobrepostos, grava cada lançamento uma vez só; duas linhas idênticas dentro da mesma planilha contam duas | GES - 29 |
| CA3 | Valores viram centavos inteiros sem erro: `150`, `150,5`, `R$ 1.234,56`, `1.234` (milhar), `-150` (saída) e número do Excel | GES - 29 |
| CA4 | Datas em `dd/mm/aaaa`, `aaaa-mm-dd` e número de série do Excel viram o dia certo; data inválida, anterior a 2000 ou futura ignora a linha e conta em "ignoradas" | GES - 29 |
| CA5 | Nome e CPF da planilha nunca são gravados nos lançamentos, não aparecem em log e não saem do navegador em texto puro além do pedido de gravação; o lançamento guarda só o vínculo com o contato (quando o CPF acha um único contato) e uma chave sem volta | Pablo / GES - 29 |
| CA6 | A tela Atendimentos lista os horários de hoje, uma linha por horário, em três grupos (para registrar, a seguir, registrados), destaca o próximo e deixa registrar **compareceu**, ou uma das três formas de não vir (**faltou**, **cancelou**, **reagendou**), com um toque e com "Desfazer"; valor e forma de pagamento só com "compareceu"; "reagendou" aceita a data nova (opcional); só um horário fica aberto por vez | Pablo (11/11 e 12/11) / GES - 28 |
| CA7 | Registrar um valor cria um lançamento de entrada ligado ao evento; alterar o registro corrige o mesmo lançamento, sem criar outro | plano (novo) |
| CA8 | Dois registros do mesmo horário ao mesmo tempo (duas abas) não se atropelam: o segundo recebe "atualizado em outra aba" e a lista nova | GES - 28 |
| CA9 | Depois do registro, a cor do evento no Google Agenda segue a situação; falha na troca de cor não desfaz o registro e fica avisada | GES - 28 |
| CA10 | Preços por local e despesas (fixa, percentual, pontual) têm data de vigência; mudar um valor pede a data em que a mudança começou e nunca altera um mês já fechado | GES - 30 |
| CA11 | Resultados mostra **só o financeiro**: quatro indicadores (recebido, saídas, saldo, faturamento estimado), a comparação e os gráficos da seção 5. Todo gráfico da Gestão é por período, **Semana**, **Mês** (padrão) ou **Ano**, com setas para o período anterior; não há "Ver tabela" na tela (a tabela existe só para leitor de tela). Os números da agenda ficam em Atendimentos › Indicadores e os das avaliações continuam em Avaliações | Pablo (12/11) / GES - 31 |
| CA12 | No dia 1º (com nova tentativa nos dias 2 e 3) o relatório mensal do mês anterior fica pronto; em abril, julho e outubro também o trimestral; em janeiro o anual. Cada um é gerado uma vez e gera um aviso | Pablo / GES - 30 |
| CA13 | O faturamento estimado conta só consultas realizadas, pelo preço do local vigente na data; retorno não fatura; local sem preço fica fora da conta e aparece em "Qualidade dos dados" | GES - 30 |
| CA14 | Paciente novo, reativado e recorrente saem certos mesmo com homônimos: a contagem usa o contato ligado e, sem ele, a chave do nome; nunca junta duas pessoas por nome quando há contato ligado diferente | Pablo (11/11) / plano |
| CA15 | Todas as telas funcionam vazias, carregando e com erro, por teclado e leitor de tela, no celular, em tema claro e escuro, em pt-BR e en | padrão do projeto |
| CA16 | Nenhuma tela ou rota da Gestão soma ao JS inicial; uma importação de 5.000 linhas fica abaixo de 20% da cota diária de escritas | regras P1, P4 e P11 |
| CA17 | Com Resultados ou Atendimentos aberto, um lançamento ou registro novo (de outra aba, do celular ou de uma importação) aparece nos indicadores e nos gráficos em até 2 segundos, sem recarregar a página e sem consulta periódica; a tela mostra a hora do último lançamento | Pablo (12/11) |
| CA18 | O botão **Ocultar valores** troca todo valor em dinheiro da Gestão (indicadores, listas, gráficos, avisos e relatórios) por "R$ •••••" na hora, sem nova consulta; os gráficos mantêm só a forma, sem números no eixo; a escolha fica guardada no aparelho e vale até ser desligada | Pablo (12/11) |

## 4. Escopo

**Entra:**

- Área **Gestão** com Atendimentos, Financeiro e Resultados.
- Importação de .xlsx e .csv com conferência, lançamento manual (entrada e saída), edição e anulação de lançamento.
- Registro de presença, falta, cancelamento, reagendamento, chegada e pagamento por horário.
- Botão "Ocultar valores" em todas as telas da Gestão.
- Preços por local e despesas com vigência.
- Painel com filtros, relatórios mensal, trimestral e anual dentro da Zuri, com aviso.
- Ferramentas de leitura para a conversa ("quanto entrou em outubro?").

**Fica fora (e onde vai parar):**

- Painel para a recepção ou qualquer acesso de terceiros → não faremos sem um estudo de segurança próprio; a Zuri é de um dono só (pergunta 2).
- Custo de IA por fluxo e fatura de provedores (GES - 31, GES - 32) → não faremos: só modelos grátis.
- Gráfico de "mensagens automáticas" → entra quando o envio pelo Chatwoot existir (`docs/planos/envio-chatwoot-pela-zuri.md`).
- "Perguntar se está a caminho" e selo "Atraso avisado" → dependem do Chatwoot; seguem como a pergunta P3 de `modulos-crm.md`.
- Relatório por e-mail → opcional, depois (pergunta 3).
- Emissão de recibo, nota fiscal, conciliação bancária, contas a pagar com vencimento → não pedido; fica para um plano próprio se o Pablo quiser.
- Escrever no Google Contatos → não (decisão P8 de `modulos-crm.md`).
- Lugar exato e nomes no menu lateral, cores dos eventos e feriados na agenda → thread "Ajustar protótipo: sons, menu e agenda". Este plano só consome o mapa situação → cor que sair de lá.

## 5. Como funciona para o Pablo

A área aparece no menu como grupo **Gestão**, com três itens. No celular entra em "Mais". Na paleta ⌘K: "Atendimentos de hoje", "Novo lançamento", "Importar planilha", "Resultados do mês".

### Fluxo 1 · Importar a planilha (Financeiro › Importar)

1. O Pablo abre **Financeiro** e toca em **Importar planilha**. Arrasta o arquivo ou escolhe no aparelho (.xlsx ou .csv, até 5 MB).
2. A Zuri lê o arquivo **no próprio navegador** e mostra a **conferência**: período (de 02/01/2025 a 30/09/2026), quantas entradas e saídas e os totais, quantas linhas foram ignoradas e por quê (data inválida, valor inválido, tipo desconhecido), quantas já estavam gravadas, quantas parecem repetir um pagamento registrado em Atendimentos, quantas se ligaram a um contato pelo CPF e quantos CPFs inválidos. Abaixo, uma amostra das 20 primeiras linhas já tratadas (dia, tipo, valor, forma, atendimento, local), sem nome nem CPF.
3. Se faltar coluna obrigatória (Data, Nome, Tipo de movimentação, Valor), a tela diz qual falta e lista as colunas aceitas. Nada é enviado.
4. As "prováveis repetidas" vêm desmarcadas. O Pablo pode abrir a lista e marcar as que quer gravar mesmo assim.
5. Ele toca em **Gravar N lançamentos**. A barra mostra o andamento (lotes de 200). Se a conexão cair no meio, tocar de novo continua de onde parou, sem duplicar.
6. No fim: "1.812 lançamentos gravados. 37 já estavam aqui." A importação fica no histórico (data, período, contagens), sem o arquivo. A tela lembra: "A planilha não foi guardada. Se não precisar mais dela, apague do seu computador."

Estados: vazio (explica as colunas e oferece um modelo .csv com dados inventados), lendo, conferência, gravando, pronto, arquivo ilegível, arquivo grande demais, mais de 5.000 linhas ("Divida por ano"), limite do dia atingido.

### Fluxo 2 · Lançamentos (Financeiro)

1. A tela abre com o mês atual: três números (entradas, saídas, saldo) e a lista por dia, do mais novo para o mais antigo. Cada linha: valor, forma, tipo de atendimento ou descrição, local, origem (planilha, atendimento ou manual) e, quando há contato ligado, o nome dele com link para a ficha.
2. Filtros: período, entradas ou saídas, forma de pagamento, origem. Busca pela descrição das saídas.
3. **Novo lançamento**: entrada ou saída, data, valor, forma, e para saída a descrição ("Aluguel"); para entrada, tipo de atendimento, local e contato (opcional, escolhido na lista de contatos).
4. Um lançamento pode ser corrigido ou **anulado** (some das contas, fica no histórico com o motivo). Nada é apagado de vez.
5. Aba **Preços e despesas**: preço da consulta por local, com "vale desde"; despesas fixas por mês, percentuais sobre o faturamento e pontuais. Mudar um valor abre "A partir de quando?" e mostra quais meses fechados não mudam.

### Fluxo 3 · Atendimentos do dia

Redesenhado em 12/11/2026 a pedido do Pablo: menos informação por tela e um registro por vez.

1. A tela tem duas abas: **Hoje** e **Indicadores**. Hoje abre no dia atual, com **Ontem · Hoje · Amanhã** no topo (e o seletor de data para outro dia).
2. A lista tem uma linha por horário (hora, nome, tipo e local) em três grupos, nesta ordem: **Para registrar** (o horário já passou e falta o registro), **A seguir** (o próximo vem destacado, com "em 20 min") e **Registrados** (com a situação e, se houve, o valor e a forma).
3. Só uma linha fica aberta por vez. Aberta, ela mostra **Compareceu** separado das três formas de não vir: **Faltou**, **Cancelou** e **Reagendou**. Faltou e Cancelou gravam no toque. Reagendou pede a data e o horário novos (dá para gravar "Ainda sem data"); a linha mostra "para 19/11 às 11:30". Quando o evento é movido no Google Agenda, a Zuri marca "Reagendou" sozinha e o horário novo aparece no dia dele. Compareceu em consulta ou bioimpedância mostra o **valor** (sugerido pelo preço do local) e as formas de pagamento; tocar na forma grava. "Sem pagamento agora" grava só a presença.
4. Todo registro mostra um aviso com **Desfazer** por alguns segundos, e a linha vai para Registrados. Tocar numa linha registrada reabre para corrigir. A cor do evento no Google Agenda acompanha.
5. **Chegou** marca a hora da chegada nos horários que ainda vão acontecer, sem registrar mais nada.
6. Ao lado (no celular, em cima) ficam dois quadros pequenos: **Registrados** ("3 de 8", com a barra por situação) e **Recebido hoje** (total e por forma de pagamento). Dia futuro só mostra a agenda.
7. **Indicadores** reúne o que é da agenda e saiu de Resultados, com o mesmo seletor Semana | Mês | Ano: atendimentos (consultas e retornos), taxa de faltas, reagendamentos e cancelamentos, pacientes novos, agenda por situação no período e atendimentos por dia da semana.

Estados: sem agenda conectada (leva a Configurações › Integrações), dia sem horários, carregando, Google fora do ar (mostra o último retrato com a hora e avisa), registro que mudou em outra aba.

### Fluxo 4 · Resultados (painel)

Redesenhado em 12/11/2026 a pedido do Pablo: só o financeiro, poucos números grandes e atualização ao vivo.

1. No topo, uma linha só: **Ver por** (**Semana**, **Mês** ou **Ano**; o padrão é Mês), as setas com o nome do período ("novembro de 2026", "9 a 15 de novembro"), **Comparar** e o indicador **Ao vivo · último lançamento às 14:32** (fora do período atual vira "Voltar para hoje"). A comparação é justa: semana com a semana anterior, mês e ano com o mesmo período do ano anterior, sempre até o dia equivalente a hoje. Os filtros ficam no endereço da página.
2. Quatro indicadores, cada um com o valor e a variação: **Recebido**, **Saídas**, **Saldo** e **Faturamento estimado**.
3. Um gráfico principal com a troca **Receita | Entradas e saídas**, com barras por dia (Semana), por semana (Mês; a sobra de 1 a 3 dias no fim do mês entra na última semana) ou por mês (Ano), a linha tracejada da comparação e a do faturamento estimado no Mês e no Ano. Ao lado, dois quadros menores: **Por forma de pagamento** e **Maiores saídas**. Sem "Ver tabela" e sem resumo em tabela: passar o mouse (ou tocar) numa barra mostra os valores.
4. **Ocultar valores** (no topo de toda tela da Gestão): troca os valores em dinheiro por "R$ •••••" e tira os números do eixo dos gráficos, que ficam só com a forma. Serve para abrir a tela perto de outras pessoas. A escolha fica guardada no aparelho.
5. **Ao vivo:** quando um pagamento é registrado em Atendimentos, um lançamento é criado ou uma importação termina, os indicadores e as barras se ajustam na hora, com uma animação curta (desligada para quem pede menos movimento). Nada pisca nem recarrega.
6. O que não é financeiro mora no seu setor: agenda e pacientes em **Atendimentos › Indicadores**; avaliações em **Avaliações**. O aviso de **qualidade dos dados** (local sem preço, mês sem despesas, horários sem registro) aparece só quando existe problema, como uma linha com link para onde se corrige.

### Fluxo 5 · Relatórios

1. Aba **Relatórios** em Resultados: lista dos fechamentos (Outubro 2026, 3T26, 2025…), do mais novo para o mais antigo, com "novo" no que ainda não foi aberto.
2. Cada relatório abre numa página de leitura com: destaques em três frases e o demonstrativo (faturamento estimado, despesas fixas e variáveis, resultado, caixa registrado). O detalhe fica recolhido em "Ver mais": ponto de equilíbrio, ticket médio, ponte do faturamento (volume × preço), locais, melhor e pior mês (no anual) e projeção do período seguinte. O relatório também é só financeiro; ele cita a quantidade de consultas apenas para explicar o faturamento.
3. No dia 1º, perto das 07:00, o aviso chega na central e no bot: "O relatório de outubro está pronto." O texto do aviso não leva valores.
4. **Gerar de novo** refaz um relatório depois de corrigir um preço ou um registro; o anterior fica guardado com a data.

### Textos visíveis

Lista inicial; o catálogo completo (pt-BR e en) sai em cada PR, em `packages/shared/i18n/pt-BR-management.ts` e no par em inglês.

| Chave | pt-BR | en | Onde aparece |
| --- | --- | --- | --- |
| `nav.management` | Gestão | Management | grupo do menu |
| `management.visits.title` | Atendimentos | Appointments | menu e título |
| `management.finance.title` | Financeiro | Finance | menu e título |
| `management.results.title` | Resultados | Results | menu e título |
| `finance.import.cta` | Importar planilha | Import spreadsheet | Financeiro |
| `finance.import.check.title` | Confira antes de gravar | Check before saving | conferência |
| `finance.import.check.nothingSaved` | Nada foi gravado ainda. | Nothing has been saved yet. | conferência |
| `finance.import.save` | Gravar {n} lançamentos | Save {n} entries | conferência |
| `finance.import.missingColumns` | Faltam as colunas: {list}. Use o relatório financeiro com Data, Nome, Tipo de movimentação e Valor. | Missing columns: {list}. Use the finance report with Date, Name, Type and Amount. | erro |
| `finance.import.done` | {saved} lançamentos gravados. {repeated} já estavam aqui. | {saved} entries saved. {repeated} were already here. | fim |
| `finance.import.fileNotKept` | A planilha não foi guardada. Se não precisar mais dela, apague do seu computador. | The spreadsheet was not kept. Delete it from your computer if you no longer need it. | fim |
| `visits.next` | Próximo · {when} | Next · {when} | cartão |
| `visits.register` | Registrar | Save | cartão |
| `visits.conflict` | Este horário foi atualizado em outra aba. Confira e registre de novo se precisar. | This slot was updated in another tab. Check it and save again if needed. | aviso |
| `visits.amountNotAllowed` | Valor só entra em consulta ou bioimpedância com a pessoa presente. | An amount only applies to a consultation or bioimpedance with the person present. | erro |
| `visits.dayDone` | Dia registrado | Day recorded | fim do dia |
| `results.noData` | Sem dados neste período. | No data for this period. | gráficos |
| `results.report.ready` | O relatório de {period} está pronto. | The {period} report is ready. | aviso |

## 6. Regras de negócio e limites

| Regra | Valor | No limite | Erro |
| --- | --- | --- | --- |
| Tamanho do arquivo | 5 MB | 5 MB lê; acima recusa no navegador, sem enviar | mensagem na tela |
| Linhas por planilha | 5.000 | 5.000 passa; 5.001 pede para dividir por ano | mensagem na tela |
| Linhas gravadas por dia (importação) | 10.000 | a 10.001ª espera o dia seguinte; o que já entrou fica | `rate_limited` com `retryAfter` |
| Lote de gravação | 200 linhas por pedido | 201 recusa | `validation_failed` |
| Valor de um lançamento | 1 centavo a R$ 100.000,00 (10.000.000 centavos) | zero e negativo recusam; saída guarda o valor positivo com tipo "saída" | `validation_failed` |
| Data do lançamento | de 01/01/2000 até hoje (fuso do dono) | amanhã recusa | `validation_failed` |
| Descrição da saída | 80 caracteres, sem e-mail e sem sequência longa de números; se citar "paciente" ou "cliente" vira "Devolução a paciente" ou "Saída ligada a paciente" | corta em 80 | — |
| Local | 60 caracteres | corta | — |
| Formas de pagamento | Pix, dinheiro, débito, crédito, transferência, boleto, outro | texto desconhecido vira "outro" | — |
| Tipos de atendimento | consulta, retorno, bioimpedância, antropometria, outro | — | — |
| Sem duplicar | impressão da linha = HMAC(dia, hora, tipo, centavos, forma, chave do paciente, atendimento, local, descrição, nº da ocorrência na planilha); índice único | linha repetida não grava e conta em "já estavam aqui" | — |
| Provável repetida | entrada da planilha com o mesmo dia e os mesmos centavos de um pagamento registrado em Atendimentos para o mesmo contato (ou a mesma chave) | vem desmarcada na conferência | — |
| Vínculo pelo CPF | CPF válido que aparece em **um** contato | dois contatos com o mesmo CPF: não liga e conta em "CPF em mais de um contato" | — |
| Registro do atendimento | compareceu, faltou, cancelou, reagendou (com data nova opcional); valor só com compareceu em consulta ou bioimpedância; forma obrigatória quando há valor | — | `validation_failed` |
| Concorrência do registro | versão do registro; pedido com versão antiga recusa | — | `conflict` |
| Janela do registro | qualquer dia até hoje; futuro só leitura | registrar amanhã recusa | `validation_failed` |
| O que conta como atendimento | evento com horário, não cancelado, cuja observação diz "Consulta" ou "Retorno" (`readType`); o registro da tela vale mais que o texto | "Retorno previsto para 10/11" não conta e vira aviso de qualidade | — |
| Duplicado na agenda | mesma pessoa, mesmo tipo, mesmo dia | conta um e avisa | — |
| Faturamento estimado | consulta realizada × preço do local vigente na data; retorno não fatura | local sem preço fica fora e é avisado | — |
| Paciente novo / reativado | primeira vez em todo o histórico / voltou depois de mais de 365 dias | só calcula quando há pelo menos 365 dias de histórico antes do período | "—" na tela |
| Preço e despesa | valor para a mesma data de vigência não muda sozinho; mudança pede a data | mês fechado nunca muda; "Gerar de novo" é ato do dono | `conflict` |
| Despesa percentual | 0,01% a 99,99% do faturamento do mês | 100% recusa | `validation_failed` |
| Relatórios | mensal todo dia 1º; trimestral em 1/4, 1/7 e 1/10; anual em 1/1; nova tentativa nos dias 2 e 3; período que não terminou não gera relatório | cada (tipo, período) uma vez; "Gerar de novo" guarda a versão anterior | — |
| Painel | histórico de 36 meses para trás e 60 dias para frente | período maior corta e avisa | — |
| Fuso | o do dono (`America/Sao_Paulo` por padrão), pelo `Intl`, nunca "−3 h" fixo | virada do mês e do ano testadas às 23:59 e 00:00 | — |

## 7. Desenho técnico

Três fronteiras, cada uma com uma porta pequena:

1. **Leitura da planilha** (`packages/shared/src/finance-sheet.ts`): função pura `readSheet(rows) → { entries, discarded, missingColumns }`. Recebe a matriz de células e devolve lançamentos já normalizados. Roda no navegador (conferência imediata) e de novo no servidor para cada lote (o servidor nunca confia no que o navegador calculou). É aqui que ficam centavos, datas, formas, tipo e local, descrição das saídas e validação de CPF, com os mesmos casos de teste do fluxo original.
2. **Livro-caixa** (`apps/agent/src/finance/ledger.ts`): única porta de escrita de lançamentos, venha de onde vier (planilha, atendimento, manual). Garante impressão única, centavos inteiros e a anulação sem apagar.
3. **Atendimentos** (`apps/agent/src/finance/visits.ts`): o espelho da agenda sem nomes e o registro do dia. É quem responde "o que aconteceu neste horário" para o painel e os relatórios.

As contas (`apps/agent/src/finance/metrics.ts`) leem as duas últimas e não escrevem em nenhuma.

**Tempo real.** As telas usam o canal que já existe (`/api/live`, `apps/agent/src/live/channel.ts`): ele manda só o número da versão de cada área. Entram duas áreas novas em `packages/shared/src/areas.ts`, `finance` e `visits`. O livro-caixa sobe `finance` a cada escrita (uma vez por lote na importação, não por linha) e o registro do dia sobe `visits` e `finance`. A tela aberta vê o número mudar e busca de novo só os agregados do período (TanStack Query), e as barras animam do valor antigo para o novo. Sem consulta periódica (P11), sem conexão nova e sem valor nenhum trafegando no canal. Se o canal cair, a tela mostra "Reconectando" no lugar de "Ao vivo" e busca tudo ao voltar.

Termos novos para `.claude/memoria/glossario.md`: **Lançamento**, **Livro-caixa**, **Atendimento (espelho)**, **Registro do dia**, **Faturamento estimado** (agenda × preço) e **Recebido** (caixa), **Fechamento**, **Chave do paciente**. ADR `docs/adr/` novo: "Lançamentos sem nome nem CPF; vínculo por contato".

### Arquivos

| Arquivo | Cria ou muda | Para quê |
| --- | --- | --- |
| `packages/shared/src/finance-sheet.ts` | cria | leitura e normalização das linhas (pura) |
| `packages/shared/src/finance-schemas.ts`, `finance.ts` | cria | schemas `zod/mini`, constantes e limites |
| `packages/shared/src/periods.ts` | cria | mês, trimestre, ano, comparação, agrupamento por dia, semana e mês |
| `apps/web/src/pages/management/xlsx-reader.ts` | cria | abre o .xlsx no navegador com `DecompressionStream`, sem biblioteca |
| `apps/web/src/pages/management/*` | cria | telas Atendimentos, Financeiro, Resultados e gráficos em SVG |
| `apps/agent/src/finance/ledger.ts`, `import.ts`, `visits.ts`, `prices.ts`, `metrics.ts`, `reports.ts` | cria | regras do servidor |
| `apps/agent/src/api/finance.ts` | cria | rotas |
| `apps/agent/src/db/migrations.ts` | muda | migration 37 (e seguintes, uma por PR que precisar) |
| `apps/agent/src/backup/export.ts`, `import.ts` | muda | tabelas novas no backup |
| `apps/agent/src/log.ts` | muda | palavras das rotas novas em `ROUTE_WORDS` |
| `apps/agent/test/free-tier-budget.test.ts` | muda | teto de linhas por rota (P1) |
| `packages/shared/i18n/pt-BR-management.ts` e o par en | cria | textos |
| `docs/gestao.md`, `docs/seguranca.md`, `README.md` | cria / muda | documentação |

### Rotas e contratos

Todas com sessão do dono, CSRF, `Cache-Control: no-store`, corpo até `API_BODY_MAX_BYTES`.

| Rota | Entrada | Saída |
| --- | --- | --- |
| `POST /api/finance/imports/check` | impressões das linhas (até 200 por pedido) + resumo | quais já existem, prováveis repetidas, vínculos por CPF (só contagens e índices) |
| `POST /api/finance/imports` | abre a importação: hash do arquivo, período, total | `importId` |
| `POST /api/finance/imports/:id/rows` | lote de até 200 linhas brutas (com nome e CPF, usados só para a chave e o vínculo, descartados em seguida) | gravadas, repetidas |
| `GET /api/finance/imports` | — | histórico |
| `GET /api/finance/entries` | período, tipo, forma, origem, cursor | lançamentos e totais |
| `POST /api/finance/entries`, `PATCH /api/finance/entries/:id`, `POST /api/finance/entries/:id/void` | lançamento manual, correção, anulação com motivo | lançamento |
| `GET /api/finance/visits?day=` | dia | horários com situação, versão e valor |
| `PUT /api/finance/visits/:eventId` | situação, valor, forma, versão | registro novo ou `conflict` |
| `POST /api/finance/visits/:eventId/arrived` | — | hora da chegada |
| `GET/PUT /api/finance/prices`, `GET/PUT /api/finance/expenses` | valor + `validFrom` | lista com vigências |
| `GET /api/finance/results?from=&to=` | janela | séries somadas por dia e por mês, sem dado pessoal |
| `GET /api/finance/reports`, `GET /api/finance/reports/:kind/:period`, `POST …/rebuild` | — | relatórios |

Nome e CPF passam pelo servidor só no corpo do lote de gravação e na memória daquele pedido. Alternativa estudada e descartada: calcular a chave no navegador (exigiria mandar a chave secreta ao navegador).

### Banco

Migration **37** `finance` (número a conferir na `develop` no dia), só de acréscimo:

| Tabela | Colunas principais | Índices |
| --- | --- | --- |
| `zur_fin_entries` | `id`, `day`, `time`, `kind` (in/out), `cents` INTEGER, `method`, `receipt`, `service`, `place`, `description`, `contact_id`, `patient_key`, `source` (import/visit/manual), `import_id`, `event_id`, `row_key` UNIQUE, `voided_at`, `void_reason`, `created_at`, `updated_at` | `(day, id)`; único em `row_key` |
| `zur_fin_imports` | `id`, `file_key`, `from_day`, `to_day`, `rows`, `saved`, `repeated`, `created_at` | — |
| `zur_visits` | `event_id` PK, `calendar_id`, `day`, `start_minute`, `kind`, `place_key`, `contact_id`, `patient_key`, `status` (scheduled, confirmed, attended, missed, cancelled, rescheduled), `arrived_at`, `version`, `recorded_at`, `updated_at` | `(day, start_minute)` |
| `zur_fin_prices` | `place_key`, `place_name`, `valid_from`, `cents` | único `(place_key, valid_from)` |
| `zur_fin_expenses` | `id`, `name`, `type` (fixed, percent, once), `value`, `valid_from` | único `(name, type, valid_from)` |
| `zur_fin_closings` | `month` PK, `data` (JSON das métricas), `closed_at` | — |
| `zur_fin_reports` | `kind`, `period`, `version`, `data`, `created_at`, `seen_at` | PK `(kind, period, version)` |

Dinheiro é sempre `INTEGER` em centavos; percentual em centésimos de ponto. Nenhuma coluna guarda nome, CPF, telefone ou a observação livre.

Volume em 1 ano (consultório com cerca de 200 movimentos e 250 horários por mês): 2.400 lançamentos, 3.000 atendimentos, 12 fechamentos, 17 relatórios. Em 5 anos, menos de 5 MB. Consulta mais cara: o painel de 36 meses, que lê `zur_fin_entries` e `zur_visits` pelo índice de dia (cerca de 16.000 linhas no pior caso) e é servido por fechamentos mensais prontos para os meses já fechados (36 linhas), lendo linha a linha só o mês corrente.

**Chave do paciente** (`patient_key`): `HMAC-SHA256(chave derivada, nome normalizado)`. A chave sai de `MCP_CREDENTIAL_KEY` com o rótulo `finance-v1` (mesmo padrão de `google-v1` e `flows-v1`). Serve só para contar "a mesma pessoa voltou" quando não há contato ligado; não dá para voltar dela ao nome, e fora da instalação não vale nada. Quando há `contact_id`, é ele que identifica a pessoa (resolve homônimos).

**Backup**: `zur_fin_*` e `zur_visits` entram (são difíceis de refazer e não têm nome nem CPF). O `contact_id` é o identificador do contato no Google; sem a tabela de contatos (que fica fora do backup) ele não diz quem é.

### Ferramentas do agente

| Nome | Permissão | Limite por turno | O que faz |
| --- | --- | --- | --- |
| `finance_summary` | `read` | 3 | totais de um período (recebido, saídas, saldo, estimado, atendimentos, faltas) |
| `list_finance_entries` | `read` | 2 | até 20 lançamentos de um período, sem contato |
| `get_report` | `read` | 2 | um relatório fechado |

Nenhuma ferramenta grava, importa, anula ou registra atendimento. Os números entram no prompt em `<data source="finance">`. Ficam para a PR G5, depois das telas.

### Agendamentos, IA e integrações externas

- **Espelho da agenda**: divide o agendamento que já existe (P8). A cada despertar atualiza a janela de hoje −1 a +60 dias (1 a 2 chamadas ao Google). O histórico é preenchido uma vez, um mês por despertar, até 36 meses para trás, parando antes de 44 subrequisições; o painel mostra "Histórico até mm/aaaa" enquanto não termina.
- **Relatórios**: no primeiro despertar depois das 07:00 dos dias 1 a 3, fecha o mês anterior e gera o que estiver devido. Cada horário é reivindicado uma vez (mesmo padrão de `slot` das rotinas).
- **Cor do evento**: um `PATCH` no evento depois do registro, com prazo. O mapa situação → cor vem da thread da agenda.
- **IA**: nenhuma chamada. Os destaques do relatório são frases montadas por regra (sem custo e sem risco de número inventado).
- **Avaliações**: lidas de `review_metrics` (S11), sem chamada nova ao Google.

## 8. Custo e cotas do plano Free

Nenhum recurso novo da Cloudflare. Nada com ⚠️.

| Recurso | Uso típico | Pior caso | Folga | Fonte |
| --- | --- | --- | --- | --- |
| Linhas escritas | registro do dia: 9 horários × 6 linhas = 54; importação mensal de 200 linhas × 3 = 600 | importação de 10.000 linhas no dia × 3 (linha + 2 índices) = 30.000 | 70% da cota de 100.000/dia | `docs/arquitetura/orcamento-free-tier.md` |
| Linhas lidas | painel do mês: cerca de 500 | painel de 36 meses sem fechamento: cerca de 16.000 | cota de 5 milhões/dia | idem |
| Requisições | importação de 5.000 linhas: 25 de conferência + 25 de gravação | 100 no dia | cota de 100.000 | idem |
| CPU do objeto | lote de 200 linhas: validação + 200 HMAC, poucos ms | 30 s por requisição | larga | idem |
| CPU do Worker | só repasse | 10 ms | igual às outras rotas | idem |
| Subrequisições | espelho: 1 a 2 por despertar | histórico: até 44, depois para | teto de 50 | idem, P9 |
| Armazenamento | menos de 1 MB por ano | 5 MB em 5 anos | teto de 900 MB | P13 |
| Neurons | 0 | 0 | — | P7 |
| JS inicial | 0 kB (telas e leitor de .xlsx sob demanda, gráficos em SVG próprio) | 0 kB | teto 140,9 kB sem folga | P11, `npm run size` |

A leitura do .xlsx no navegador evita tanto o custo de CPU e memória no objeto quanto uma biblioteca de planilha (as conhecidas passam de 100 kB). O arquivo .xlsx é um zip com XML; `DecompressionStream("deflate-raw")` existe em todos os navegadores atuais, e o leitor próprio fica em poucos kB, num pedaço carregado só ao abrir a importação.

## 9. Segurança e privacidade

Seções de `docs/seguranca.md` a reler: sessão e CSRF, registros, backup, conteúdo guardado é dado. Auditoria: **completa** na G1 (entrada de arquivo e dado sensível) e na G2 (escrita no Google); orientação nas demais.

| Ameaça | Defesa | Teste |
| --- | --- | --- |
| Nome ou CPF de paciente gravado, em log ou no backup | lançamento guarda só `contact_id` e a chave; lote de gravação nunca vai a log (`ROUTE_WORDS`, sem corpo em log); teste percorre o banco depois de uma importação procurando o nome e o CPF sintéticos | integração + segurança |
| Planilha maliciosa (zip-bomba, XML gigante, fórmulas) | teto de 5 MB no arquivo e de 20 MB descompactados, lidos em fluxo; só as partes `sharedStrings` e a primeira aba; o leitor não avalia fórmula, só o valor guardado; 5.000 linhas | unitário com arquivos montados |
| Célula que começa com `=`, `+`, `-`, `@` (injeção em planilha) ou com HTML | texto tratado como texto; a tela escreve com `textContent`; descrição limpa e cortada; exportações futuras prefixam com apóstrofo | unitário + e2e |
| Navegador adulterado manda lote inválido | o servidor roda a mesma normalização e os schemas Zod em cada lote; limites de valor, data e quantidade | contrato |
| Importação repetida ou em duas abas | índice único na impressão da linha; teto diário | integração (n−1, n, n+1) |
| Texto da planilha ou da agenda virando instrução para a IA | ferramentas devolvem só números e rótulos fechados, em `<data source="finance">`; descrição das saídas neutralizada | segurança (injeção) |
| Alguém além do dono vendo o financeiro | só sessão do dono; nenhuma rota pública; nada em `WHILE_LOCKDOWN` | segurança (sem sessão, sem CSRF) |
| Registro trocado por pedido forjado | CSRF, versão do registro, `eventId` conferido contra a agenda do dia | segurança |
| Mensagem de erro revelando dado | erros `{ code, message }` sem eco do conteúdo da linha; "ignoradas" mostra só o número da linha e o motivo | contrato |
| Aviso no Telegram com valores | o aviso diz só que o relatório está pronto | unitário |

LGPD: os dados financeiros são do próprio dono; os de pacientes ficam reduzidos ao vínculo com um contato que ele já mantém. A planilha não é guardada. O dono pode anular lançamentos e desfazer o vínculo de um contato; apagar um contato não apaga o lançamento, só o deixa sem vínculo.

## 10. Testes

| CA | Teste | Camada | Arquivo |
| --- | --- | --- | --- |
| CA1 | conferência com planilha sintética: contagens, totais, motivos, colunas faltando | unitário + e2e | `packages/shared/test/finance-sheet.test.ts`, `tests/e2e/gestao-importar.spec.ts` |
| CA2 | mesma planilha duas vezes; períodos sobrepostos; duas linhas idênticas; queda no meio e retomada | integração | `apps/agent/test/finance-import.test.ts` |
| CA3 | tabela de valores (vírgula, milhar, `R$`, negativo, número, vazio, texto) | unitário | `finance-sheet.test.ts` |
| CA4 | tabela de datas (formatos, 29/02, 31/04, 1999, amanhã, série do Excel) e horas | unitário | idem |
| CA5 | varredura do banco, dos logs e do backup por nome e CPF sintéticos | segurança | `apps/agent/test/security/finance-privacy.test.ts` |
| CA6, CA7 | registrar, alterar, valor só quando permitido, lançamento único por evento | integração + e2e | `apps/agent/test/visits.test.ts`, `tests/e2e/gestao-atendimentos.spec.ts` |
| CA8 | dois pedidos com a mesma versão | integração | `visits.test.ts` |
| CA9 | cor trocada; Google falha e o registro fica | integração | idem |
| CA10 | mesmo valor na mesma data; mudança sem data; mês fechado não muda | integração | `apps/agent/test/finance-prices.test.ts` |
| CA11 | cada período e agrupamento; comparação; tabela igual ao gráfico | unitário + e2e + axe | `packages/shared/test/periods.test.ts`, `tests/e2e/gestao-resultados.spec.ts` |
| CA12 | relógio nos dias 1, 2 e 3; abril, julho, outubro e janeiro; uma vez só; virada de ano | integração | `apps/agent/test/finance-reports.test.ts` |
| CA13 | preço por vigência, retorno, local sem preço, falta, duplicado na agenda | unitário | `apps/agent/test/finance-metrics.test.ts` |
| CA14 | dois contatos com o mesmo nome; sem contato; CPF em dois contatos | unitário | idem |
| CA15 | estados de tela, teclado, leitor de tela, celular, temas, en | e2e + axe + i18n | specs acima |
| CA16 | `npm run size` e orçamento de linhas por rota | regressão | `apps/agent/test/free-tier-budget.test.ts` |

Limites exatos com n−1, n e n+1: 5 MB, 5.000 linhas, 10.000 por dia, lote de 200, R$ 100.000,00, 80 e 60 caracteres, 365 dias, percentual 99,99. Todos os dados de teste são sintéticos, com CPFs de teste válidos gerados no próprio teste.

## 11. Entrega

- **Ordem** (cada PR mescla sozinha):
  - **G1 · Financeiro**: migration, livro-caixa, lançamento manual e importação da planilha com conferência.
  - **G2 · Atendimentos**: tela do dia, registro, chegada, lançamento ligado e cor no Google (depois do mapa de cores da thread da agenda).
  - **G3 · Preços, despesas e espelho da agenda**: vigências e o preenchimento do histórico.
  - **G4 · Resultados**: painel com filtros e gráficos.
  - **G5 · Relatórios e conversa**: fechamentos, relatórios, aviso e ferramentas de leitura.
- **Capturas:** cada tela em computador e celular, claro e escuro, ao lado do protótipo.
- **Docs:** `docs/gestao.md` (novo), `docs/seguranca.md`, `docs/arquitetura/orcamento-free-tier.md`, `README.md` ("O que já funciona" e mapa).
- **Changelog:** `changelog/nao-lancado/gestao-<parte>.md` em cada PR.
- **Instalação:** nada novo (usa `MCP_CREDENTIAL_KEY`, já exigida).
- **Portabilidade:** nenhum binding novo.

## 12. Riscos

| Risco | Chance | Impacto | O que fazemos |
| --- | --- | --- | --- |
| A planilha real ter colunas ou formatos que o fluxo antigo não previa | média | importação recusa ou ignora linhas | a conferência mostra o motivo por linha; variações de cabeçalho num só lugar; o Pablo testa com a planilha dele antes de gravar |
| Pagamento contado duas vezes (registrado no dia e depois importado) | média | caixa inflado | "prováveis repetidas" desmarcadas na conferência; origem visível em cada lançamento |
| Eventos antigos fora do padrão "Consulta \| Local" | alta | histórico subcontado | quadro "Qualidade dos dados" com a contagem por mês; nada é adivinhado |
| Homônimos sem contato ligado contados como uma pessoa | baixa | "pacientes novos" um pouco abaixo | aviso de qualidade; ligar o contato corrige |
| Leitor de .xlsx próprio falhar em arquivo exportado por outro programa | média | não lê | mensagem clara e saída por .csv; testes com arquivos gerados por Excel, LibreOffice e Google Planilhas |
| Preenchimento do histórico gastar a cota do Google | baixa | atraso | um mês por despertar, com parada antes de 44 subrequisições |
| Outra thread usar a migration 37 antes | média | conflito | conferir a `develop` e as PRs abertas antes de numerar |

## 13. Suposições

- Um só livro-caixa com a origem em cada lançamento, em vez das três fontes separadas do n8n (planilha, pagamentos do painel, estimado). "Recebido" é o caixa; "faturamento estimado" continua à parte, porque responde outra pergunta (quanto a agenda deveria ter rendido).
- A planilha é lida no navegador; o servidor refaz a validação por lote.
- Limite de 5.000 linhas por arquivo e 10.000 por dia, no lugar das 20.000 do fluxo, para caber com folga na cota diária de escritas.
- As regras de leitura do evento são as de `appointments.ts` (já em produção na ficha do contato), não uma cópia das do n8n.
- Sem "dia encerrado que esconde os dados": aquilo protegia uma página aberta na recepção. Na Zuri a tela já exige a sessão do dono.
- Sem registro de IP por acesso ao painel: a atividade de acesso da Zuri já cobre.
- Os destaques dos relatórios são escritos por regra, sem IA.
- Custos de IA ficam fora das despesas.
- Os nomes "Gestão", "Atendimentos", "Financeiro" e "Resultados" são proposta; o menu fecha na outra thread.

## 14. Entrevista com o Pablo

| Data | Pergunta | Resposta |
| --- | --- | --- |
| 12/11/2026 | 1. Nome e CPF da planilha: a Zuri **não guarda** nos lançamentos; liga ao contato do Google quando o CPF bate com um só e, sem isso, o lançamento fica "sem contato". Recomendo assim (igual ao que o fluxo fazia). A outra saída é guardar o nome cifrado para aparecer mesmo sem contato. | aguardando |
| 12/11/2026 | 2. Atendimentos: só você registra presença e pagamento, dentro da Zuri. Recomendo assim. Abrir a tela para a recepção pede outro tipo de acesso e um estudo de segurança à parte. | aguardando |
| 12/11/2026 | 3. Relatórios ficam dentro da Zuri, com aviso na central e no Telegram (sem valores no aviso). Recomendo assim; o e-mail pode vir depois. | aguardando |
| 12/11/2026 | Retorno do Pablo sobre o protótipo: muita informação na tela e encaixe desproporcional; Resultados só com o financeiro; painel de presença mais organizado; gráficos atualizados em tempo real. | Atendido na segunda versão do protótipo: seções 3 (CA6, CA11, CA17), 5 (fluxos 3, 4 e 5) e 7 (Tempo real). Aguardando a aprovação dele. |
| 12/11/2026 | Segundo retorno do Pablo: faltava a situação "Reagendou"; botão de privacidade para ocultar valores; tirar "Ver tabela" e mostrar os gráficos por período (semana ou mês como padrão). | Atendido na terceira versão do protótipo: CA6, CA11, CA18 e fluxos 3 e 4. Mês é o padrão. Aguardando a aprovação dele. |

### Perguntas abertas

- As três acima. Nenhuma implementação começa antes da aprovação do protótipo.
- Para a G3 (não bloqueia agora): os preços por local e as despesas mensais iniciais, que o Pablo cadastra na própria tela.
