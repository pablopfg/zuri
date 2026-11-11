### Alterado

- CI: os testes no navegador (`e2e` e `lighthouse`) deixam de rodar em PR que só muda texto (documentação, changelog, memória do agente) ou só o número da versão, como o PR `chore(release)`. Esses PRs ficam prontos em cerca de 5 minutos, em vez de 22 a 29. Qualquer outra mudança roda a suíte inteira, como antes, e os outros checks rodam em todo PR.
