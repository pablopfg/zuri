# Plano · Sons, áudio de 2 minutos, menu por áreas e agenda que edita

Situação: concluído em 12/11/2026 (o Pablo aprovou as três recomendações; as quatro entregas da seção 11 estão na develop). Ajuste 3b (formulário do agendamento e sinais da sincronização) em protótipo, esperando aprovação.
Origem: pedido do Pablo em 12/11/2026
Dependências: nenhuma PR aberta. A área "Consultório" do menu depende do plano da Gestão do consultório, que corre à parte.

## 1. Resumo

O Pablo pediu cinco ajustes: som quando chega um aviso (três opções para escolher), áudio gravado de até 120 segundos, som ao começar a gravar, um menu lateral que comporte a Gestão do consultório e uma agenda em que dá para clicar, editar e mover os eventos, com cores por situação, fins de semana e feriados marcados e tudo salvo na hora no Google Agenda.

Este plano só fecha o desenho. O protótipo (`docs/planos/modelos-frontend/prototipo-interativo.html`) mostra tudo funcionando; o código do sistema começa depois da aprovação dele. A entrega no sistema sai em quatro PRs pequenas, na ordem da seção 11.

## 2. Contexto no sistema

- **Gravação de áudio.** Um componente só: `apps/web/src/components/voice/VoiceInput.tsx`, com a lógica em `voice.ts` (32 kbps). O limite vem de `VOICE_LIMITS = { maxClipSeconds: 60, maxClipBytes: 2 MB }` em `packages/shared/src/chat.ts`. A transcrição usa `@cf/openai/whisper-large-v3-turbo` e custa 46,63 Neurons por minuto (`TRANSCRIPTION_NEURONS_PER_MINUTE` em `packages/shared/src/ai.ts`). O servidor reserva os segundos antes de chamar o modelo e desconta do teto de uma hora de áudio por dia e do teto de Neurons (`apps/agent/src/ai/metered.ts`). A voz do Telegram usa o mesmo limite.
- **Avisos.** Chegam pelo WebSocket `/api/live` e aparecem em `apps/web/src/components/NotificationCenter.tsx`. Hoje não tocam som. Com o app fechado, saem como notificação do aparelho (`apps/web/src/lib/push.ts`).
- **Menu lateral.** Grupos "Organizar" e "Relacionamento" que recolhem (PR #292), com o estado em `localStorage` (`apps/web/src/lib/sidebar.ts`). O JS inicial está no teto de 140,9 kB (até 141 kB aprovado).
- **Agenda.** `apps/web/src/pages/agenda/AgendaPage.tsx` lê `GET /api/google/events`. O servidor já grava no Google: `POST`, `PATCH` e `DELETE /api/google/events` (`apps/agent/src/api/google.ts`), com o `etag` do evento, e o escopo `calendar.events` já está pedido (`GOOGLE_CALENDAR_SCOPES` em `apps/agent/src/google/service.ts`). **Nenhuma permissão nova do Google é necessária.** A tela já abre o evento e tem um diálogo de edição; faltam arrastar, a situação por cor, os feriados e a marca dos fins de semana. O que muda no Google chega pelo aviso de mudança do próprio Google (canal renovado em `service.ts`) e pela releitura ao voltar para a aba.
- **Decisões que valem aqui:** só mexe em agendas abertas para edição (03/11/2026); o design segue o protótipo (11/11/2026); título do evento é o nome completo do cliente e a observação traz o tipo ("Consulta | Consultório", "Retorno | Consultório"); nomes de exemplo são sempre inventados.

## 3. Objetivo e critérios de aceite

| Nº | Critério | Origem |
| --- | --- | --- |
| CA1 | Com a Zuri aberta, um aviso novo toca o som escolhido, no máximo uma vez a cada 3 segundos. Com o som desligado, nada toca. | Pablo |
| CA2 | Configurações › Avisos mostra três sons com "Ouvir", a escolha e a chave de ligar e desligar. | Pablo |
| CA3 | O áudio grava até 120 segundos; aos 120 para sozinho e transcreve. 121 segundos é recusado pelo servidor. | Pablo |
| CA4 | Ao começar a gravar toca um som curto, e outro ao terminar. A chave em Avisos desliga os dois. | Pablo |
| CA5 | O menu segue a proposta escolhida, no computador e no celular ("Mais"), e a área Consultório só aparece quando existir a primeira tela dela. | Pablo / plano |
| CA6 | Clicar num evento abre os detalhes; dali dá para mudar a situação, editar e apagar. | Pablo |
| CA7 | Arrastar um evento muda o dia e a hora de 15 em 15 minutos; a borda de baixo muda a duração. Pelo teclado, Alt + setas faz o mesmo. No toque, a mudança é pelo "Editar". | Pablo / plano |
| CA8 | Cada mudança é enviada ao Google na hora e a tela mostra "Salvando no Google…" e "Salvo no Google agora". Se o Google recusar ou a rede cair, o evento volta para onde estava e a tela diz o que houve. | Pablo |
| CA9 | A situação (Agendado, Confirmado, Reagendado, Cancelado) é a cor do evento no Google. Mudar a cor lá muda a situação aqui, e o contrário. | Pablo |
| CA10 | Sábados, domingos e feriados nacionais têm fundo diferente nas visões de dia, semana e mês, e o feriado mostra o nome. | Pablo |
| CA11 | Os feriados nacionais estão certos para qualquer ano, sem depender da rede. | Pablo |
| CA12 | Evento de agenda só para leitura não arrasta e não mostra "Editar". | plano (novo) |
| CA13 | "Desfazer" no aviso devolve o evento ao estado anterior, também no Google. | plano (novo) |

## 4. Escopo

**Entra:** os cinco pedidos acima, no protótipo e depois no sistema.

**Não entra:** as telas da Gestão do consultório (plano próprio); som personalizado na notificação do aparelho com o app fechado (o navegador não deixa escolher); feriados estaduais e municipais; mudar "este e os próximos" de um evento que se repete (fica para uma segunda entrega, ver seção 6); arrastar evento de dia inteiro.

## 5. Como funciona para o Pablo

### Fluxo 1 · Som dos avisos

Configurações › Avisos ganha o cartão "Som dos avisos": a chave "Tocar um som quando chegar um aviso", três sons (Sino, Gota, Marimba), cada um com "Ouvir", e "Testar um aviso agora". O som toca quando o aviso chega com a Zuri aberta. Com ela fechada, vale o som de notificação do aparelho.

### Fluxo 2 · Gravar áudio

Ao tocar no microfone, um toque curto de duas notas avisa que a Zuri já está ouvindo. O relógio mostra "0:03 de 2:00". Ao terminar, outro toque, de duas notas descendo. A chave "Som ao começar e ao terminar de gravar um áudio" fica no mesmo cartão.

### Fluxo 3 · Menu por áreas

Três propostas no protótipo (seletor "Menu" na barra escura):

- **A · Grupos por área (recomendada).** O menu de hoje com cinco áreas em ordem: Início e Conversa; Meu dia (Tarefas, Agenda, Notas); Consultório (Painel, Agendamentos, Financeiro, Relatórios); Relacionamento (Contatos, Avaliações, CRM); Assistente (Memória, Rotinas). Cada título recolhe o grupo, como hoje.
- **B · Trilho de áreas.** Uma coluna estreita com um ícone por área e, ao lado, só as telas da área aberta. Aguenta muitas telas, mas esconde o resto e custa um clique a mais.
- **C · Dois espaços.** Um seletor "Pessoal | Consultório" troca a lista inteira. Separa bem a vida pessoal do consultório, mas a Agenda e os Contatos servem aos dois lados e ficariam longe um do outro.

No celular, "Mais" lista as telas pelas mesmas áreas.

### Fluxo 4 · Agenda

- **Clicar** num evento abre os detalhes: quatro botões de situação, quando, tipo, agenda, cor no Google, "Editar" e "Apagar".
- **Arrastar** troca o dia e a hora; a borda de baixo muda a duração. Clicar num horário vazio abre "Novo evento" com o dia e a hora preenchidos.
- **Situação e cor:** Agendado = Pavão (azul), Confirmado = Manjericão (verde), Reagendado = Banana (amarelo), Cancelado = Tomate (vermelho, com o nome riscado). São os nomes e as cores do próprio Google Agenda.
- **Mover marca Reagendado:** mudar o dia ou a hora de um atendimento Agendado ou Confirmado troca a situação para Reagendado e o aviso diz isso. Mudar só a duração não troca.
- **Fins de semana e feriados:** fundo cinza no sábado e no domingo, fundo âmbar no feriado, com o nome na linha "Dia todo" (semana), embaixo do número (mês) e numa faixa (dia e celular).
- **Evento que se repete:** antes de mudar, a Zuri pergunta "Mudar só este dia" ou "Mudar este e os próximos".
- **Sempre:** "Salvando no Google…", depois "Salvo no Google agora", e um aviso com "Desfazer".

### Textos visíveis

Os textos do protótipo valem como proposta e entram no catálogo (`packages/shared/i18n`, pt-BR e en) na implementação. Os principais: "Som dos avisos", "Tocar um som quando chegar um aviso", "Som ao começar e ao terminar de gravar um áudio", "Testar um aviso agora", "Salvando no Google…", "Salvo no Google agora", "Em dia com o Google", "Esta agenda é só para leitura. Mude o evento no Google Agenda.", "Este evento se repete toda semana", "Mudar só este dia", "Mudar este e os próximos", "Feriado nacional".

## 6. Regras de negócio e limites

- **Áudio:** `maxClipSeconds` passa de 60 para 120. `maxClipBytes` continua 2 MB (a 32 kbps, 120 s dão cerca de 480 kB). O teto de uma hora de áudio por dia não muda.
- **Som do aviso:** no máximo um som a cada 3 segundos; avisos que chegam juntos tocam uma vez. O navegador só deixa tocar depois do primeiro clique ou toque na página; antes disso o aviso chega mudo.
- **Arrastar:** passos de 15 minutos; duração mínima de 15 minutos; o evento não sai do dia (termina até 24:00) nem do horário visível.
- **Situação:** vale para eventos das agendas abertas para edição. Evento sem cor no Google conta como Agendado. Cor fora das quatro aparece com a cor dela e sem situação.
- **Feriados nacionais:** 1/1, Sexta-feira Santa (calculada pela Páscoa), 21/4, 1/5, 7/9, 12/10, 2/11, 15/11, 20/11 e 25/12. Carnaval e Corpus Christi são ponto facultativo e ficam de fora até o Pablo pedir.
- **Conflito de edição:** toda mudança vai com o `etag` que a tela leu. Se o evento mudou no Google nesse meio tempo, o Google recusa (412), a tela relê a semana, devolve o evento ao estado do Google e avisa "Este evento mudou no Google. Confira e tente de novo."
- **Falha de rede:** a mudança aparece na hora na tela; se o envio falhar, o evento volta e o aviso oferece "Tentar de novo". Nada fica em fila escondida.
- **Desfazer:** disponível por 8 segundos; envia a mudança contrária com o `etag` novo.
- **Evento que se repete:** "só este dia" muda a ocorrência (um `PATCH` no id da ocorrência). "Este e os próximos" exige cortar a série e criar outra (duas chamadas); entra numa segunda entrega, e até lá o diálogo oferece "só este dia" e "todos".
- **Fuso:** dia e hora são sempre os do fuso do dono (`localInstant` no servidor), nunca os do aparelho. O Brasil não tem horário de verão desde 2019, mas a conta usa o fuso, então segue certa se voltar.
- **Convidados:** mover um evento com convidados não manda e-mail a eles pela Zuri (como já é hoje na edição).

## 7. Desenho técnico

### Arquivos

- `packages/shared/src/chat.ts`: `maxClipSeconds: 120`.
- `packages/shared/src/holidays.ts` (novo): `nationalHoliday(date)` com as datas fixas e a Páscoa.
- `packages/shared/src/google.ts`: `colorId` no evento lido e no `googleEventUpdateSchema`; mapa situação ↔ cor.
- `apps/web/src/lib/sounds.ts` (novo, fora do JS inicial): os três sons e os dois toques da gravação, feitos com Web Audio. Nenhum arquivo de áudio entra no repositório.
- `apps/web/src/components/NotificationCenter.tsx` e `voice/voice.ts`: chamam os sons.
- `apps/web/src/pages/settings/`: cartão "Som dos avisos".
- `apps/web/src/pages/agenda/`: arrastar, situação, feriados e fins de semana.
- `apps/web/src/components/` do menu e `lib/sidebar.ts`: áreas novas.

### Rotas e contratos

Sem rota nova. `PATCH /api/google/events` passa a aceitar `colorId` ("5", "7", "10", "11" ou vazio). `GET /api/google/events` devolve `colorId`.

### Banco

Sem migration. A escolha do som e as chaves ficam em `zur_settings` (chave `sounds`), como as preferências da agenda.

### Ferramentas do agente

Sem ferramenta nova. `update_calendar_event` pode ganhar `status` numa entrega seguinte, se o Pablo quiser mudar a situação pela conversa.

### Agendamentos, IA e integrações externas

Nenhum agendamento novo. Google Agenda: as mesmas chamadas de hoje (`events.get` e `events.patch`).

## 8. Custo e cotas do plano Free

- **Áudio de 120 s: sem custo.** Um áudio cheio passa a gastar 93,3 Neurons em vez de 46,6. A cota gratuita é de 10.000 Neurons por dia e o teto da Zuri é 9.000; o teto de uma hora de áudio por dia continua valendo, então o gasto máximo com voz no dia não muda (cerca de 2.800 Neurons). O que muda: a hora do dia rende 30 áudios cheios em vez de 60. Nada troca para modelo pago.
- **Sons:** gerados no navegador. Zero requisição, zero arquivo, cerca de 0,6 kB num pedaço carregado sob demanda.
- **Agenda:** cada mudança são duas chamadas ao Google (ler o `etag` e gravar), dentro do `ACTION_BUDGET` de hoje. A API do Google Agenda é gratuita. Feriados são calculados, sem chamada.
- **Menu:** sem custo. O JS inicial precisa continuar em até 141 kB; os títulos das áreas novas entram por posição no CSS, como na #292.

## 9. Segurança e privacidade

- Sem permissão nova do Google, sem segredo novo, sem dado novo guardado.
- Título e tipo do evento continuam sendo dado: validados com Zod, escapados na tela e nunca viram instrução.
- `colorId` aceita só os valores da lista.
- Arrastar não cria caminho novo de escrita: usa o mesmo `PATCH` com `etag`, sessão e CSRF de hoje.
- Capturas e exemplos só com nomes inventados.

## 10. Testes

- Unitário: feriados de 2024 a 2035 (inclusive a Sexta-feira Santa de cada ano); mapa situação ↔ cor; passos de 15 minutos nos limites (n−1, n, n+1) do dia e da duração mínima.
- Contrato: `PATCH` com `colorId` válido, inválido e ausente; áudio de 119, 120 e 121 segundos.
- Integração (workerd): `etag` velho devolve o erro de "mudou no Google"; falha do Google não muda nada.
- E2E: clicar, mudar a situação, arrastar para outro dia, mudar a duração, desfazer, evento só leitura, evento que se repete, Alt + setas, celular pelo "Editar", falha de rede simulada.
- Acessibilidade: axe nas telas mudadas; evento com nome, tipo, horário e situação no rótulo.
- Protótipo (feito em 12/11/2026): roteiro no navegador cobrindo todos os fluxos acima, sem erro de console, e Biome sem erros no HTML.

## 11. Entrega

1. Áudio de 120 s e sons (avisos e gravação).
2. Agenda: situação por cor, feriados e fins de semana.
3. Agenda: arrastar, mudar a duração, desfazer e os avisos de sincronização.
4. Menu por áreas, na proposta escolhida.

Cada uma com changelog, README, capturas e auditoria, para a `develop`.

### Andamento

| Entrega | Situação |
| --- | --- |
| 1. Áudio de 120 s e sons | mesclada (#315) |
| 2. Situação por cor, feriados e fins de semana | mesclada (#319) |
| 3. Arrastar, duração, desfazer e avisos de sincronização | mesclada (#321) |
| 4. Menu por áreas | mesclada (#322) |
| 3b. Formulário do agendamento, paciente vinculado e sinais da sincronização | protótipo, esperando o Pablo aprovar |

### Diferenças da entrega 1

- **O som acompanha o sino, não um canal próprio.** Os avisos não passam pelo canal de tempo real (ele só leva os números das áreas), então o som toca quando o número do sino sobe: ao voltar para a aba ou no sinal de presença, até um minuto depois. Tocar na hora pede uma coluna nova em `zur_area_versions` (migration), que ficou fora desta entrega.
- **O som conta pelo número do sino.** Se entre duas leituras o Pablo ler um aviso e chegar outro, o número fica igual e esse aviso chega sem som. Some junto com o item acima, quando os avisos tiverem o próprio número no canal de tempo real. Gravar nos primeiros instantes depois de abrir a Zuri, antes de as configurações chegarem, usa o padrão (toque ligado).
- **121 segundos é recusado de verdade.** O servidor aceitava um segundo além do limite, por arredondamento. Como o navegador nunca manda mais que o limite, a folga saiu: 120 passa, 120,1 não. A recusa vale para a duração que o navegador informa; a duração real continua limitada pelos 2 MB do arquivo e é cobrada pelo que o modelo ouvir, como já era.
- **Relógio da gravação em minutos:** "Gravando: 0:03 de 2:00", como no protótipo.
- **Preferência dos sons no backup**, como as da Agenda.
- **Teto do JS inicial em 141 kB**, o topo do que o Pablo aprovou em 10/11/2026: o som acrescenta 33 bytes ao primeiro carregamento (dois nomes na lista de arquivos) e deixaria 9 bytes de folga no teto de 140,9 kB.
- **"Testar um aviso agora"** toca o som escolhido e mostra uma confirmação, sem criar um aviso de verdade.
- **Suposição ainda aberta:** falta o Pablo gravar um áudio real de 2 minutos depois do primeiro deploy para conferir a transcrição (seção 13). Em desenvolvimento a transcrição é simulada.

### Diferenças da entrega 2

- **O que entrou:** situação pela cor nos eventos e nos detalhes (os quatro botões e a linha "Cor no Google"), feriados nacionais e fundo dos sábados, domingos e feriados. `GET /api/google/events` devolve `colorId` e o `PATCH` aceita "5", "7", "10", "11" ou vazio.
- **"Mover marca Reagendado" fica para a entrega 3.** A regra vem junto com o arrastar e com o aviso que diz "Ficou como Reagendado". Até lá, mudar o dia ou a hora pelo "Editar" não troca a situação.
- **O formulário "Editar" não mudou.** Os campos "Tipo", "Dura" e "Situação" do protótipo ficam para a entrega 3, que mexe nesse diálogo. Evento novo nasce sem cor, então conta como Agendado.
- **Agenda só de leitura mantém a cor da agenda.** No protótipo esses eventos são cinza; no sistema há mais de uma agenda e a cor de cada uma já aparece nos botões de baixo, então ela continua valendo para o que não tem situação.
- **A confirmação aparece dentro dos detalhes** ("Situação salva"), não num aviso flutuante: com o diálogo aberto, o resto da página fica fora de alcance do teclado e do leitor de tela.
- **20/11 só é feriado de 2024 em diante**, que é quando a lei passou a valer. Quando a Sexta-feira Santa cai em 21/4, o dia aparece como Sexta-feira Santa.
- **No mês do celular o feriado fica só com o fundo** (o nome é falado pelo leitor de tela e aparece ao abrir o dia). O protótipo põe um ponto; o fundo já diz o mesmo.
- **Fim de semana é sempre sábado e domingo**, mesmo que os dias de trabalho das Configurações sejam outros.
- **O rótulo do evento não traz o tipo** ("Consulta", "Retorno"). Ele continua na descrição, dentro dos detalhes; separar o tipo vem com o campo "Tipo" do formulário, na entrega 3.
- **A legenda** (quatro situações, fim de semana e feriado) fica embaixo da Agenda.
- **A situação aparece escrita, não só pela cor:** depois da hora no bloco da semana e na linha do dia. No mês, onde não cabe, ela é falada pelo leitor de tela e está na legenda.
- **No dia do celular, o sábado ou domingo escolhido fica com a marca de escolhido** (fundo escuro), que vence o cinza do fim de semana; os outros dias da faixa mantêm o fundo.
- **Feriado de outro mês na borda da grade do mês** (1/1 na grade de dezembro) não ganha fundo nem nome escrito, como todo dia fora do mês; o leitor de tela diz o nome.
- **A lista fixa de campos que vai ao Google só aceita a cor se for uma das quatro ou vazio**, venha o pedido de onde vier (auditoria, item informativo).

### Diferenças da entrega 3

- **O que entrou:** arrastar e a borda da duração na semana, Alt com as setas, a linha "Salvando no Google…", "Salvo no Google agora" e "Em dia com o Google", o aviso com "Desfazer" (8 segundos), a volta do evento quando o Google recusa ou a conexão cai, "mover marca Reagendado", os campos Dura, Tipo e Situação no formulário, o tipo no rótulo do evento e o clique num horário vazio. Sem migration e sem rota nova: `POST /api/google/events` passou a aceitar `colorId` (uma das quatro cores), para o evento já nascer com a situação escolhida.
- **Evento que se repete muda só naquele dia, sem pergunta.** O plano previa um diálogo com "só este dia" e "todos". Mudar a série inteira mexe na regra de repetição no Google (mover uma série de quarta para quinta, por exemplo), e errar ali muda todos os atendimentos de uma vez. Nesta entrega a mudança vale só para o dia, e o aviso diz "Só este dia mudou". "Todos" e "este e os próximos" ficam juntos para a segunda entrega já prevista na seção 6.
- **"Mover marca Reagendado" vale para atendimento**, isto é, evento com tipo na descrição ("Consulta | Consultório"), como no protótipo. Uma reunião sem tipo mantém a situação. No "Editar", a situação escolhida à mão vence a regra.
- **O Tipo vem dos eventos da tela.** O protótipo tem três tipos fixos; no sistema a lista traz os tipos que já aparecem nos eventos lidos (e o do próprio evento), mais "Sem tipo". Sem nenhum tipo na tela, o campo não aparece e o tipo pode ser escrito na primeira linha da descrição.
- **"Dura" tem "Outra".** Evento com duração fora da lista (50 minutos, ou que atravessa a noite) abre com "Outra" e os campos de fim, que o formulário já tinha. "Dia inteiro" continua existindo.
- **Pelo teclado a mudança sai quando o Alt é solto**, e não a cada seta: várias setas viram uma mudança só, com um "Desfazer". Alt com Shift muda a duração (o protótipo só movia). Para os lados, só entre os dias que estão na tela. Ctrl + Z (ou ⌘ + Z) desfaz enquanto o aviso oferece.
- **Uma mudança por vez.** Enquanto uma está sendo salva, a seguinte espera, para cada envio levar a versão que o Google acabou de responder: a grade não arrasta, o "Salvar" do formulário fica em espera e o "Tentar de novo" continua na tela. Nenhuma mudança some em silêncio.
- **Mudar só o dia não mexe na hora.** Arrastar para o lado (ou Alt com a seta para o lado) mantém a hora exata, mesmo de um evento fora dos 15 minutos ou que passa do horário da tela. A hora só vai para o quarto de hora quando é ela que muda.
- **Sem "Desfazer" quando a cor de antes não era uma das quatro.** A Zuri só grava as quatro cores de situação, então não teria como devolver uma cor como Uva. Nesse caso o aviso sai sem o botão.
- **O tipo segue a regra do servidor** (a mesma da ficha do contato): linha no formato "Tipo | Lugar", com letra, até 80 caracteres, sem endereço nem marcação; "Consulta" ou "Retorno" vencem outra linha que tenha "|".
- **Arrastar é só na grade da semana.** O dia é uma lista (no computador também) e o mês não tem horas: ali a mudança é pelo "Editar". O protótipo desenha o dia como lista do mesmo jeito.
- **Apagar e trocar a situação nos detalhes não ganharam "Desfazer".** Apagar já pede confirmação, e desfazer exigiria criar outro evento (perderia os convidados). A situação se desfaz com outro toque.
- **A confirmação de "Editar" aparece na página**, porque o formulário fecha antes do envio: o aviso com "Desfazer" fica ao alcance. Se o Google recusar, o aviso diz o motivo e o evento continua como estava.
- **O aviso de falha tem marca própria** (triângulo vermelho, e não o visto verde), e o de conexão fica até ser fechado.
- **Horário em conflito:** o aviso acrescenta "Atenção: há outro evento neste horário", como no protótipo. Não impede a mudança.

### Diferenças da entrega 4

- **O que entrou:** o menu em quatro áreas (Início e Conversa sem título, "Meu dia", "Relacionamento" e "Assistente"), cada título recolhendo o grupo como antes, e o "Mais" do celular com as mesmas áreas. Sem migration e sem rota nova.
- **Consultório fica fora até a primeira tela.** A Gestão do consultório ainda espera aprovação; a lista do menu (`apps/web/src/lib/nav.ts`) marca o lugar dela, entre "Meu dia" e "Relacionamento", e o teste confere que nenhuma área vazia aparece.
- **"Mais" tem "Sistema" só com Configurações.** O protótipo põe ali também "Estados das telas" e "Identidade visual", que são páginas só do protótipo.
- **No "Mais", área sem tela sobrando não aparece.** Tarefas e Agenda ficam na barra de baixo, então "Meu dia" mostra só Notas, e Início e Conversa não ganham título.
- **Grupo recolhido do menu antigo abre de novo.** "Organizar" deixou de existir; quem o tinha recolhido vê o menu aberto na primeira visita.
- **O lugar perdeu o `id`.** Para caber no teto de 141 kB do JS inicial (ficou em 140.989 B), cada lugar do menu passou a se identificar pelo endereço, que já era único. A paleta de comandos usa o endereço como chave.

### Ajustes pedidos depois da entrega 3 (12/11/2026, à tarde)

O Pablo viu a entrega 3 e pediu cinco ajustes, com um print do formulário do outro sistema do consultório como modelo. Pela regra de 12/11, eles entram primeiro no protótipo (bloco "12/11/2026, à tarde" no fim do script de `prototipo-interativo.html`); o código só começa depois da aprovação, numa PR própria (3b).

1. **Horário de 24 horas, sem AM e PM.** Hoje os campos de data e hora são os do navegador, que seguem o idioma do aparelho: num navegador em inglês aparecem "10:00 AM" e "11/12/2026". Eles saem. Data e hora viram campos de texto com máscara: "dd/mm/aaaa" e "hh:mm", de 00:00 a 23:59, sempre. Digitar só números basta (1430 vira 14:30). A hora do início sugere os horários de 15 em 15 minutos, e a do término sugere 15 min, 30 min, 45 min, 1 h, 1 h 30, 2 h e 3 h depois do início.
2. **Duração padrão de 1 hora, ajustável.** O campo "Dura" dá lugar à "Hora do término", como no outro sistema. O término começa 1 h depois do início e acompanha o início quando ele muda, mantendo a duração. Mudar o término ajusta a duração daquele agendamento ("Dura 1 h 30. Voltar para 1 h"). Término antes do início é recusado.
3. **Mesmo padrão do outro sistema.** Ordem dos campos: nome completo do paciente; DDI, celular com DDD e e-mail; data da consulta, hora do início e hora do término; tipo, atendimento (presencial ou online), situação e financeiro; observação. O "Tipo" (Consulta, Retorno, Avaliação física) continua, e o atendimento vira a segunda parte da linha do tipo na descrição ("Consulta | Consultório" ou "Consulta | Online"), a mesma regra que a ficha do contato já lê. Com "Sem tipo" o formulário vira o de um compromisso comum (reunião, curso): título, data, horário, situação e observação, sem paciente, contato nem financeiro.
4. **Sinais da sincronização.** A linha "Em dia com o Google" vira um botão com ícone, cor e nome curto. Ele abre um painel com a situação de agora, o que fazer, as últimas mudanças e "O que cada sinal quer dizer":

   | Sinal | Quando | O que a pessoa pode fazer |
   | --- | --- | --- |
   | ✓ verde, Sincronizado | tudo igual ao Google, com a hora da última conferência | nada |
   | ⟳ azul, Salvando… | uma mudança está indo para o Google | esperar |
   | ✓ verde, Salvo no Google | a última mudança chegou agora | nada |
   | ⟳ azul, Atualizando… | a Zuri está trazendo o que mudou no Google | esperar |
   | Wi-Fi cortado, âmbar, Sem internet | uma mudança não foi enviada e continua na tela, marcada | Tentar de novo |
   | ✕ vermelho, Falha ao salvar | o Google recusou; o evento voltou ao que era | Tentar de novo |
   | ↺ âmbar, Mudou no Google | o evento foi mudado lá enquanto a pessoa mexia aqui; vale a versão de lá | Ver o evento |
   | Ampulheta âmbar, Em pausa | o Google pediu um intervalo depois de muitas mudanças seguidas | nada; a Zuri tenta de novo em 1 min |
   | Nuvem cortada, âmbar, Desatualizada | sem notícias do Google há mais de 15 min | Atualizar agora |
   | Corrente partida, vermelho, Conexão expirou | a Zuri perdeu o acesso ao Google Agenda; nada é lido nem gravado | Conectar de novo (Configurações › Integrações) |
   | Cadeado cinza, Só leitura | eventos de outra agenda, só para leitura | mudar no Google Agenda |

   As cores nunca andam sozinhas: todo sinal tem ícone e nome, e o leitor de tela lê "Sincronização com o Google: Sem internet. Ver detalhes". O aviso com "Desfazer" de cada mudança continua como na entrega 3. No protótipo, o botão "Simular" de cada linha do painel (e o parâmetro `sync=`) mostra cada sinal; ele não vai para o sistema.
5. **Vincular o agendamento ao paciente, ou não.**
   - Ao digitar duas letras do nome, a Zuri procura em Contatos (a cópia que já existe, sem chamar o Google), sem acento e pelo começo de cada palavra ("carla m" acha "Carla Mendes"). Clientes do consultório vêm primeiro. Cada linha mostra o nome, o celular e a última consulta, para separar homônimos. A última linha da lista é sempre "Agendar “nome” sem vínculo".
   - Escolher um contato preenche o nome, o DDI, o celular e o e-mail, que ficam só para leitura com "Vinculado a …" e "Remover vínculo". Os dados continuam sendo os de Contatos: para mudar, o Pablo edita o contato no Google (a Zuri só lê Contatos).
   - Nada se vincula sozinho. Nome igual ao de um único contato mostra "“Paula Régis Amaral” está em Contatos" com o botão "Vincular". Nome igual ao de dois ou mais contatos mostra "2 contatos com este nome" e abre a lista para escolher pelo telefone (regra de homônimos de 12/11: são pessoas diferentes e nunca se ligam sozinhas).
   - Mudar o nome depois de vincular desfaz o vínculo e limpa o celular e o e-mail que vieram do contato, para que os dados de uma pessoa nunca fiquem no agendamento de outra. "Remover vínculo" faz o mesmo.
   - Sem vínculo vale sempre: paciente novo, que ainda não está em Contatos, ou quem o Pablo preferir não ligar. O agendamento fica com o nome e com o celular e o e-mail digitados (o celular é conferido: DDD e número no Brasil). Nos detalhes, um agendamento sem vínculo mostra "Vincular", que abre o formulário já com a busca.
   - **Onde fica cada dado:** o nome continua sendo o título do evento e o tipo continua na primeira linha da descrição, como hoje; a observação vem depois. O vínculo (id do contato), o DDI, o celular, o e-mail e o financeiro vão para as propriedades privadas do evento no Google (`extendedProperties.private`): viajam com o evento, não aparecem no Google Agenda e não pedem tabela nova nem migration. A lista fixa de campos do `PATCH` e do `POST` ganha esses campos, com Zod e limites de tamanho.

**Segunda rodada (12/11/2026, 17:32 UTC).** O Pablo respondeu às perguntas 2 e 3 e pediu mais quatro ajustes, já no protótipo:

- **DDI de todos os países**, com o Brasil primeiro e como padrão ("BR Brasil (+55)", como no outro sistema). O valor guardado é o código do país (BR, PT, US), porque Estados Unidos e Canadá dividem o +1. Os nomes vêm do próprio navegador em português, sem lista de tradução.
- **Celular formatado enquanto se digita:** no Brasil, "(41) 99999-0000" (quem cola "+55 41…" perde o 55); nos outros países, blocos de três números. Trocar o país reformata o que já foi digitado.
- **Homônimos pela data de nascimento também:** cada linha da busca mostra o celular, a data de nascimento e a última consulta, e o vínculo mostra "Vinculado a Carla Mendes, nasc. 02/09/1995". Contato sem data aparece como "sem data de nascimento". No sistema, a cópia de Contatos passa a guardar o aniversário que o Google já tem (o campo novo sobe o `FIELDS_VERSION` de `google/contacts.ts`, que é o que manda regravar os contatos).
- **Financeiro:** "Não pago", "Pago" e "Gratuito".
- **Tipo do evento numa lista só**, que junta o tipo e o atendimento: "Consulta | Consultório", "Consulta | Online", "Retorno | Consultório", "Retorno | Online", "Avaliação física | Consultório", os tipos que já aparecem na agenda, "Outro, digitar" e "Sem tipo (compromisso comum)". O tipo digitado segue "Tipo | Lugar"; sem o lugar, fica "| Consultório". Depois de usado, ele entra na lista. O campo "Atendimento" sai.

**Gestão dentro do protótipo (12/11/2026, 17:48 UTC).** A pedido do Pablo, a área Consultório do menu abre as três telas do protótipo da Gestão (Atendimentos, Financeiro e Resultados), no lugar das telas "Em planejamento". O protótipo principal mostra `prototipo-gestao.html` num quadro, sem o menu e a barra dele, no mesmo tema; o desenho e o plano da Gestão continuam em [gestao-financeira-e-paineis.md](gestao-financeira-e-paineis.md) e na PR #311. Enquanto a #311 não estiver na `develop`, o quadro só abre no protótipo publicado.

**Contato que agenda e contagem dos avisos (12/11/2026, 18:45 UTC).** Mais três pedidos do Pablo, já no protótipo:

- **Ficha do contato só com o que está preenchido.** A linha "Vazio no Google" sai. Campo vazio no Google não aparece.
- **"Agendar" na ficha do contato**, entre "Perguntar à Zuri" e "Telefone". Um toque leva à Agenda e abre "Novo agendamento" já preenchido. A lógica, pensada para não dar erro:
  - Contato com nome: o agendamento já vem vinculado a ele, pelo id. Nome, DDI, celular e e-mail vêm de Contatos e ficam só para leitura, como no "Vincular". Como o vínculo é pelo contato aberto, homônimo não confunde. O foco vai direto para a data.
  - Contato sem nome no Google: não vincula, porque o nome é o título do evento. O celular e o e-mail vêm preenchidos e a Zuri pede o nome completo.
  - Dia e hora: o primeiro horário livre de 1 h a partir de agora, de 30 em 30 min. Precisa ser dia útil, sem feriado nacional, dentro do horário da agenda (08:00 às 18:00 por padrão) e sem outro evento no meio (cancelado não conta). A Agenda abre na semana desse horário. O texto do diálogo diz qual horário foi escolhido e pede para conferir.
  - Já tem consulta marcada daqui para frente: o diálogo avisa ("Atenção: já existe “Consulta | Consultório” em sex, 13/11 às 09:00"), para não marcar duas vezes. O aviso não impede: retorno e consulta na mesma semana são possíveis.
  - Tipo "Consulta | Consultório", situação Agendado e financeiro Não pago, que são os padrões do formulário. Tudo dá para mudar antes de salvar.
  - Cancelar volta para a mesma ficha, com o foco no "Agendar". Agendar fica na Agenda, com o aviso de "Desfazer" de sempre.
  - No celular, "Perguntar à Zuri" e "Agendar" ficam na primeira linha e os três canais (Ligar, WhatsApp, E-mail) na segunda.
  - No sistema: a ficha manda o id do contato pelo endereço (`/agenda?novo=1&contato=<id>`). A Agenda confere que o contato existe na cópia de Contatos antes de vincular. Id que não existe abre o formulário vazio, sem erro. Os dados nunca vão no endereço: só o id.
- **Número de avisos não vistos no sino.** O sino mostra quantos avisos chegaram e ainda não foram vistos (até "99+"), e o título da aba ganha "(3)". O leitor de tela lê "Avisos: 3 não vistos". As regras:
  - Um aviso só conta como visto quando o Pablo abre o sino e o aviso aparece na lista por pelo menos 0,6 s, com mais da metade dele na tela. Abrir e fechar na hora não conta. Aviso que fica abaixo da dobra só conta quando a lista rola até ele.
  - Aviso que chega com o painel aberto entra na lista e conta como visto do mesmo jeito.
  - Push, Telegram e e-mail não contam como visto. Só o sino conta.
  - "Visto" é diferente de "lido". O número do sino é dos não vistos. O destaque verde e "N novos" dentro do painel continuam até o Pablo abrir o aviso ou tocar em "Marcar como lidos", que também marca todos como vistos.
  - No protótipo, o botão "Simular aviso" da barra de cima faz chegar um aviso novo.
  - No sistema: a tabela de avisos ganha a coluna `seen_at`, numa migration nova de acréscimo (a próxima livre, 38 hoje; conferir na `develop`). A interface manda `POST /api/notices/seen` com os ids vistos (lista com Zod, até 50 por vez, só avisos da própria conta). O número vem com a lista de avisos e chega pelo canal ao vivo (`/api/live`), então ver num aparelho zera o sino nos outros. O ícone do app instalado (`navigator.setAppBadge`) mostra o mesmo número onde o navegador permitir. Tudo é texto e um número: o JS inicial não cresce de forma relevante.

**Gestão mais rápida, padrão único e link de confirmação (12/11/2026, 20:53 UTC).** Pedidos do Pablo, já no protótipo:

- **Gestão abria mais devagar.** Causa: a cada clique, o protótipo principal se redesenha e recriava o quadro da Gestão, que baixava e montava a página inteira de novo, sem o esqueleto das outras telas e mostrando o menu próprio dela por um instante. Agora o quadro é um só, carregado em segundo plano logo depois da primeira tela, e fica por cima do espaço da tela. Na primeira visita aparece o mesmo esqueleto das outras telas (0,7 s); da segunda em diante e na troca de aba, abre na hora. No sistema não existe quadro: a Gestão é uma tela como as outras, carregada sob demanda.
- **Gestão no padrão das outras telas:** mesma margem e largura de página, título com o mesmo espaçamento, abas do mesmo tamanho e com ícone (Hoje, Indicadores, A receber, Lançamentos, Importar planilha, Preços e despesas, Painel, Relatórios), cartões com a mesma sombra e etiquetas com o mesmo peso. No celular, as abas de quatro partes ficam em duas linhas, centralizadas.
- **Revisão geral:** todas as telas passaram de novo pelo axe (WCAG A e AA) no computador claro e no celular escuro, sem erro e sem rolagem para o lado. O botão "Apagar" dos diálogos usava uma cor de texto fraca demais no escuro: passou para a cor de alerta de texto.
- **Link de confirmação do agendamento.**
  - **Na Agenda:** os detalhes de cada agendamento com tipo ganham "Confirmação do paciente", com a situação (Link ainda não enviado, Link enviado, Confirmou pelo link, Cancelou pelo link) e três botões: "Enviar pelo WhatsApp" (abre o WhatsApp com a mensagem e o link; o Pablo confere e envia), "Copiar link" e "Ver como o paciente". Sem celular no agendamento, fica só "Copiar link". Agendamento cancelado ou que já passou não oferece envio.
  - **Na página do paciente**, sem login e sem o menu da Zuri, com o nome do consultório: primeiro nome, dia, horário e tipo, e dois botões, "Confirmar presença" e "Não vou poder ir". Cancelar pede um segundo toque ("Sim, cancelar a consulta"). Para mudar o dia ou o horário, a página orienta a falar com a equipe pelo WhatsApp do consultório. Depois de confirmar, ainda dá para cancelar. Depois de cancelar, a página só orienta a falar com a equipe. Fora do prazo (seção seguinte), cancelar pela página dá lugar a "fale com a nossa equipe".
  - **A resposta** muda a situação e a cor do evento no Google (Confirmado, Manjericão; Cancelado, Tomate, que guarda o histórico e não apaga o evento) e chega em Avisos ("Érica Valadão Sena confirmou pelo link").
  - **Estados da página:** link válido (pendente, confirmado, cancelado), consulta que já passou e link inválido. No protótipo, os botões acima do cartão mostram cada um.
- **Lógica e segurança do link (para o código):**
  - **Link sem dado pessoal:** `https://<domínio>/c/<token>`, com 128 bits aleatórios (`crypto.getRandomValues`, 22 caracteres base64url). Um link por agendamento, para a vida toda dele (seção "Link único e expiração" abaixo). O banco guarda o SHA-256 do token para achar o link e o token cifrado para poder reenviar o mesmo endereço, numa tabela nova de acréscimo (`zur_appointment_links`: id do evento, hash, token cifrado, criado em, situação, respondido em, revogado em). Migration nova (a próxima livre, conferir na `develop`).
  - **Abrir não muda nada.** O `GET` só mostra a página: o WhatsApp e outros aplicativos abrem o link sozinhos para montar a prévia, e isso não pode confirmar nem cancelar. Só o `POST` do botão muda, com a ação numa lista fixa (`confirmar` | `cancelar`, Zod), conferência de `Origin` igual ao domínio da Zuri e resposta idempotente (repetir o mesmo toque não faz nada de novo).
  - **Pouco dado na tela:** primeiro nome, dia, horário e tipo. Nunca celular, e-mail, nome completo, observação ou financeiro. A página não carrega nada de fora, tem CSP própria, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer` (o token está no endereço), `Cache-Control: no-store`, e o token nunca vai para os registros.
  - **Validade:** até 1 hora antes do início, e acaba na hora se a consulta for cancelada (seção "Link único e expiração"). Token que não existe ou de evento apagado mostra "Este link não vale mais", sem dizer o motivo, para não servir de teste de tokens. Enviar de novo reenvia o mesmo link.
  - **Evento mudado de dia ou hora:** o link continua o mesmo, mostra o horário novo e volta a pedir a confirmação ("mover marca Reagendado" já tira o Confirmado).
  - **Limites:** por rede, 30 páginas e 10 respostas a cada 10 minutos; por link, 10 respostas por dia. Acima disso, 429 com a mesma página de "tente daqui a pouco".
  - **Gravação no Google:** o `PATCH` de sempre (`colorId` e situação), com etag. Se o Google recusar, a resposta fica guardada, a página diz que recebeu e a Zuri tenta de novo na próxima rodada, com aviso ao Pablo se falhar três vezes.
  - **Envio:** pelo Chatwoot, sozinho, e pelo botão do WhatsApp (seção seguinte, pedido de 21:37 UTC).
  - **Superfície nova:** é a primeira página pública da Zuri além de Entrar. Passa por auditoria de segurança própria, com teste de força bruta nos tokens, prévia de link, `POST` de outra origem e evento apagado.

**Prazo do cancelamento, envio pelo Chatwoot e pelo WhatsApp, dados do consultório (12/11/2026, 21:37 UTC).** Pedidos do Pablo, já no protótipo:

- **Prazo para cancelar pelo link:** até 12 horas antes do início e nunca no dia da consulta, o que vier primeiro. Consulta às 09:00 de sábado: cancela até 21:00 de sexta. Consulta às 20:00 de sábado: até 23:59 de sexta (o dia anterior vence as 12 horas). Confirmar vale até o link expirar, 1 hora antes do início. O prazo é conferido no servidor, no fuso do dono, e a página mostra a data e a hora exatas ("Dá para cancelar por aqui até sexta, 13 de novembro, às 21:00").
- **Página do link, em ordem:**
  - Primeira visita: "Olá, Érica! Confirme sua presença na consulta.", o cartão com dia, horário, tipo (presencial ou online) e endereço do consultório, o botão "Confirmar presença" e o WhatsApp da equipe para mudar o dia ou a hora. Abaixo de uma linha, "Não vou poder ir: cancelar a consulta", para quem já sabe que não vem não ter de confirmar antes.
  - Abrindo o link de novo depois de confirmar: a confirmação em verde e, embaixo, "Não vou mais poder ir: cancelar a consulta".
  - Cancelar sempre abre um aviso que pede a confirmação ("Cancelar a consulta?", com o dia e a hora). O foco começa em "Não, manter a consulta", então Enter ou um toque duplo por engano não cancelam. Só "Sim, cancelar a consulta" cancela. No celular os dois botões ficam um embaixo do outro, com "manter" em cima. O servidor confere o prazo de novo no `POST`.
  - Fora do prazo, o botão de cancelar dá lugar a "O prazo para cancelar por aqui terminou. Fale com a nossa equipe".
- **Dados do consultório num lugar só:** Configurações › Consultório (grupo novo "Consultório") guarda nome, endereço, cidade e WhatsApp da equipe, numa chave de `zur_settings` (`clinic`, Zod: nome até 80, endereço até 160, cidade até 80, telefone no formato brasileiro). A página do link, a mensagem de confirmação, o pedido de avaliação e o perfil em Avaliações leem dali; mudar ali muda em todos, sem cópia guardada em outro lugar. A página do link lê na hora de montar, então um link enviado antes já mostra o endereço novo.
- **Mensagem modelo:** na mesma tela, um texto com variáveis (`{nome}`, `{tipo}`, `{consultorio}`, `{dia}`, `{hora}`, `{local}`, `{link}`, `{prazo}`, `{whatsapp}`), botões para inserir cada uma, prévia ao vivo no balão do WhatsApp e "Voltar ao modelo padrão". Regras, conferidas no servidor com Zod: não vazia, até 1.000 caracteres, com `{link}` obrigatório e só as variáveis da lista (o resto é recusado com o nome da variável). `*texto*` sai em negrito no WhatsApp. O mesmo modelo serve ao Chatwoot e ao botão. A prévia é montada com nós de texto, nunca com `innerHTML`.
- **Envio manual pelo WhatsApp:** nos detalhes do agendamento, "Enviar pelo WhatsApp" é um link `https://wa.me/<DDI+celular>?text=<mensagem>`, com a mensagem do modelo já preenchida (nome, dia, hora, local, link e prazo). Abre o WhatsApp Web ou o aplicativo; o Pablo confere e envia. Ao tocar, a situação vira "Enviado pelo WhatsApp hoje às 21:45" e o envio automático pula esse agendamento. "Copiar mensagem" copia o mesmo texto. Sem celular no agendamento, o botão não aparece.
- **Envio automático pelo Chatwoot (para o código):**
  - **Liga e desliga** em Configurações › Consultório, com a hora do envio (07:00 a 20:00, padrão 07:00) e a credencial do Chatwoot já cadastrada em CRM › Credenciais. O token fica só no servidor, cifrado como as outras credenciais.
  - **Quando:** no último dia útil antes da consulta, na hora escolhida, pelo alarme único. Consulta de segunda sai na sexta; véspera em feriado nacional ou fim de semana recua para o dia útil anterior. Nunca sai no próprio dia, nunca depois do prazo de cancelar e nunca de madrugada.
  - **Quem recebe:** evento com tipo de atendimento (Consulta, Retorno, Avaliação física), situação Agendado ou Reagendado, com celular, com o link ainda valendo e sem envio nem resposta para este horário (regras de não duplicar na seção "Link único e expiração"). A chave de "já enviado" é o id do evento mais o início; mudar o horário permite um envio novo, com o mesmo link.
  - **Passos no Chatwoot** (API de conta, `api_access_token`): procurar o contato pelo celular em E.164 (`GET /contacts/search`), criar se não existir (`POST /contacts`, só nome e telefone), reaproveitar a conversa aberta da caixa ou abrir uma (`POST /conversations`) e enviar a mensagem (`POST /conversations/:id/messages`, `message_type: outgoing`). Caixa do WhatsApp Cloud oficial só aceita mensagem modelo aprovada fora da janela de 24 horas: nesse caso o envio usa o modelo aprovado com as mesmas variáveis, e a tela avisa se a caixa escolhida é desse tipo. Caixa do tipo API manda texto livre.
  - **Ritmo:** uma mensagem por vez, com a espera em segundos da credencial (seção seguinte), no máximo 5 envios por despertar para caber nas 44 subrequisições. O que sobra sai no despertar seguinte, ainda antes do prazo.
  - **Falha:** até 3 tentativas com espera crescente. Depois, um aviso ao Pablo ("Não deu para enviar a confirmação de Érica pelo Chatwoot") com o botão do WhatsApp, e o agendamento mostra "Não foi enviado".
  - **Registro:** cada envio guarda id do evento, início, canal (Chatwoot ou WhatsApp), hora e situação, sem o texto da mensagem e sem o telefone (tabela de acréscimo junto de `zur_appointment_links`, mesma migration).
  - **Regra de produto:** até aqui a Zuri só escrevia a pacientes para pedir avaliação. A confirmação de consulta passa a ser o segundo caso, decidido pelo Pablo, com o mesmo cuidado: só o modelo dele, só pelo Chatwoot, com tetos.

**Link único, expiração e envio sem duplicar (12/11/2026, 22:02 UTC).** Pedidos do Pablo, já no protótipo:

- **Um link por agendamento, sem acesso a outro.**
  - Cada agendamento tem um token só dele (128 bits aleatórios), criado na primeira vez que a mensagem é montada. A tabela tem `UNIQUE` no id do evento e no hash: dois agendamentos nunca dividem um link, e reenviar (WhatsApp ou Chatwoot) usa o mesmo endereço.
  - O servidor acha o agendamento só pelo hash do token. Nenhum id de evento, nome ou telefone vem do navegador: o `POST` leva só o token (no endereço) e a ação (`confirmar` | `cancelar`). Não existe rota que receba um id de evento sem sessão.
  - Antes de mostrar ou mudar, o servidor confere que o evento do link ainda é o mesmo (id e agenda guardados junto) e que o token não foi revogado. Se o evento sumiu, foi para outra agenda ou o token não confere, a página é a de link inválido, sem nenhum dado.
  - A página mostra só o primeiro nome, dia, horário, tipo e o endereço do consultório. A resposta não traz o id do evento nem outro agendamento do mesmo paciente.
  - Testes: token de um agendamento nunca abre outro; `POST` com token de A não muda B; força bruta em tokens dá 429 e a mesma página; o mesmo paciente com duas consultas tem dois links diferentes, cada um só com a sua.
- **O link expira sozinho:**
  - 1 hora antes do início. Depois disso não confirma nem cancela, e a página diz "Este link expirou" e orienta a falar com a equipe.
  - Quando a consulta é cancelada, pelo link ou pela Agenda (cor Tomate). Quem acabou de cancelar vê "Consulta cancelada. Este link deixou de valer." Abrindo de novo, vê "Este link expirou".
  - O servidor confere a expiração a cada abertura e a cada `POST`, pelo horário do evento no Google naquele momento, no fuso do dono. A linha do link é marcada `revoked_at` no cancelamento e não volta a valer, nem se o evento for reaberto (um envio novo, depois de reagendar, gera link novo só nesse caso).
- **Chatwoot sem envio duplicado:** a mensagem é sempre a mensagem modelo de Configurações › Consultório. O Chatwoot NÃO envia quando:
  - o paciente já confirmou pelo link (não precisa de lembrete);
  - a mensagem já foi pelo botão do WhatsApp ou pelo próprio Chatwoot para este horário;
  - a consulta foi cancelada ou o link expirou.
  - A conferência é feita duas vezes: ao montar a fila do dia e de novo, no próprio banco, imediatamente antes de cada envio (o paciente pode confirmar ou o Pablo pode tocar no WhatsApp entre uma mensagem e outra da fila). O registro do envio é gravado antes da chamada ao Chatwoot, com a chave id do evento mais o início como `UNIQUE`: se dois despertares tentarem o mesmo, só um passa.
  - Nos detalhes, quem já confirmou não mostra mais o botão do WhatsApp: "Já confirmou pelo link: não precisa enviar de novo, nem pelo WhatsApp nem pelo Chatwoot."

**Respostas do paciente nas cores, proteção do link e espera entre envios (12/11/2026, 22:11 UTC).** Pedidos do Pablo, já no protótipo:

- **Cada resposta pelo link muda a cor na Agenda e no Google** (o mesmo `PATCH` com `colorId` e etag):
  - Confirmar: Confirmado, Manjericão (verde).
  - Cancelar: Cancelado, Tomate (vermelho). O link expira na hora.
  - Remarcar: Reagendado, Banana (amarelo). A página ganhou "Preciso remarcar", que também pede confirmação num aviso ("Pedir para remarcar?", foco em "Voltar"). O horário continua reservado até a equipe combinar o novo; a página mostra "Pedido recebido. A nossa equipe vai falar com você pelo WhatsApp". O aviso ao Pablo diz "pediu para remarcar", e os detalhes do agendamento trocam o envio da mensagem por "Falar com o paciente" (WhatsApp sem texto pronto). Quando o Pablo move o agendamento, o link continua o mesmo, mostra o novo horário e volta a pedir a confirmação. Escolha minha: o paciente não escolhe o novo horário sozinho, porque o pedido anterior foi "para reagendar, orienta a falar com a equipe".
  - A resposta guardada (`zur_appointment_links.situação`) e a cor do evento andam juntas: se o Google recusar, a Zuri tenta de novo e avisa depois da terceira falha (regra que já estava no plano).
- **Proteção contra descobrir outros agendamentos mexendo no link:**
  - O token é aleatório, 128 bits (22 caracteres base64url), sem relação com o id do evento, a data ou o paciente. Não existe sequência: trocar uma letra cai num token que não existe (chance de acertar um válido é de 1 em 2¹²⁸ por tentativa).
  - O endereço é só `/c/<token>`. Nenhum outro parâmetro é lido: `?id=`, `?evento=`, caminho a mais ou token com tamanho ou caracteres fora do formato (Zod, exatamente 22 de `[A-Za-z0-9_-]`) recebem a mesma página de link inválido, sem tocar no banco.
  - A busca é pelo SHA-256 do token, com índice `UNIQUE`; o token nunca é comparado em texto nem gravado nos registros. A resposta de inválido tem o mesmo tamanho, o mesmo código (404) e um tempo parecido com a de um link que existe mas expirou, para não dar pista.
  - Freio de tentativas: por rede, 30 aberturas e 10 respostas a cada 10 minutos; 5 tokens inválidos em 10 minutos bloqueiam a rede por 1 hora na rota `/c/` (só nela), e a Zuri avisa o Pablo uma vez por dia se isso acontecer.
  - Um link por agendamento (`UNIQUE` no id do evento), e o `POST` só age sobre o evento ligado ao token. Testes: token de A nunca abre nem muda B; tokens vizinhos e alterados dão a página de inválido; parâmetros extras são ignorados; o freio dispara no 6º token inválido.
- **Detalhes do agendamento:** saiu a linha "Expira … ou se a consulta for cancelada" e a lembrança do prazo de cancelamento. Ficam só a situação e as ações.
- **Espera entre envios em massa, em segundos (Chatwoot):**
  - Fica na credencial do Chatwoot (CRM › Credenciais), um lugar só para todas as automações que usam a caixa: "Espera entre envios em massa (segundos)", com "De" e "Até". A Zuri sorteia um valor entre os dois a cada mensagem, para não parecer robô. Padrão de 30 a 60 s; aceita de 5 a 600 s, conferido no servidor (Zod, números inteiros, "De" menor ou igual a "Até").
  - Vale só para mensagens que vão para vários pacientes: confirmações da véspera, pedidos de avaliação e fluxos com várias pessoas. Mensagem para uma pessoa só (por exemplo, um fluxo disparado por um paciente) sai na hora, sem espera.
  - Como funciona no servidor: uma fila por credencial, já existente, com a hora da próxima saída guardada no banco. Cada envio em massa marca `próxima = agora + sorteio(De, Até)`, e o alarme único acorda nessa hora. Assim a espera é respeitada mesmo entre automações diferentes, sem `sleep` e sem segurar o despertar. Até 5 envios por despertar continuam valendo como teto; com espera de 5 s, um despertar pode mandar mais de uma, sempre respeitando a espera entre elas.
  - Substitui o "30 s a 1 min" fixo da decisão de 10/11.

**O que não muda:** arrastar, Alt com as setas, "Desfazer", "mover marca Reagendado", a cor de cada situação e a agenda só de leitura. O primeiro carregamento também não, porque o formulário está no pedaço da Agenda, que carrega sob demanda; a busca usa a lista de Contatos que a tela já lê, sem chamada nova ao Google.

**Perguntas ao Pablo** (seção 14).

## 12. Riscos

- **Som bloqueado pelo navegador** antes do primeiro clique: o aviso chega sem som. Mitigação: o cartão explica e o "Testar" destrava.
- **Áudio longo em navegador que ignora os 32 kbps:** o arquivo pode passar de 2 MB antes dos 120 s. A tela já para e avisa quando passa do tamanho; o teste confere Safari.
- **Arrastar sem querer:** só começa depois de 5 px de movimento, e todo movimento tem "Desfazer".
- **Cor usada para outra coisa hoje:** se a agenda do consultório já usa cores com outro sentido, a situação apareceria errada. Pergunta 3.

## 13. Suposições

- O modelo de transcrição aceita 120 s de uma vez sem perder qualidade. Conferir com um áudio real de 2 minutos na conta do Pablo antes de mesclar a entrega 1.
- A agenda do consultório ainda não usa as cores do Google com outro sentido.

## 14. Entrevista com o Pablo

### Respostas (12/11/2026, 03:25 UTC)

O Pablo respondeu "siga as recomendações":

1. **Som dos avisos:** Sino.
2. **Menu:** proposta A, grupos por área.
3. **Agenda:** as quatro cores valem (Pavão, Manjericão, Banana, Tomate) e mover marca Reagendado sozinho.
4. **Áudio:** sobe para 120 segundos.

### Perguntas abertas

Sobre os ajustes de 12/11 à tarde, com a recomendação entre parênteses:

1. **O protótipo está aprovado?** Formulário, vínculo com o paciente e sinais da sincronização. (Sim, para começar a PR 3b.) Em 12/11, 17:32 UTC, o Pablo pediu para ver antes a segunda rodada de ajustes.
2. ~~Até quando o paciente cancela pelo link?~~ Respondida em 12/11, 21:37 UTC: até 12 horas antes e só até o dia anterior.
3. ~~Quem envia o link?~~ Respondida em 12/11, 21:37 UTC: as duas formas, sozinha pelo Chatwoot e pelo botão do WhatsApp com a mensagem modelo.

Respondidas em 12/11/2026, 17:32 UTC: o Financeiro fica com "Não pago", "Pago" e "Gratuito", guardado no evento; o atendimento online grava "Consulta | Online", e o tipo vira uma lista com "Retorno | Consultório" e a opção de digitar.
