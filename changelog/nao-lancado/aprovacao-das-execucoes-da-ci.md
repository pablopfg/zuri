### Corrigido

- **Automações do GitHub que terminavam vermelhas por engano.** O Update PRs,
  o README e o Versão aprovam as execuções da CI que o próprio push cria. Às
  vezes o GitHub levava mais de 40 s para criar uma delas, respondia erro para
  uma aprovação que tinha aceitado ou recusava uma que passava segundos
  depois. A automação terminava vermelha e abria uma issue de falha sem
  motivo real. Agora ela espera até 2 minutos pelas execuções e tenta cada
  aprovação até 3 vezes, relendo a execução antes de cada nova tentativa: se
  já saiu da espera, conta como aprovada. Quando falha de verdade, o log
  mostra a resposta do GitHub.
