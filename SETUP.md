# Setup e Execução

## Pré-requisitos

| Ferramenta | Versão | Uso |
| --- | --- | --- |
| Node.js | `>= 22.12.0` (ver `.nvmrc`) | Frontend e backend |
| npm | incluído no Node.js | Dependências JavaScript |
| Python | `>= 3.10` | Modelos, gerador sintético e agente de usabilidade |

Dependências Python: `src/modelo/requirements.txt` para os modelos e `src/usability-agent/requirements.txt` para o agente. O gerador sintético usa só a biblioteca padrão.

## Variáveis de Ambiente

O site funciona sem nenhuma variável. Cada componente lê o próprio arquivo:

| Variável | Arquivo | Componente | Obrigatória |
| --- | --- | --- | --- |
| `VITE_API_BASE_URL` | `src/frontend/.env.local` | Frontend | Não; vazia usa os mocks locais |
| `VITE_COPILOT_API_URL` | `src/frontend/.env.local` | Frontend | Não; vazia usa o copiloto determinístico |
| `COPILOT_PROXY_TARGET` | `src/frontend/.env.local` | Proxy do Vite | Não |
| `OPENAI_API_KEY` | `src/backend/.env` | Backend do copiloto | Sim, para chamar a OpenAI |
| `OPENAI_MODEL`, `PORT`, `OPENAI_TIMEOUT_MS`, `COPILOT_ALLOWED_ORIGINS` | `src/backend/.env` | Backend do copiloto | Não |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | ambiente do processo (ver `.env.example`) | Agente de usabilidade | Sim, exceto no dry-run |

> **Nunca commite arquivos `.env` com credenciais reais.** Não use `VITE_OPENAI_API_KEY`: toda variável `VITE_*` é entregue ao navegador.

## Instalação

Na raiz do repositório:

```bash
cd src/frontend && npm ci && cd ../..
```

Opcionais:

```bash
cd src/backend && npm ci && cd ../..                                   # copiloto com OpenAI
python -m pip install -r src/modelo/requirements.txt                   # retreinar os modelos
cd src/usability-agent && python -m venv .venv && source .venv/bin/activate \
  && python -m pip install -r requirements.txt && python -m playwright install chromium && cd ../..
```

No Windows, ative o ambiente do agente com `.\.venv\Scripts\Activate.ps1`.

## Execução

### 1. Site

```bash
cd src/frontend
npm run dev -- --host 127.0.0.1
```

Acesse `http://127.0.0.1:5173`, clique em **Entrar como Advogado** e abra um processo. O score de defesa aparece no card de recomendação.

### 2. Copiloto com OpenAI (opcional)

```bash
cp src/backend/.env.example src/backend/.env        # preencha OPENAI_API_KEY
cp src/frontend/.env.example src/frontend/.env.local
cd src/backend
npm run dev
```

O backend fica em `http://127.0.0.1:8787`. Em outro terminal, inicie o site normalmente: o proxy do Vite encaminha `/api/copilot` ao backend.

### 3. Modelos (opcional)

```bash
python src/modelo/taxa_de_risco/treinar.py     # ~25 s · probabilidade de perda e score de defesa
python src/modelo/condenacao/analise.py        # ~2 min · valor da condenação
python src/modelo/valor_oferta/analise.py      # ~3 min · valor de oferta
```

O site usa os coeficientes de `src/frontend/src/lib/riskModel.ts`. Ao retreinar, copie os números de `src/modelo/taxa_de_risco/resultados/modelo.json`.

### 4. Gerador sintético de aderência (opcional)

```bash
python src/synthetic_adherence.py
python src/synthetic_adherence.py --limit 500 --seed 7 --output-csv data/local/sample.csv --output-json data/local/sample.json
```

Gera `data/synthetic_adherence.csv` (local) e atualiza `data/synthetic_adherence_summary.json`. Metodologia em [`docs/behavioral_adherence_model.md`](docs/behavioral_adherence_model.md).

### 5. Agente de usabilidade (opcional)

Com o site ativo, em outro terminal:

```bash
cd src/usability-agent
source .venv/bin/activate
export OPENAI_API_KEY="sua-chave"
python run_test.py              # ou python run_test.py --dry-run, sem chamar a OpenAI
```

### Verificações

```bash
cd src/frontend && npm run lint && npm test && npm run build && cd ../..
cd src/backend && npm run check && npm test && cd ../..
python -m unittest discover -s src/tests
cd src/usability-agent && python -m unittest discover -s tests -v && cd ../..
```

## Dados

A planilha do desafio fica em `data/Hackaton_Enter_Base_Candidatos.xlsx`. Os 2 processos de exemplo ficam em `data/processos_exemplo/` (local, ignorado pelo Git), e o site usa as próprias cópias dos PDFs em `src/frontend/public/demo-cases/`. Consulte [`data/README.md`](./data/README.md).

## Estrutura do Projeto

```
├── src/          # código-fonte: frontend, backend, modelos, agente e gerador
├── data/         # planilha do desafio, snapshot agregado e processos de exemplo
├── docs/         # enunciado, documentação e apresentação
├── .env.example  # variáveis de ambiente necessárias
├── SETUP.md      # este arquivo
└── README.md     # descrição da solução
```

## Solução de problemas

- **Vite informa versão incompatível:** confirme `node --version`; a versão esperada está em `.nvmrc`.
- **Porta 5173 ocupada:** rode o Vite em outra porta e passe a mesma URL ao agente com `--base-url`.
- **Chromium não encontrado:** rode `python -m playwright install chromium` no ambiente do agente.
- **Chave não encontrada pelo agente:** defina `OPENAI_API_KEY` no mesmo terminal que executa `run_test.py`.
