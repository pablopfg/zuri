### Adicionado

- Link de confirmação para o paciente: nos detalhes da consulta, **Copiar link** e **Ver como o paciente**. Pelo link, o paciente vê o dia, a hora, o tipo e o endereço do consultório e toca em **Confirmar presença** ou **Cancelar a consulta**. A resposta muda a situação e a cor aqui e no Google e chega em Avisos.
- O quadro **Confirmação do paciente** nos detalhes diz se o paciente já respondeu, e quando.
- O paciente fala com a equipe pelo WhatsApp do consultório, com a mensagem pronta.

### Segurança

- O link tem um código difícil de adivinhar, guardado só como hash, e vale até 1 hora antes da consulta. Abrir só mostra; só um toque muda algo. A página mostra só o primeiro nome do paciente, nunca o telefone nem o e-mail. Tentativas demais pela mesma rede são barradas por um tempo.
- Cancelar pelo link vai até 12 horas antes e só até o dia anterior, e desliga o link para sempre.
- Trocar o WhatsApp do consultório pede a senha de novo e gera aviso de segurança.

### Atualização

- A migration 45 cria a tabela dos links de confirmação. Nada muda nos dados que já existem. Com o Cloudflare Access ligado, crie as passagens `c/*`, `api/c/*` e `assets/*` (veja a instalação).
