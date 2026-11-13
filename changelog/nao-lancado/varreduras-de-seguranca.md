### Segurança

- Semgrep e Gitleaks rodam em todo PR e em cada mudança da `develop`, como checks obrigatórios. O Semgrep usa as regras de segurança da comunidade fixadas num commit revisado, e o Gitleaks procura chaves, tokens e senhas em todo o histórico do Git. As duas ferramentas são grátis, rodam sem conta e não mandam métricas para fora.
- A análise do SonarQube Cloud roda em todo PR, no plano grátis para código aberto. Ela começa quando o segredo `SONAR_TOKEN` estiver gravado (passo a passo em `docs/qa/varreduras-de-seguranca.md`). ⚠️ Pede uma conta no SonarQube Cloud.
- A auditoria de segurança de cada ajuste passa a usar as skills `differential-review`, `sharp-edges` e `insecure-defaults` da Trail of Bits, fixadas por commit. O pentest com o Strix fica documentado e só roda com autorização do dono. ⚠️ Gasta créditos de IA.
- O verificador de contatos dos agentes de IA ficava lento com texto hostil de terceiros: 60 mil caracteres levavam mais de um minuto de processamento. Agora a leitura cresce em linha reta com o tamanho do texto, nele e na guarda das respostas às Avaliações, e continua achando o contato no fim do texto.
- A análise do SonarQube recebe o token num job que não roda código do PR nem das dependências, com o servidor fixado no workflow.
