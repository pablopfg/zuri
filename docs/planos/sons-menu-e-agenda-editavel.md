# Plano · Sons, áudio de 2 minutos, menu por áreas e agenda que edita

Situação: aprovado em 12/11/2026 (o Pablo seguiu as três recomendações; implementação nas quatro entregas da seção 11)
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
| 1. Áudio de 120 s e sons | em revisão |
| 2. Situação por cor, feriados e fins de semana | a fazer |
| 3. Arrastar, duração, desfazer e avisos de sincronização | a fazer |
| 4. Menu por áreas | a fazer |

### Diferenças da entrega 1

- **O som acompanha o sino, não um canal próprio.** Os avisos não passam pelo canal de tempo real (ele só leva os números das áreas), então o som toca quando o número do sino sobe: ao voltar para a aba ou no sinal de presença, até um minuto depois. Tocar na hora pede uma coluna nova em `zur_area_versions` (migration), que ficou fora desta entrega.
- **O som conta pelo número do sino.** Se entre duas leituras o Pablo ler um aviso e chegar outro, o número fica igual e esse aviso chega sem som. Some junto com o item acima, quando os avisos tiverem o próprio número no canal de tempo real. Gravar nos primeiros instantes depois de abrir a Zuri, antes de as configurações chegarem, usa o padrão (toque ligado).
- **121 segundos é recusado de verdade.** O servidor aceitava um segundo além do limite, por arredondamento. Como o navegador nunca manda mais que o limite, a folga saiu: 120 passa, 120,1 não. A recusa vale para a duração que o navegador informa; a duração real continua limitada pelos 2 MB do arquivo e é cobrada pelo que o modelo ouvir, como já era.
- **Relógio da gravação em minutos:** "Gravando: 0:03 de 2:00", como no protótipo.
- **Preferência dos sons no backup**, como as da Agenda.
- **Teto do JS inicial em 141 kB**, o topo do que o Pablo aprovou em 10/11/2026: o som acrescenta 33 bytes ao primeiro carregamento (dois nomes na lista de arquivos) e deixaria 9 bytes de folga no teto de 140,9 kB.
- **"Testar um aviso agora"** toca o som escolhido e mostra uma confirmação, sem criar um aviso de verdade.
- **Suposição ainda aberta:** falta o Pablo gravar um áudio real de 2 minutos depois do primeiro deploy para conferir a transcrição (seção 13). Em desenvolvimento a transcrição é simulada.

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

Nenhuma.
