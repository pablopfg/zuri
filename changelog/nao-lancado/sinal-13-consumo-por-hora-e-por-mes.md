<!-- versao: minor -->
### Adicionado

- A Zuri passa a guardar o consumo da IA de hoje hora a hora e o do ano mês a mês. O histórico por dia continua indo até 90 dias; o resumo por mês guarda os últimos 12 meses. As opções "Dia" e "Ano" do painel de consumo chegam com a nova tela de Configurações.

### Atualização

- Migration 37: duas tabelas pequenas de contadores, uma com as 24 horas do dia e outra com os 12 meses. Guardam só números, nunca o que foi dito, e ficam fora do backup, como os outros contadores de uso. Não há nada a fazer: na primeira conversa depois de atualizar, a Zuri monta os meses com os dias que ainda tem guardados.
- Cada chamada de IA grava uma linha a mais no banco (a da hora). Continua muito abaixo da cota gratuita.
