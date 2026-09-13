# Valor de oferta

Estima o **valor em que acordos costumam fechar** em ações de não reconhecimento de contratação de empréstimo, a partir dos 280 acordos homologados na base. O bootstrap é usado porque a amostra é pequena.

> **Isto não é a oferta ótima.** A base registra só os acordos aceitos, pelo valor final. Propostas recusadas e contrapropostas não aparecem, então não dá para estimar a chance de aceite de uma oferta.

**Resultado:** nenhum modelo supera o percentual fixo da causa.

```
valor típico de acordo = 29,8% × valor da causa
faixa de 80%            = 21,6% a 38,6% do valor da causa
```

## Como usar

```bash
python analise.py        # ~3 min · refaz a análise e regrava resultados/
python valor_oferta.py   # exemplos
```

```python
from valor_oferta import prever_valor_oferta

prever_valor_oferta(uf="SP", golpe=False, subsidios={"contrato", "extrato"}, valor_causa=15000)
# valores arredondados:
# {'valor_acordo_tipico': 4467.32, 'faixa_80': (3240.0, 5784.64), 'faixa_95': (2995.71, 5996.79),
#  'percentual_da_causa': 0.2978, 'p_perda': 0.0913, 'condenacao_esperada': 870.39,
#  'acordo_tipico_sobre_condenacao_esperada': 5.13}
```

A função devolve também a P(perda) e a condenação esperada, calculadas com `../taxa_de_risco/taxa_de_risco.py`. `acordo_tipico_sobre_condenacao_esperada` acima de 1 quer dizer que o acordo típico custa mais que a sentença esperada.

| Processo | Valor típico | Faixa de 80% | Condenação esperada | Acordo típico ÷ condenação esperada |
|---|---|---|---|---|
| SP, genérico, com contrato e extrato, causa R$ 15 mil | R$ 4.467 | R$ 3.240 a 5.785 | R$ 870 | **5,13** |
| AM, golpe, sem contrato nem extrato, causa R$ 25 mil | R$ 7.446 | R$ 5.400 a 9.641 | R$ 20.896 | **0,36** |

## Os acordos da base

- **Valor:** de R$ 928 a R$ 9.076, com média de R$ 4.540.
- **Percentual da causa:** de 20% a 40%, com média de 29,8%.
- **100% são percentuais inteiros**, distribuídos de forma uniforme entre as 21 categorias (qui-quadrado, p = 0,96). É o padrão de um valor sorteado.

### Os acordos não são uma amostra aleatória

| Variável | Acordos | Sentenças | p |
|---|---|---|---|
| P(perda) (média) | 69,1% | 30,1% | < 0,001 |
| Condenação esperada (média) | R$ 7.501 | R$ 3.210 | < 0,001 |
| Valor da causa (média) | R$ 15.209 | R$ 14.981 | 0,408 |
| Nº de subsídios (média) | 3,46 | 4,41 | < 0,001 |
| Contrato (% com) | 26,1% | 71,9% | < 0,001 |
| Extrato (% com) | 50,4% | 81,6% | < 0,001 |
| Comprovante de crédito (% com) | 46,1% | 60,8% | < 0,001 |
| Dossiê (% com) | 71,1% | 70,0% | 0,737 |
| Demonstrativo da dívida (% com) | 73,2% | 77,0% | 0,148 |
| Laudo referenciado (% com) | 79,3% | 80,1% | 0,790 |
| Sub-assunto golpe (% com) | 80,4% | 69,3% | < 0,001 |
| UF | distribuição | distribuição | 0,012 |

Os acordos se concentram em processos de **risco alto**, com menos contrato e extrato e mais golpe. O valor da causa é igual nos dois grupos.

### Mas o percentual acordado não acompanha o risco

| Variável | Efeito no percentual acordado | p | p corrigido (Bonferroni) |
|---|---|---|---|
| Contrato | +1,9 p.p. com o documento | 0,026 | 0,314 |
| Extrato | −0,2 p.p. com o documento | 0,751 | 1,000 |
| Comprovante de crédito | +0,6 p.p. com o documento | 0,431 | 1,000 |
| Dossiê | −0,3 p.p. com o documento | 0,758 | 1,000 |
| Demonstrativo da dívida | +0,6 p.p. com o documento | 0,454 | 1,000 |
| Laudo referenciado | −0,5 p.p. com o documento | 0,574 | 1,000 |
| Sub-assunto golpe | +0,5 p.p. em golpe | 0,573 | 1,000 |
| P(perda) | correlação de Spearman −0,08 | 0,159 | 1,000 |
| Condenação esperada | correlação de Spearman −0,07 | 0,225 | 1,000 |
| Valor da causa | correlação de Spearman +0,05 | 0,407 | 1,000 |
| Nº de subsídios | correlação de Spearman +0,07 | 0,239 | 1,000 |
| UF | Kruskal-Wallis entre as 26 UFs | 0,310 | 1,000 |

Nenhuma variável altera o percentual depois da correção por múltiplos testes. O contrato é o único abaixo de 5% sem correção, o que se espera por acaso em 12 testes.

Por isso o acordo típico fica caro nos casos fáceis e barato nos difíceis:

| P(perda) | Acordos | Percentual acordado | Condenação esperada (% da causa) | Acordos abaixo da condenação esperada |
|---|---|---|---|---|
| <20% | 41 | 30,9% | 6,2% | 0% |
| 20–50% | 30 | 31,1% | 27,3% | 40% |
| 50–80% | 61 | 29,4% | 45,6% | 95% |
| ≥80% | 148 | 29,3% | 67,7% | 100% |

- **Risco abaixo de 20%:** o banco pagou em média 30,9% da causa para evitar uma condenação esperada de 6,2%.
- **Risco acima de 80%:** pagou 29,3% contra 67,7%.
- **No total, 78% dos acordos ficaram abaixo da condenação esperada**, na mediana por 55% dela. A condenação esperada não inclui custo de defesa.

## Como o bootstrap foi usado

1. **Erro fora da amostra.** 1000 reamostragens com reposição: cada modelo é ajustado na reamostragem e avaliado nos acordos que ficaram de fora (*out-of-bag*). O estimador **.632+** combina esse erro com o erro na própria amostra e corrige o sobreajuste. Também há validação cruzada 5 partes × 20 repetições.
2. **Comparação pareada.** Em cada reamostragem, o erro do modelo é comparado com o do percentual fixo. Daí saem o intervalo de 95% da diferença e a chance de o modelo ser melhor.
3. **Bagging.** Um dos candidatos é a média de 100 regressões ajustadas em reamostragens; a floresta aleatória é o bagging de árvores.
4. **Incerteza e faixa de previsão.** Intervalos de confiança do percentual e dos coeficientes (5.000 e 2.000 reamostragens). A faixa de um acordo novo soma a incerteza da média e a dispersão dos acordos, e sua cobertura foi conferida por validação cruzada.

O bootstrap não cria informação. Ele mede a incerteza e reduz a variância, mas não corrige amostra pequena nem viés de seleção.

## Comparação de modelos

| Modelo | Parâmetros | RMSE .632+ (R$) | RMSE validação cruzada (R$) | R² validação cruzada | Δ RMSE fora da bolsa vs percentual (IC 95%) | Chance de ser melhor que o percentual |
|---|---|---|---|---|---|---|
| Floresta aleatória (bagging de árvores): percentual ~ subsídios, sub-assunto, UF, P(perda) | 34 | 964 | 987 | 0,662 | +14,1 (−33 a +76) | 32% |
| MQO: percentual ~ P(perda) | 2 | 981 | 982 | 0,666 | +0,6 (−15 a +34) | 62% |
| **Percentual médio × valor da causa** | 1 | 983 | 983 | 0,665 | — | — |
| MQO: valor ~ causa + condenação esperada | 3 | 985 | 985 | 0,663 | +6,8 (−14 a +54) | 42% |
| MQO: valor ~ causa | 2 | 986 | 985 | 0,663 | +5,2 (−6 a +31) | 27% |
| Percentual médio por sub-assunto × causa | 2 | 987 | 987 | 0,662 | +6,7 (−2 a +38) | 20% |
| MQO: percentual ~ subsídios + sub-assunto | 8 | 992 | 1.000 | 0,653 | +22,9 (−16 a +83) | 17% |
| Bagging (100 reamostragens) de MQO: percentual ~ subsídios + sub-assunto | 8 | 992 | 1.000 | 0,653 | +22,9 (−16 a +81) | 18% |
| Percentual mediano × valor da causa | 1 | 994 | 991 | 0,659 | +11,9 (−11 a +64) | 27% |
| Ridge: percentual ~ subsídios + sub-assunto + UF + P(perda) | 34 | 1.002 | 986 | 0,663 | +35,4 (−20 a +128) | 19% |
| MQO: percentual ~ subsídios + sub-assunto + UF | 33 | 1.041 | 1.068 | 0,604 | +117,9 (+13 a +249) | 2% |
| Média do valor acordado | 1 | 1.698 | 1.705 | −0,009 | +720,6 (+563 a +880) | 0% |

**Regra de escolha:** um modelo só substitui o percentual fixo se o intervalo de 95% da diferença de erro ficar inteiro abaixo de zero. Nenhum ficou.

- **O R² de ~0,66 vem só do valor da causa.** A média simples do valor, sem a causa, tem R² ≈ 0.
- **A floresta tem o menor RMSE .632+ (964), mas perde nas comparações diretas.** Nas mesmas reamostragens erra +14 a mais (IC −33 a +76), é melhor em só 32% delas e perde na validação cruzada. O .632+ fica otimista com modelos flexíveis, que erram pouco na própria amostra.
- **P(perda) como variável praticamente empata:** +0,6 (IC −15 a +34), com um parâmetro a mais.
- **Com UF (33 parâmetros para 280 acordos), o modelo sobreajusta:** erra +118 a mais, com IC inteiro acima de zero.

### Coeficientes com intervalo por bootstrap

Em pontos percentuais do valor da causa.

| Modelo | Termo | Estimativa | IC 95% |
|---|---|---|---|
| percentual ~ subsídios + sub-assunto | Intercepto | +29,40 | +26,52 a +32,20 |
| percentual ~ subsídios + sub-assunto | Contrato | +1,84 | +0,05 a +3,53 |
| percentual ~ subsídios + sub-assunto | Extrato | −0,48 | −1,97 a +1,01 |
| percentual ~ subsídios + sub-assunto | Comprovante de crédito | +0,40 | −1,01 a +1,79 |
| percentual ~ subsídios + sub-assunto | Dossiê | −0,25 | −1,91 a +1,37 |
| percentual ~ subsídios + sub-assunto | Demonstrativo da dívida | +0,32 | −1,36 a +2,03 |
| percentual ~ subsídios + sub-assunto | Laudo referenciado | −0,46 | −2,20 a +1,34 |
| percentual ~ subsídios + sub-assunto | Sub-assunto golpe | +0,33 | −1,62 a +2,15 |
| percentual ~ P(perda) | Intercepto | +31,08 | +29,41 a +32,72 |
| percentual ~ P(perda) | P(perda) | −1,88 | −4,10 a +0,48 |

- **Contrato** (+1,8 p.p., IC +0,05 a +3,53) é o único intervalo que não cruza zero entre 7 termos. É compatível com acaso e não melhora a previsão.
- **P(perda)** tem inclinação de −1,9 p.p. entre risco 0 e risco 1, e o intervalo inclui zero.

## Modelo escolhido: percentual da causa

- **Percentual médio:** 29,8%, com IC 95% de 29,1% a 30,5%.
- **Percentual mediano:** 29%, com IC 95% de 28% a 31%.

Distribuição preditiva de um acordo novo:

| Quantil | Percentual da causa | Em uma causa de R$ 15 mil |
|---|---|---|
| 2,5% | 20,0% | R$ 2.996 |
| 10% | 21,6% | R$ 3.240 |
| 25% | 24,6% | R$ 3.688 |
| 50% (mediana) | 29,2% | R$ 4.387 |
| 75% | 35,1% | R$ 5.264 |
| 90% | 38,6% | R$ 5.785 |
| 97,5% | 40,0% | R$ 5.997 |

Cobertura conferida por validação cruzada: a faixa de 80% contém **80,2%** dos acordos fora da amostra, e a de 95%, **93,9%**.

## Como usar na política de acordos

- **O percentual histórico é referência de aceitação, não teto.** Ele mostra onde os autores aceitaram fechar, de 21,6% a 38,6% da causa em 80% dos casos.
- **O teto deve vir do custo de defender**, que é a condenação esperada mais os custos, calculados na taxa de risco.
- **Risco baixo:** o acordo típico passa do custo esperado (5× no exemplo de SP). A política deveria defender ou oferecer bem abaixo do histórico.
- **Risco alto:** o acordo típico custa uma fração da condenação esperada (0,36× no exemplo de AM). A faixa histórica serve de abertura e de margem de negociação.
- **Uma combinação possível:** abrir perto do quantil de 25% do histórico e subir até o menor valor entre o quantil de 90% e o teto de custo.

## Arquivos

| Arquivo | Conteúdo |
|---|---|
| `analise.py` | Descritiva, testes, 12 modelos, bootstrap, faixas e cobertura |
| `valor_oferta.py` | `prever_valor_oferta()`: valor típico, faixas e comparação com a condenação esperada |
| `resultados/modelo.json` | Percentual médio e mediano com IC, quantis preditivos e cobertura (usado por `valor_oferta.py`) |
| `resultados/comparacao_modelos.csv` | Validação cruzada, .632+, erro fora da bolsa e comparação pareada de cada modelo |
| `resultados/bootstrap_rmse_oob.csv` | RMSE fora da bolsa de cada modelo em cada uma das 1000 reamostragens |
| `resultados/coeficientes_bootstrap.csv` | Coeficientes com IC por bootstrap |
| `resultados/testes_variaveis.csv` | Efeito de cada variável no percentual acordado |
| `resultados/acordos_vs_sentencas.csv` | Comparação do perfil dos acordos com as sentenças |
| `resultados/descritiva_acordos.csv` | Acordos por sub-assunto, nº de subsídios e faixa de P(perda) |
| `resultados/distribuicao_percentual.csv` | Contagem de acordos por percentual inteiro da causa |
| `resultados/acordos_com_previsoes.csv` | Cada acordo com P(perda), condenação esperada e previsões fora da amostra |
| `resultados/resumo.json` | Estatísticas e decisão |
| `resultados/analise.log` | Saída completa da última execução |

## Limitações

- **Valor acordado não é oferta.** Sem as propostas recusadas, não há como estimar a chance de aceite nem a oferta ótima. É o dado que a plataforma precisa começar a registrar.
- **São só 280 acordos**, e os de risco baixo são 41.
- **Há viés de seleção:** os acordos se concentram em processos de risco alto.
- **Há indícios de base sintética:** percentuais inteiros sorteados de forma uniforme entre 20% e 40%, sem relação com o processo. Com dados reais o percentual pode depender do risco, e a análise deve ser refeita.
- **A condenação esperada usada na comparação não inclui custo de defesa.**
