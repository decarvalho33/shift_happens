# Código-fonte

Toda a solução fica nesta pasta. Cada parte tem o próprio README.

| Pasta ou arquivo | O que é |
| --- | --- |
| [frontend/](frontend/README.md) | Aplicação React/Vite: mesa do advogado (recomendação, score de defesa, evidências, decisão e negociação) e visão administrativa |
| [backend/](backend/README.md) | API do copiloto integrada à OpenAI |
| [modelo/taxa_de_risco/](modelo/taxa_de_risco/README.md) | Regressão logística da probabilidade de perda e score de defesa |
| [modelo/condenacao/](modelo/condenacao/README.md) | Comparação de modelos para o valor da condenação |
| [modelo/valor_oferta/](modelo/valor_oferta/README.md) | Valor típico de acordo com bootstrap |
| [usability-agent/](usability-agent/README.md) | Agente que testa a usabilidade do site simulando um advogado |
| [synthetic_adherence.py](synthetic_adherence.py) | Gerador da camada sintética de aderência dos advogados |
| [adherence_dashboard.py](adherence_dashboard.py) | Legado desativado; encerra e direciona para o frontend |
| [tests/](tests/) | Testes do gerador sintético |

## Relação com a organização sugerida no template

| Sugestão | Onde está |
| --- | --- |
| `policy/`: regras de decisão e sugestão de valor | `modelo/` e `frontend/src/lib/riskModel.ts`, que calcula o score no site |
| `interface/`: acesso do advogado à recomendação | `frontend/` e `backend/` |
| `utils/`: utilitários compartilhados | `synthetic_adherence.py` |

## Gerador sintético de aderência

Requisitos: Python `>= 3.10`, sem dependências externas, e `data/Hackaton_Enter_Base_Candidatos.xlsx`, salvo se outro caminho for informado.

Na raiz do repositório:

```bash
python src/synthetic_adherence.py
python src/synthetic_adherence.py --limit 500 --seed 7 --output-csv data/local/sample.csv --output-json data/local/sample.json
python -m unittest discover -s src/tests
```

O gerador grava `data/synthetic_adherence.csv` (local, ignorado pelo Git) e `data/synthetic_adherence_summary.json` (snapshot versionado). As opções `--xlsx`, `--output-csv` e `--output-json` alteram os caminhos padrão. A metodologia está em [docs/behavioral_adherence_model.md](../docs/behavioral_adherence_model.md).
