### Corrigido

- **Update PRs vermelho quando o GitHub demora a criar a CI.** Depois de
  trazer a `develop` para uma PR, a automação aprova as execuções da CI que o
  próprio push cria. Na #210 o GitHub levou 9 minutos para criá-las, bem mais
  que os 2 minutos de espera: a rodada terminava vermelha, abria issue de falha
  e a PR ficava com a CI parada esperando aprovação. Agora a PR cuja CI ainda
  não apareceu fica para o fim da rodada, e a automação espera por todas juntas
  até 15 minutos depois de cada push, dentro do tempo do job.
