# Backend do Copiloto da Política

Servidor Node.js que implementa as rotas esperadas pelo frontend e usa a OpenAI Responses API com Structured Outputs.

## Configuração

Na raiz do projeto:

```powershell
Copy-Item src/backend/.env.example src/backend/.env
```

Edite `src/backend/.env` e preencha:

```dotenv
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini
```

Nunca coloque a chave em `src/frontend/.env.local` ou em uma variável `VITE_*`.

## Execução

```powershell
cd src/backend
npm install
npm run dev
```

O servidor inicia em `http://127.0.0.1:8787`. Verifique com:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

Em outro terminal, inicie `npm run dev` dentro de `src/frontend`. O arquivo local já aponta `VITE_COPILOT_API_URL` para `/api/copilot`, e o Vite encaminha `/api` ao backend.

## Rotas

- `GET /health`
- `POST /api/copilot/lawyer`
- `POST /api/copilot/admin`

O servidor valida o corpo, carrega o contexto demonstrativo no lado servidor, calcula simulações sem delegar aritmética ao modelo, chama a Responses API e normaliza a resposta para `PolicyCopilotResponse`. A chave nunca é enviada ao navegador.

## Qualidade

```powershell
npm run check
npm test
```

Este backend usa dados fictícios do protótipo e não possui autenticação ou persistência de produção. Antes de usar dados reais, implemente identidade, autorização por caso, auditoria e armazenamento apropriado.
