# E-mail para pacientes

Configurações › Integrações › **E-mail para pacientes** define por onde saem os e-mails que a Zuri manda aos pacientes, como a confirmação de consulta. Este cartão só configura o canal: o que vai no e-mail e quando ele sai ficam com quem envia (a confirmação, na entrega E7).

## Duas formas de enviar

| Forma | Como liga | O que fica guardado |
| --- | --- | --- |
| **Gmail** (recomendado) | **Conectar o Gmail** abre a página do Google, que pede só a permissão de enviar (`gmail.send`), na mesma conta Google da Agenda | Nenhuma senha. O Google entrega como você e assina o e-mail (SPF e DKIM), então cai menos no spam |
| **Outro provedor (SMTP)** | Servidor, porta (465 com TLS desde o início, ou 587 com STARTTLS), usuário, senha de app e, se quiser, outro e-mail de remetente | A senha de app, cifrada, que nunca volta para a tela (aparece só o final, quando ela tem 12 caracteres ou mais) |

A Zuri não lê, não apaga e não vê a caixa do Gmail. Para tirar a permissão, use **Desconectar** no cartão (o envio para) e revogue na sua conta Google, se quiser.

Nos dois casos, **Nome do remetente** (em branco, vai o nome do consultório de Configurações › Consultório) e **Responder para** (para onde vão as respostas dos pacientes) valem para todo e-mail. A linha "De:" mostra como o paciente vai ver.

## Enviar teste para você

O botão manda um e-mail curto para o e-mail do dono (o da entrada na Zuri) pela forma salva. Se não der certo, o aviso diz o motivo: senha recusada, servidor sem TLS na 587, servidor fora do ar ou lento, permissão do Gmail retirada, teto do dia. As palavras do servidor nunca chegam à tela.

## Limites

| O quê | Limite |
| --- | --- |
| E-mails por dia (fuso do dono, o teste conta) | 100 |
| Testes | 3 a cada 10 minutos e 10 por dia (o teto dos testes fica à parte, então eles nunca gastam mais que 10 dos 100) |
| Prazo de um envio por SMTP | 15 s |
| Nome do remetente | 60 caracteres, uma linha, sem `<`, `>`, aspas nem `\` |
| Endereços | 120 caracteres, parte antes do `@` até 64 |
| Senha de app | 1 a 200 caracteres imprimíveis |

## Segurança

- Salvar pede a senha recente. Mudar a forma de envio, o servidor, o usuário, o remetente, a porta, a senha, o nome do remetente ou o "Responder para" também gera um aviso de segurança, porque decide de quem o paciente acha que o e-mail vem e para onde vão as respostas.
- Trocar o servidor ou o usuário pede a senha de app de novo: a senha fica presa ao servidor e ao usuário com que foi salva e não abre para outro.
- O servidor precisa ser um nome público. IP, `localhost` e nomes de rede interna são recusados, e o nome é conferido de novo a cada envio (se passar a apontar para uma rede interna, o envio para).
- Na porta 587, sem STARTTLS aceito o envio para antes de mandar usuário ou senha. Só `AUTH PLAIN` e `AUTH LOGIN`, sempre dentro do TLS.
- Nada do que se digita vira cabeçalho novo: quebras de linha e caracteres de controle são recusados, e o nome e o assunto com acento saem codificados.
- Durante um bloqueio (/bloquear), nenhum e-mail sai.
- O destinatário precisa ser um endereço simples: quebra de linha ou um segundo endereço nunca chega a um cabeçalho nem a um comando.
- A resposta do servidor é lida até 8 KB e 100 linhas; acima disso, o envio para.
- O backup não leva a senha nem a configuração do e-mail.

Plano completo: [email-para-pacientes.md](https://github.com/pablopfg/Zuri/blob/develop/docs/planos/email-para-pacientes.md).
