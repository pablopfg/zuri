### Segurança

- O hono sobe para a 4.13.16, que corrige cinco falhas publicadas (avisos
  GHSA-4m76-xfj5-7975, GHSA-h7mg-cq63-vhpq, GHSA-4h7h-rv7c-7m2v,
  GHSA-3gg2-335m-rxc6 e GHSA-46wx-v44x-9hh2). Nos testes, nenhuma delas
  deixava pular a autenticação nas rotas da Zuri, mas a correção entra mesmo
  assim.

### Atualização

- Dependências do app: agents 0.32.0, ai 7.0.163, @ai-sdk/anthropic 4.0.97,
  @ai-sdk/openai 4.0.109, @modelcontextprotocol/client 2.4.0,
  eventsource-parser 4.1.3, @tanstack/react-query 5.105.3 e lucide-react
  1.66.0.
- Ferramentas de desenvolvimento: wrangler 4.156.1, @cloudflare/vitest-plugin
  1.4.12, vite 8.3.6, @vitejs/plugin-react 6.2.1, tailwindcss e
  @tailwindcss/vite 4.3.4, Biome 2.6.5 e Lighthouse 13.6.0.
- O teto do JavaScript inicial sobe de 139,6 kB para 139,7 kB (com o OK do
  dono), porque o vite e o react-query novos somam 95 B ao primeiro
  carregamento.
