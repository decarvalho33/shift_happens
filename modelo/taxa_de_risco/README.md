# Taxa de risco processual

Estima, para ações de **não reconhecimento de contratação de empréstimo**, a probabilidade de o banco perder e a condenação esperada. É a base estatística da política de acordos.

```
P(perda)            = σ( intercepto + Σ subsídios juntados + golpe + efeito da UF )
condenação se perder = valor da causa × severidade[UF, sub-assunto]
exposição esperada   = P(perda) × condenação se perder
score de defesa      = 100 × (1 − P(perda))   # 0 = fechar acordo, 100 = pode defender
```

## Como rodar

```bash
pip install -r ../requirements.txt
python treinar.py         # ~25 s · lê ../../Hackaton_Enter_Base_Candidatos.xlsx e grava resultados/
python taxa_de_risco.py   # exemplo de previsão
```

`treinar.py` aceita `--dados` (caminho da planilha) e `--saida` (pasta dos resultados).

```python
from taxa_de_risco import prever_taxa_de_risco

prever_taxa_de_risco(uf="SP", golpe=False, subsidios={"contrato", "extrato"}, valor_causa=15000)
# valores arredondados:
# {'p_perda': 0.0913, 'score_defesa': 91, 'log_odds': -2.2979, 'severidade': 0.6356,
#  'condenacao_se_perder': 9533.48, 'exposicao_esperada': 870.39, 'uf_com_dados': True}
```

Nomes aceitos em `subsidios`: `contrato`, `extrato`, `comprovante`, `dossie`, `demonstrativo`, `laudo`.

## Score de defesa (0 a 100)

Transforma a probabilidade de perder numa nota de 0 a 100: **0 = fechar acordo**, **100 = pode defender**.

```
score de defesa = arredondar( 100 × (1 − P(perda)) )
```

O score é a **chance de o banco ganhar**, em pontos de 0 a 100. Como a P(perda) é calibrada, o score também é: nos processos com score perto de 90, o banco ganhou perto de 90% das vezes.

O cálculo completo tem três passos:

1. **Soma dos pesos (log-odds):** intercepto + peso de cada subsídio juntado + peso do golpe + efeito da UF.
2. **Probabilidade de perder:** P(perda) = 1 ÷ (1 + e^(−soma)).
3. **Score:** 100 × (1 − P(perda)), arredondado.

| Processo | Soma dos pesos | P(perda) | Score |
|---|---|---|---|
| SP, genérico, com contrato e extrato | 3,797 − 3,080 − 2,997 − 0,018 = −2,298 | 9,1% | 91 |
| AM, golpe, com comprovante, demonstrativo e laudo | 3,797 − 1,271 − 0,520 − 0,040 + 1,022 + 0,744 = +3,732 | 97,7% | 2 |

Distribuição na carteira, com a P(perda) fora da amostra:

| Score | Processos | % da carteira | Score médio | Banco ganhou de fato |
|---|---|---|---|---|
| 0 a 20 | 9.433 | 15,8% | 6,9 | 6,7% |
| 21 a 50 | 7.466 | 12,5% | 34,7 | 35,2% |
| 51 a 80 | 6.073 | 10,2% | 65,6 | 65,1% |
| 81 a 95 | 18.522 | 31,0% | 90,6 | 90,6% |
| 96 a 100 | 18.226 | 30,5% | 97,3 | 97,3% |

## Estrutura

### Variável resposta

| Resultado micro | Processos | `perda` |
|---|---|---|
| Procedência | 5.739 | 1 |
| Parcial procedência | 12.248 | 1 |
| Improcedência | 27.935 | 0 |
| Extinção | 13.798 | 0 |
| Acordo | 280 | fora do modelo |

### Variáveis explicativas

| Variável | Codificação |
|---|---|
| 6 subsídios | 1 se o documento foi juntado, 0 se não (aba “Subsídios disponibilizados”) |
| `golpe` | 1 se o sub-assunto é Golpe, 0 se Genérico |
| UF | Soma-zero: cada efeito é o desvio em relação à UF média, e os 26 somam zero. RR não aparece na base e usa efeito 0. |

O **valor da causa não entra em P(perda)**. Foi testado de seis formas (linear, log, quintis, spline, interação com sub-assunto e com nº de subsídios) e nenhuma mudou o log-loss de validação além da 5ª casa decimal. Ele entra só como multiplicador da condenação.

### Ajuste

Máxima verossimilhança por Newton-Raphson, sem regularização, com matriz de covariância para os intervalos de confiança. São 33 parâmetros: intercepto, 6 subsídios, golpe e 25 colunas de UF.

### Severidade

Média de condenação ÷ valor da causa entre as perdas de cada combinação de UF e sub-assunto. Os subsídios não entram porque não explicam a severidade (0,04% da variância, contra 10,7% da UF).

## Resultados

60.000 processos na planilha; 280 acordos excluídos; **59.720 no modelo**, com 17.987 perdas (30,1%).

### Validação cruzada

5 partições estratificadas, semente 7.

| Métrica | Média ± desvio entre partições | Taxa-base |
|---|---|---|
| Log-loss | **0,30785 ± 0,00307** | 0,61187 |
| AUC | **0,9227 ± 0,0012** | 0,5000 |
| Brier | **0,09292 ± 0,00109** | — |

Juntando as previsões fora da amostra das 5 partições: log-loss 0,30785, AUC 0,9226, Brier 0,09292.

| Partição | n de teste | Log-loss | AUC | Brier | Log-loss taxa-base |
|---|---|---|---|---|---|
| 1 | 11.944 | 0,30464 | 0,9236 | 0,09201 | 0,61191 |
| 2 | 11.944 | 0,30954 | 0,9230 | 0,09340 | 0,61191 |
| 3 | 11.944 | 0,30978 | 0,9218 | 0,09403 | 0,61184 |
| 4 | 11.944 | 0,31085 | 0,9210 | 0,09361 | 0,61184 |
| 5 | 11.944 | 0,30442 | 0,9240 | 0,09152 | 0,61184 |

### Coeficientes

Ajuste com a base inteira. Efeito médio = variação média da P(perda) na carteira quando a variável passa de 0 para 1.

| Termo | Variável | Log-odds | IC 95% | Razão de chances | Efeito médio |
|---|---|---|---|---|---|
| Intercepto | `intercepto` | +3,797 | +3,67 a +3,92 | — | — |
| Contrato | `contrato` | −3,080 | −3,14 a −3,02 | × 0,046 | −44,9 p.p. |
| Extrato | `extrato` | −2,997 | −3,07 a −2,93 | × 0,050 | −41,6 p.p. |
| Comprovante de crédito | `comprovante` | −1,271 | −1,32 a −1,22 | × 0,281 | −12,7 p.p. |
| Dossiê | `dossie` | +0,036 | −0,02 a +0,09 | × 1,037 | +0,3 p.p. · IC inclui 0 |
| Demonstrativo da dívida | `demonstrativo` | −0,520 | −0,58 a −0,46 | × 0,594 | −5,0 p.p. |
| Laudo referenciado | `laudo` | −0,040 | −0,11 a +0,03 | × 0,961 | −0,4 p.p. · IC inclui 0 |
| Sub-assunto golpe | `golpe` | +1,022 | +0,96 a +1,08 | × 2,777 | +9,3 p.p. |

- **Contrato** e **extrato** decidem a maior parte do risco.
- **Dossiê** e **laudo** têm efeito indistinguível de zero. A base registra só se o documento foi juntado, não o que ele concluiu. Ficam no modelo com peso quase nulo; para retirá-los, retreine sem eles.
- Golpe aumenta o risco em relação ao sub-assunto genérico.

### UF

17 de 26 UFs têm efeito distinguível da média. Com a mesma prova e o mesmo sub-assunto, a P(perda) vai de 25,9% (MA) a 38,4% (AP).

*P(perda) ajustada* é a probabilidade média que a carteira inteira teria se estivesse naquela UF. *Severidade* é a média de condenação ÷ valor da causa nas perdas da UF, somando os dois sub-assuntos; `taxa_de_risco.py` usa a versão separada por sub-assunto (`severidade_uf_subassunto.csv`).

| UF | Efeito (log-odds) | IC 95% | ≠ média? | P(perda) ajustada | Severidade |
|---|---|---|---|---|---|
| AP | +0,826 | +0,70 a +0,95 | sim | 38,4% | 84,7% |
| AM | +0,744 | +0,62 a +0,87 | sim | 37,5% | 84,6% |
| RS | +0,377 | +0,25 a +0,50 | sim | 33,6% | 73,5% |
| GO | +0,305 | +0,18 a +0,43 | sim | 32,9% | 73,2% |
| RJ | +0,293 | +0,17 a +0,42 | sim | 32,8% | 68,7% |
| ES | +0,201 | +0,07 a +0,33 | sim | 31,9% | 68,5% |
| DF | +0,166 | +0,04 a +0,29 | sim | 31,6% | 68,8% |
| BA | +0,151 | +0,02 a +0,28 | sim | 31,4% | 80,6% |
| PE | +0,046 | −0,08 a +0,18 | não | 30,4% | 68,7% |
| MG | +0,017 | −0,11 a +0,15 | não | 30,1% | 68,3% |
| AL | +0,016 | −0,11 a +0,15 | não | 30,1% | 69,2% |
| SE | −0,012 | −0,14 a +0,12 | não | 29,9% | 67,3% |
| SP | −0,018 | −0,15 a +0,11 | não | 29,8% | 69,7% |
| CE | −0,082 | −0,21 a +0,05 | não | 29,2% | 68,6% |
| PB | −0,095 | −0,23 a +0,04 | não | 29,1% | 68,7% |
| SC | −0,099 | −0,23 a +0,04 | não | 29,1% | 69,5% |
| PA | −0,104 | −0,24 a +0,03 | não | 29,0% | 68,6% |
| AC | −0,206 | −0,34 a −0,07 | sim | 28,1% | 69,2% |
| TO | −0,242 | −0,38 a −0,11 | sim | 27,8% | 69,2% |
| RN | −0,252 | −0,39 a −0,11 | sim | 27,7% | 69,2% |
| RO | −0,269 | −0,41 a −0,13 | sim | 27,5% | 69,5% |
| MT | −0,286 | −0,42 a −0,15 | sim | 27,4% | 61,1% |
| MS | −0,295 | −0,43 a −0,16 | sim | 27,3% | 61,6% |
| PR | −0,306 | −0,44 a −0,17 | sim | 27,2% | 69,2% |
| PI | −0,417 | −0,56 a −0,28 | sim | 26,2% | 69,3% |
| MA | −0,458 | −0,60 a −0,32 | sim | 25,9% | 60,9% |

### Severidade

Média entre as perdas: 72,1% em golpe e 65,9% em genérico. Por UF, de 60,9% (MA) a 84,7% (AP). A diferença vem da parcial procedência; a procedência total fica perto de 90% em todas as UFs.

### Calibração

Decis de risco previsto fora da amostra. Maior desvio: **0,50 p.p.**

| Decil | Processos | Previsto | Observado | Desvio (p.p.) |
|---|---|---|---|---|
| 1 | 5.995 | 1,5% | 1,4% | −0,05 |
| 2 | 5.994 | 2,9% | 3,0% | +0,14 |
| 3 | 5.929 | 4,0% | 3,8% | −0,14 |
| 4 | 5.970 | 5,1% | 5,3% | +0,20 |
| 5 | 5.987 | 7,7% | 7,4% | −0,23 |
| 6 | 5.957 | 13,5% | 14,0% | +0,50 |
| 7 | 5.973 | 29,7% | 29,7% | −0,04 |
| 8 | 5.971 | 57,8% | 57,6% | −0,20 |
| 9 | 5.972 | 81,4% | 81,1% | −0,31 |
| 10 | 5.972 | 97,6% | 97,7% | +0,12 |

## Por que este modelo

Comparação feita na análise exploratória, com as mesmas 5 partições. Aquela rodada usou uma regularização leve, o que explica 0,30784 lá contra 0,30785 aqui. Esses números não são reproduzidos por `treinar.py`.

| Estrutura | Parâmetros | Log-loss | AUC |
|---|---|---|---|
| **Subsídios + sub-assunto + UF (este)** | **33** | **0,30784** | **0,923** |
| + interação sub-assunto × subsídio | 39 | 0,30785 | 0,923 |
| + interação UF × sub-assunto | 58 | 0,30800 | 0,922 |
| + interação UF × nº de subsídios | 58 | 0,30819 | 0,922 |
| Tábua UF × sub-assunto × conjunto, com shrinkage para este modelo | 2.997 células | 0,30827 | 0,922 |
| Conjunto exato de subsídios (64) + sub-assunto + UF | 90 | 0,30887 | 0,922 |
| Subsídios + sub-assunto | 8 | 0,31211 | 0,919 |
| Seis subsídios | 7 | 0,32096 | 0,912 |
| Tábua empírica UF × sub-assunto × conjunto | 2.997 células | 0,33124 | 0,912 |
| Nº de subsídios (0 a 6) | 7 | 0,44383 | 0,826 |
| Taxa-base | 1 | 0,61187 | 0,500 |

- **Nenhuma interação melhora.** Os efeitos se somam em log-odds.
- **A tábua célula a célula é esparsa demais:** mediana de 6 processos por célula.
- **Também testados, sem ganho:** o valor da causa (seção Estrutura) e o código da unidade de origem no número CNJ. Descontados UF, sub-assunto e subsídios, a vara não altera a chance de perder (χ²/gl = 0,99, p = 0,69).

## Arquivos

| Arquivo | Conteúdo |
|---|---|
| `treinar.py` | Carrega as duas abas, treina, valida e grava `resultados/` |
| `taxa_de_risco.py` | `prever_taxa_de_risco()`: aplica o modelo a um processo · `score_defesa()`: probabilidade → score de 0 a 100 |
| `resultados/modelo.json` | Tudo que `taxa_de_risco.py` usa: coeficientes, efeitos de UF e severidades |
| `resultados/metricas.json` | Contagens e validação cruzada, por partição e agregada |
| `resultados/coeficientes.csv` | Coeficientes com IC 95%, razão de chances e efeito médio |
| `resultados/efeitos_uf.csv` | Efeito de cada UF com IC 95% e P(perda) ajustada |
| `resultados/severidade_uf_subassunto.csv` | Severidade por UF e sub-assunto, com IC 95% (usada por `taxa_de_risco.py`) |
| `resultados/severidade_uf.csv` | Severidade por UF, com IC 95% |
| `resultados/calibracao.csv` | Previsto e observado por decil |
| `resultados/previsoes_validacao.csv` | P(perda) fora da amostra de cada processo (3,2 MB) |

## Limitações

- **Subsídio é presença, não conteúdo.** Um dossiê que conclui por fraude conta igual a um que confirma a assinatura.
- **Extinção conta como êxito.** Extinção sem julgamento de mérito pode voltar como ação nova, então o risco pode estar subestimado.
- **A exposição é só a condenação.** A base não traz custas, honorários nem o custo de defender; eles precisam entrar como parâmetro na política de acordos.
- **Sem datas na base.** A validação não pode ser temporal; o modelo precisa ser reavaliado com processos novos.
- **UF é proxy socioeconômico.** O uso na política deve ser justificado como risco jurisdicional e acompanhado por UF.
- **Há indícios de base sintética:** UFs com contagens idênticas, dígito verificador do CNJ inválido e valor da causa sem relação com o resultado. Os coeficientes devem ser reestimados com dados reais.
