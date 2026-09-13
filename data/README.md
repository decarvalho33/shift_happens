# Dados

Arquivos de dados do desafio e artefatos demonstrativos da solução.

## Conteúdo

| Caminho | Versionamento | Descrição |
| --- | --- | --- |
| `Hackaton_Enter_Base_Candidatos.xlsx` | Versionado | Planilha do desafio: 60.000 sentenças (aba “Resultados dos processos”) e subsídios fornecidos por processo (aba “Subsídios disponibilizados”) |
| [synthetic_adherence_summary.json](synthetic_adherence_summary.json) | Versionado | Snapshot agregado da camada sintética de aderência |
| `processos_exemplo/processo_01/`, `processo_02/` | Ignorado | Os 2 processos de exemplo do desafio, com `autos/` e `subsidios/` |
| `synthetic_adherence.csv` | Ignorado | Saída detalhada gerada localmente pelo simulador |
| `local/` | Ignorado | Execuções exploratórias e amostras descartáveis |

Os PDFs dos 2 processos de exemplo que o site exibe ficam em `src/frontend/public/demo-cases/`, para que a demonstração funcione sem esta pasta.

## Quem usa a planilha

| Componente | Comando, a partir da raiz |
| --- | --- |
| Taxa de risco | `python src/modelo/taxa_de_risco/treinar.py` |
| Valor da condenação | `python src/modelo/condenacao/analise.py` |
| Valor de oferta | `python src/modelo/valor_oferta/analise.py` |
| Aderência sintética | `python src/synthetic_adherence.py` |

Para uma execução rápida do gerador sem substituir o snapshot oficial:

```bash
python src/synthetic_adherence.py --limit 500 --output-csv data/local/sample.csv --output-json data/local/sample.json
```

## Segurança e privacidade

Não versione dados processuais reais ou identificáveis, documentos jurídicos reais, exports detalhados nem credenciais. `data/*.csv`, `data/subsidios/`, `data/processos_exemplo/` e `data/local/` são bloqueados pelo `.gitignore`.
