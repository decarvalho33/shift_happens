# Modelo de valor da condenação

Prevê quanto o banco deve pagar de condenação em cada processo de **não reconhecimento de contratação de empréstimo**, contando zero quando ganha. É o custo esperado de defender, o número que a política de acordos compara com a oferta.

**Resultado:** o melhor modelo é o de duas partes que já está em `../taxa_de_risco/taxa_de_risco.py`. Foram 64 configurações testadas, e nenhuma supera esse modelo além do ruído da validação.

```
condenação esperada = P(perda) × valor da causa × severidade[UF, sub-assunto]
```

## Como usar

```bash
python ../taxa_de_risco/treinar.py   # gera ../taxa_de_risco/resultados/modelo.json, se ainda não existir
python motor.py        # exemplo
python analise.py      # refaz a comparação inteira (~2 min) e regrava resultados/
```

```python
from motor import prever_condenacao

prever_condenacao(uf="SP", golpe=False, subsidios={"contrato", "extrato"}, valor_causa=15000)
# valores arredondados:
# {'condenacao_esperada': 870.39, 'p_perda': 0.0913, 'condenacao_se_perder': 9533.48,
#  'severidade': 0.6356, 'uf_com_dados': True}
```

`motor.py` chama `../taxa_de_risco/taxa_de_risco.py`, então a P(perda) é a mesma da taxa de risco.

## Alvo e regras da comparação

- **Alvo:** valor da condenação em R$, com zero para improcedência e extinção. Os 280 acordos ficam fora. São 59.720 processos, e **69,9% têm condenação zero**.

  | Média | Mediana | P75 | P90 | P99 | Média entre as perdas |
  |---|---|---|---|---|---|
  | R$ 3.210 | R$ 0 | R$ 6.050 | R$ 12.478 | R$ 20.010 | R$ 10.658 |

- **Variáveis permitidas:** só as que existem na hora da decisão (UF, sub-assunto, os seis subsídios e valor da causa). Resultado, condenação e a razão condenação ÷ causa são vazamento.
- **Validação:** as mesmas 5 partições estratificadas por perda (semente 7) para todos os modelos.
- **Métrica principal: RMSE fora da amostra.** É a métrica adequada quando o que se quer é o valor médio. Também aparecem R², Gini (ordenação dos processos por custo) e viés (soma prevista ÷ soma observada − 1). A diferença para o motor atual é a média das diferenças de RMSE por partição, ± o desvio-padrão dessas diferenças.

## Análise descritiva

### Os subsídios mudam **se** o banco perde, não **quanto**

| Nº de subsídios | Processos | Taxa de perda | Condenação média | Condenação média se perder | Severidade se perder |
|---|---|---|---|---|---|
| 0 | 57 | 100,0% | R$ 10.575 | R$ 10.575 | 73,7% |
| 1 | 736 | 97,0% | R$ 10.400 | R$ 10.721 | 71,0% |
| 2 | 3.449 | 86,9% | R$ 9.256 | R$ 10.651 | 71,6% |
| 3 | 8.722 | 65,9% | R$ 7.029 | R$ 10.674 | 71,2% |
| 4 | 15.637 | 35,5% | R$ 3.793 | R$ 10.672 | 70,7% |
| 5 | 19.479 | 12,8% | R$ 1.356 | R$ 10.618 | 71,1% |
| 6 | 11.640 | 3,7% | R$ 385 | R$ 10.459 | 70,5% |

### O valor da causa muda **quanto**, não **se**

| Faixa do valor da causa | Causa média | Taxa de perda | Condenação média | Condenação média se perder | Severidade se perder |
|---|---|---|---|---|---|
| até R$ 10,7 mil | R$ 8.082 | 30,3% | R$ 1.738 | R$ 5.732 | 71,1% |
| R$ 10,7 a 13,7 mil | R$ 12.261 | 29,8% | R$ 2.599 | R$ 8.724 | 71,2% |
| R$ 13,7 a 16,3 mil | R$ 14.983 | 29,8% | R$ 3.150 | R$ 10.553 | 70,4% |
| R$ 16,3 a 19,3 mil | R$ 17.706 | 30,2% | R$ 3.804 | R$ 12.600 | 71,2% |
| acima de R$ 19,3 mil | R$ 21.874 | 30,4% | R$ 4.761 | R$ 15.634 | 71,5% |

### O sub-assunto muda os dois

| Sub-assunto | Processos | Taxa de perda | Condenação média | Condenação média se perder | Severidade se perder |
|---|---|---|---|---|---|
| Genérico | 18.317 | 16,8% | R$ 1.649 | R$ 9.815 | 65,9% |
| Golpe | 41.403 | 36,0% | R$ 3.901 | R$ 10.832 | 72,1% |

### A UF também muda os dois

| UF | Taxa de perda | Severidade se perder | Condenação média se perder | Condenação média |
|---|---|---|---|---|
| AM | 47,7% | 84,6% | R$ 12.665 | R$ 6.036 |
| AP | 48,0% | 84,8% | R$ 12.403 | R$ 5.952 |
| BA | 35,0% | 80,7% | R$ 11.992 | R$ 4.203 |
| GO | 37,4% | 73,2% | R$ 10.915 | R$ 4.076 |
| RS | 37,2% | 73,6% | R$ 10.930 | R$ 4.065 |
| RJ | 34,3% | 68,7% | R$ 10.311 | R$ 3.535 |
| ES | 33,0% | 68,5% | R$ 10.431 | R$ 3.444 |
| DF | 32,5% | 68,8% | R$ 10.226 | R$ 3.320 |
| PE | 30,2% | 68,7% | R$ 10.823 | R$ 3.265 |
| SP | 30,7% | 69,7% | R$ 10.404 | R$ 3.190 |
| AL | 30,6% | 69,2% | R$ 10.377 | R$ 3.175 |
| MG | 29,7% | 68,3% | R$ 10.248 | R$ 3.040 |
| SE | 28,7% | 67,3% | R$ 10.136 | R$ 2.907 |
| CE | 28,2% | 68,7% | R$ 10.265 | R$ 2.894 |
| PB | 28,2% | 68,7% | R$ 10.165 | R$ 2.866 |
| PA | 27,7% | 68,5% | R$ 10.298 | R$ 2.857 |
| SC | 27,2% | 69,5% | R$ 10.480 | R$ 2.846 |
| AC | 27,3% | 69,2% | R$ 10.382 | R$ 2.829 |
| RO | 25,4% | 69,5% | R$ 10.376 | R$ 2.640 |
| PR | 25,3% | 69,2% | R$ 10.266 | R$ 2.598 |
| TO | 24,3% | 69,2% | R$ 10.640 | R$ 2.586 |
| RN | 23,9% | 69,2% | R$ 10.655 | R$ 2.548 |
| PI | 22,4% | 69,3% | R$ 10.750 | R$ 2.413 |
| MS | 24,8% | 61,6% | R$ 8.951 | R$ 2.223 |
| MT | 23,3% | 61,1% | R$ 9.116 | R$ 2.127 |
| MA | 20,4% | 60,9% | R$ 9.119 | R$ 1.865 |

### Correlações

| Variável | Com a condenação | Com a condenação, entre as perdas | Com a severidade, entre as perdas |
|---|---|---|---|
| Contrato | −0,546 | −0,011 | −0,012 |
| Extrato | −0,471 | −0,002 | −0,007 |
| Comprovante de crédito | −0,253 | +0,001 | −0,004 |
| Dossiê | −0,000 | −0,000 | −0,005 |
| Demonstrativo da dívida | −0,097 | −0,006 | −0,006 |
| Laudo referenciado | +0,004 | +0,008 | +0,010 |
| Nº de subsídios | −0,492 | −0,005 | −0,011 |
| Sub-assunto golpe | +0,188 | +0,083 | +0,122 |
| Valor da causa | +0,194 | +0,761 | +0,009 |

Os subsídios só se correlacionam com a condenação através da perda: entre as perdas, a correlação cai a zero. O valor da causa faz o contrário: correlação de 0,19 na base toda, 0,76 entre as perdas e zero com a severidade. É por isso que ele entra como multiplicador.

## Comparação de modelos

| Família | Modelo | RMSE (R$) | R² | Gini | Viés | Δ RMSE vs motor atual | Partições melhores que o motor | Previsões negativas |
|---|---|---|---|---|---|---|---|---|
| duas partes | Logística × causa × MQO severidade ~ subsídios + golpe + UF | 3.722,6 | 0,544 | 0,812 | +0,01% | −0,2 ± 1,3 | 3 de 5 | — |
| duas partes | Logística × causa × MQO severidade ~ golpe + UF + causa | 3.722,6 | 0,544 | 0,812 | +0,10% | −0,2 ± 1,0 | 3 de 5 | — |
| duas partes | Logística × causa × MQO severidade ~ golpe + UF | 3.722,7 | 0,544 | 0,812 | +0,01% | −0,1 ± 1,2 | 3 de 5 | — |
| duas partes | **Logística × causa × severidade por UF e sub-assunto (motor atual)** | **3.722,8** | 0,544 | 0,812 | +0,00% | — | — | — |
| duas partes | idem, severidade ponderada por causa | 3.722,9 | 0,544 | 0,812 | +0,09% | +0,1 ± 0,2 | 2 de 5 | — |
| duas partes | Logística × causa × Gama severidade ~ subsídios + golpe + UF | 3.722,9 | 0,544 | 0,812 | +0,01% | +0,2 ± 1,4 | 3 de 5 | — |
| duas partes | Logística × causa × Gama severidade ~ golpe + UF | 3.723,1 | 0,544 | 0,812 | +0,01% | +0,3 ± 1,3 | 2 de 5 | — |
| duas partes | idem, severidade ponderada por causa² | 3.723,1 | 0,544 | 0,812 | +0,19% | +0,3 ± 0,4 | 1 de 5 | — |
| duas partes | Logística × causa × boosting na severidade | 3.723,6 | 0,544 | 0,812 | +0,13% | +0,8 ± 0,3 | 0 de 5 | — |
| duas partes | Logística × causa × severidade por UF, sub-assunto e nº subsídios | 3.725,6 | 0,544 | 0,812 | +0,02% | +2,8 ± 3,6 | 1 de 5 | — |
| duas partes | Logística × causa × severidade por UF | 3.727,2 | 0,543 | 0,812 | +0,01% | +4,5 ± 3,1 | 1 de 5 | — |
| duas partes | Logística × causa × severidade média | 3.750,0 | 0,538 | 0,810 | +0,04% | +27,2 ± 6,1 | 0 de 5 | — |
| três partes | idem, com subsídios em P(total | perda) | 3.722,6 | 0,544 | 0,812 | −0,01% | −0,2 ± 0,7 | 3 de 5 | — |
| três partes | Logística × [P(total) × razão total + P(parcial) × razão parcial] × causa | 3.722,6 | 0,544 | 0,812 | −0,00% | −0,1 ± 0,6 | 3 de 5 | — |
| empilhamento | P(perda) recalibrada por logística no logit × causa × severidade UF×sub | 3.722,8 | 0,544 | 0,812 | −0,01% | −0,0 ± 0,1 | 3 de 5 | — |
| empilhamento | MQO sem intercepto: condenação ~ P(perda) × causa × severidade UF×sub | 3.722,8 | 0,544 | 0,812 | −0,02% | −0,0 ± 0,0 | 2 de 5 | — |
| empilhamento | MQO ~ P(perda) do arquivo salvo × causa × severidade UF×sub | 3.722,9 | 0,544 | 0,812 | −0,02% | +0,1 ± 0,1 | 1 de 5 | — |
| empilhamento | Poisson log: offset log(P(perda) × causa) + golpe + UF | 3.723,5 | 0,544 | 0,812 | −0,01% | +0,8 ± 1,8 | 2 de 5 | — |
| empilhamento | P(perda) recalibrada por isotônica × causa × severidade UF×sub | 3.724,5 | 0,544 | 0,812 | −0,02% | +1,8 ± 1,4 | 1 de 5 | — |
| empilhamento | MQO: condenação ~ P(perda) × causa × (UF × sub-assunto), zeros incluídos | 3.725,8 | 0,544 | 0,812 | +0,06% | +3,0 ± 1,3 | 0 de 5 | — |
| empilhamento | Tweedie p=1,5 log: log(P(perda)) livre + golpe + UF, offset log(causa) | 3.726,1 | 0,544 | 0,812 | +0,11% | +3,3 ± 2,0 | 0 de 5 | — |
| empilhamento | Tweedie p=1,5 log: offset log(P(perda) × causa) + golpe + UF | 3.726,1 | 0,543 | 0,812 | +0,19% | +3,4 ± 1,9 | 0 de 5 | — |
| empilhamento | MQO: condenação ~ P(perda) × causa + P(perda) + causa + subsídios + golpe + UF | 3.736,0 | 0,541 | 0,810 | −0,00% | +13,2 ± 3,4 | 0 de 5 | 6.288 |
| empilhamento | Gradient boosting na razão ~ P(perda), UF, golpe (peso causa²), × causa | 3.738,2 | 0,541 | 0,810 | +0,04% | +15,5 ± 3,3 | 0 de 5 | — |
| empilhamento | Gradient boosting: condenação ~ P(perda), causa, UF, golpe, subsídios | 3.743,9 | 0,539 | 0,809 | −0,03% | +21,2 ± 5,1 | 0 de 5 | 184 |
| empilhamento | Gradient boosting: condenação ~ P(perda), causa, UF, golpe | 3.744,1 | 0,539 | 0,809 | −0,04% | +21,4 ± 4,2 | 0 de 5 | 112 |
| empilhamento | Gradient boosting ~ P(perda) do arquivo salvo, causa, UF, golpe | 3.747,0 | 0,538 | 0,809 | +0,03% | +24,2 ± 3,5 | 0 de 5 | 136 |
| empilhamento | MQO sem intercepto: condenação ~ P(perda) × causa | 3.749,8 | 0,538 | 0,810 | +0,78% | +27,0 ± 6,5 | 0 de 5 | — |
| árvores | Gradient boosting em duas partes (P(perda) × severidade) | 3.734,5 | 0,541 | 0,810 | −0,07% | +11,7 ± 5,4 | 0 de 5 | — |
| árvores | Gradient boosting na razão (peso causa²), × causa | 3.740,8 | 0,540 | 0,809 | −0,06% | +18,1 ± 3,6 | 0 de 5 | 198 |
| árvores | Gradient boosting (Poisson) na condenação | 3.748,6 | 0,538 | 0,809 | −0,11% | +25,9 ± 7,9 | 0 de 5 | — |
| árvores | Gradient boosting (erro quadrático) na condenação | 3.749,3 | 0,538 | 0,809 | −0,02% | +26,5 ± 5,3 | 0 de 5 | 2.984 |
| árvores | Floresta aleatória na condenação | 3.789,4 | 0,528 | 0,802 | −0,05% | +66,6 ± 5,4 | 0 de 5 | — |
| linear direto | MQO na razão condenação ÷ causa, × causa | 3.818,4 | 0,521 | 0,806 | −0,04% | +95,8 ± 12,7 | 0 de 5 | 8.224 |
| linear direto | MQ ponderado (causa²) na razão, × causa | 3.819,0 | 0,520 | 0,806 | +0,13% | +96,3 ± 12,4 | 0 de 5 | 7.879 |
| linear direto | MQO: condenação ~ (subsídios + golpe + UF) × causa | 3.819,8 | 0,520 | 0,805 | −0,01% | +97,2 ± 12,0 | 0 de 5 | 8.352 |
| linear direto | MQO: condenação ~ subsídios + golpe + UF + causa | 4.001,9 | 0,473 | 0,794 | +0,00% | +279,2 ± 16,6 | 0 de 5 | 11.745 |
| linear direto | MQO: condenação ~ subsídios + golpe + UF | 4.141,5 | 0,436 | 0,773 | +0,00% | +418,9 ± 12,1 | 0 de 5 | 8.686 |
| linear direto | MQO: condenação ~ causa | 5.409,9 | 0,038 | 0,246 | −0,00% | +1.687,3 ± 34,8 | 0 de 5 | — |
| GLM | Poisson log, offset log(causa) | 4.209,3 | 0,417 | 0,792 | +0,02% | +486,6 ± 25,0 | 0 de 5 | — |
| GLM | Poisson log, log(causa) como variável | 4.210,2 | 0,417 | 0,792 | +0,02% | +487,5 ± 25,5 | 0 de 5 | — |
| GLM | Tweedie p=1,5 offset + golpe × subsídios | 4.828,6 | 0,233 | 0,794 | +6,40% | +1.106,0 ± 52,3 | 0 de 5 | — |
| GLM | Tweedie p=1,5 log, offset log(causa) | 5.055,0 | 0,160 | 0,796 | +7,60% | +1.332,4 ± 66,2 | 0 de 5 | — |
| GLM | Tweedie p=1,5 log, log(causa) como variável | 5.056,7 | 0,159 | 0,796 | +7,62% | +1.334,1 ± 70,6 | 0 de 5 | — |
| referência | Valor da causa × razão média da base | 5.409,9 | 0,038 | 0,246 | −0,00% | +1.687,3 ± 34,8 | 0 de 5 | — |
| referência | Média da condenação por UF | 5.430,0 | 0,031 | 0,191 | −0,01% | +1.707,4 ± 33,5 | 0 de 5 | — |
| referência | Média geral da condenação | 5.514,9 | −0,000 | −0,006 | +0,00% | +1.792,3 ± 31,6 | 0 de 5 | — |

- **Duas partes, três partes e as melhores formas de empilhamento empatam no topo.** As diferenças para o motor atual ficam abaixo de R$ 1,50 de RMSE, menores que a variação entre partições. Separar procedência total de parcial também não ajuda.
- **Árvores ficam um pouco atrás e não acham nada que o modelo aditivo não tenha.** Gradient boosting em duas partes: +12; direto na condenação: +27, com 2.984 previsões negativas; floresta aleatória: +67.
- **Lineares diretos erram o formato.** O efeito de um subsídio em reais depende do valor da causa e da UF, o que uma soma não representa. Todos geram milhares de previsões negativas.
- **GLMs com ligação log são os piores modelos com variáveis.** Eles multiplicam os efeitos dos subsídios sem teto, enquanto a chance de perder satura perto de 0% e de 100%. Poisson fica +487. Tweedie fica +1.332 e superestima o total em 7,6%.

### Usando a P(perda) da logística como variável (empilhamento)

O modelo escolhido já usa a predição da logística, multiplicando: P(perda) × causa × severidade. Aqui a P(perda) entra como **variável de um segundo modelo**, que pode aprender outro formato, recalibrá-la ou combiná-la com UF, causa e subsídios.

Para evitar vazamento, a P(perda) das linhas de treino de cada partição é recalculada por validação interna. Duas variantes usam direto a predição salva em `../taxa_de_risco/resultados/previsoes_validacao.csv`. Ali, a P(perda) de uma linha de treino veio de modelos que viram as linhas de teste daquela partição.

| Variante | RMSE (R$) | Δ RMSE vs motor atual | Partições melhores que o motor | Previsões negativas |
|---|---|---|---|---|
| P(perda) recalibrada por logística no logit × causa × severidade UF×sub | 3.722,8 | −0,02 ± 0,06 | 3 de 5 | — |
| MQO sem intercepto: condenação ~ P(perda) × causa × severidade UF×sub | 3.722,8 | −0,01 ± 0,02 | 2 de 5 | — |
| MQO ~ P(perda) do arquivo salvo × causa × severidade UF×sub | 3.722,9 | +0,08 ± 0,14 | 1 de 5 | — |
| Poisson log: offset log(P(perda) × causa) + golpe + UF | 3.723,5 | +0,77 ± 1,78 | 2 de 5 | — |
| P(perda) recalibrada por isotônica × causa × severidade UF×sub | 3.724,5 | +1,77 ± 1,44 | 1 de 5 | — |
| MQO: condenação ~ P(perda) × causa × (UF × sub-assunto), zeros incluídos | 3.725,8 | +3,03 ± 1,30 | 0 de 5 | — |
| Tweedie p=1,5 log: log(P(perda)) livre + golpe + UF, offset log(causa) | 3.726,1 | +3,29 ± 1,96 | 0 de 5 | — |
| Tweedie p=1,5 log: offset log(P(perda) × causa) + golpe + UF | 3.726,1 | +3,37 ± 1,88 | 0 de 5 | — |
| MQO: condenação ~ P(perda) × causa + P(perda) + causa + subsídios + golpe + UF | 3.736,0 | +13,25 ± 3,37 | 0 de 5 | 6.288 |
| Gradient boosting na razão ~ P(perda), UF, golpe (peso causa²), × causa | 3.738,2 | +15,48 ± 3,26 | 0 de 5 | — |
| Gradient boosting: condenação ~ P(perda), causa, UF, golpe, subsídios | 3.743,9 | +21,21 ± 5,09 | 0 de 5 | 184 |
| Gradient boosting: condenação ~ P(perda), causa, UF, golpe | 3.744,1 | +21,41 ± 4,24 | 0 de 5 | 112 |
| Gradient boosting ~ P(perda) do arquivo salvo, causa, UF, golpe | 3.747,0 | +24,23 ± 3,45 | 0 de 5 | 136 |
| MQO sem intercepto: condenação ~ P(perda) × causa | 3.749,8 | +27,02 ± 6,49 | 0 de 5 | — |

- **A logística já está calibrada, então recalibrar não muda nada.**
  - Regredindo a condenação em P(perda) × causa × severidade, a inclinação dá 1,000; o valor ideal é 1.
  - A recalibração logística dá intercepto −0,002 e inclinação 0,997; o ideal é 0 e 1.
  - Nas duas variantes, a diferença para o motor é de centavos: −0,02 e −0,01.
- **Com a P(perda) no offset, os GLMs se recuperam.** Poisson vai de +487 para +0,8, e Tweedie de +1.332 para +3,4. Isso confirma que o problema deles era a falta de teto na chance de perder.
- **Deixar um modelo flexível aprender o formato piora.**
  - Gradient boosting com a P(perda) fica entre +21 e +15.
  - MQO linear fica +13, com 6.288 previsões negativas.
  - A multiplicação já é o formato certo.
- **Sem severidade por UF e sub-assunto** (só P(perda) × causa), o RMSE sobe +27.
- **Usar o arquivo salvo quase não muda nada:** MQO +0,08 contra −0,01 recalculando, e gradient boosting +24 contra +21. Com uma logística de 33 parâmetros o vazamento é pequeno, mas o procedimento correto continua sendo a validação interna.

### Ablação: tirando e pondo variáveis na P(perda)

A severidade fica fixa por UF e sub-assunto.

| Variante | RMSE (R$) | Δ RMSE vs motor atual | Partições melhores que o motor | AUC da P(perda) |
|---|---|---|---|---|
| **todos os seis + sub-assunto + UF (motor atual)** | **3.722,8** | — | — | **0,9226** |
| sem dossiê e laudo | 3.722,2 | −0,6 ± 0,8 | 3 de 5 | 0,9226 |
| + código de origem do CNJ (codificado fora da amostra) | 3.722,2 | −0,6 ± 0,5 | 5 de 5 | 0,9226 |
| sem laudo | 3.722,4 | −0,3 ± 0,5 | 4 de 5 | 0,9226 |
| sem dossiê | 3.722,5 | −0,3 ± 0,7 | 3 de 5 | 0,9226 |
| + log(valor da causa) | 3.723,0 | +0,2 ± 0,4 | 2 de 5 | 0,9226 |
| + valor da causa | 3.723,0 | +0,2 ± 0,4 | 2 de 5 | 0,9226 |
| + golpe × subsídios | 3.723,2 | +0,5 ± 0,9 | 2 de 5 | 0,9226 |
| sem demonstrativo | 3.736,8 | +14,0 ± 4,3 | 0 de 5 | 0,9207 |
| sem UF | 3.745,7 | +23,0 ± 6,4 | 0 de 5 | 0,9189 |
| sem sub-assunto | 3.766,9 | +44,2 ± 6,4 | 0 de 5 | 0,9169 |
| sem comprovante | 3.818,2 | +95,5 ± 10,5 | 0 de 5 | 0,9084 |
| sem extrato | 4.110,5 | +387,7 ± 15,6 | 0 de 5 | 0,8776 |
| sem contrato | 4.378,0 | +655,4 ± 30,8 | 0 de 5 | 0,8398 |
| nº de subsídios no lugar dos seis | 4.379,7 | +657,0 ± 16,6 | 0 de 5 | 0,8525 |
| sem nenhum subsídio | 5.197,0 | +1.474,4 ± 40,3 | 0 de 5 | 0,6445 |

- **Peso de cada variável no erro, se retirada:**

  | Variável retirada | RMSE a mais |
  |---|---|
  | Contrato | +655 |
  | Extrato | +388 |
  | Comprovante | +95 |
  | Sub-assunto | +44 |
  | UF | +23 |
  | Demonstrativo | +14 |

- **Contar subsídios em vez de usar os seis** custa +657, tanto quanto perder o contrato.
- **Dossiê e laudo** podem sair sem perda (−1, dentro do ruído).
- **Não melhoram:** valor da causa, log do valor da causa, interação golpe × subsídios e o código de origem do número CNJ. A variante com código de origem ganha nas 5 partições, mas só R$ 0,55 de RMSE (0,015%). Um teste anterior já mostrou que esse código não altera a chance de perder.

### Severidade: condenação entre as perdas

Parte 2 do modelo, avaliada só nos processos perdidos.

| Modelo da severidade | RMSE (R$) | R² | Viés |
|---|---|---|---|
| MQO ~ golpe + UF + causa | 2.832,8 | 0,628 | −0,00% |
| MQO ~ golpe + UF | 2.833,1 | 0,628 | −0,10% |
| Três partes: P(total) × razão total + P(parcial) × razão parcial | 2.833,4 | 0,628 | −0,11% |
| MQO ~ subsídios + golpe + UF | 2.833,5 | 0,628 | −0,10% |
| Três partes, com subsídios em P(total) | 2.833,5 | 0,628 | −0,10% |
| **Média por UF e sub-assunto (motor atual)** | 2.834,1 | 0,628 | −0,10% |
| Gama ~ golpe + UF | 2.834,5 | 0,628 | −0,10% |
| Média por UF e sub-assunto, ponderada por causa | 2.835,0 | 0,628 | −0,01% |
| Gama ~ subsídios + golpe + UF | 2.835,0 | 0,628 | −0,09% |
| Média por UF e sub-assunto, ponderada por causa² | 2.836,4 | 0,627 | +0,09% |
| Gradient boosting (subsídios, golpe, UF, causa) | 2.843,2 | 0,626 | +0,03% |
| Média por UF, sub-assunto e nº de subsídios | 2.858,9 | 0,621 | −0,10% |
| Média por UF | 2.863,7 | 0,620 | −0,11% |
| Média geral | 3.012,7 | 0,580 | −0,08% |

Todos os modelos que usam UF e sub-assunto empatam com R² de ~0,628. Os demais resultados:
- **Sem sub-assunto** (média só por UF) piora um pouco.
- **Sem UF** (média geral) piora bastante.
- **Subsídios, valor da causa, nº de subsídios e boosting** não acrescentam nada.

## Onde está o erro que sobra

| Informação disponível | RMSE (R$) | R² |
|---|---|---|
| Média geral (nenhuma informação) | 5.515 | −0,000 |
| **Modelo escolhido: duas partes (motor atual)** | 3.723 | 0,544 |
| Sabendo se o banco perdeu (vazamento) | 1.555 | 0,920 |
| Sabendo o resultado exato (vazamento) | 1.056 | 0,963 |

As duas últimas linhas usam o resultado da sentença e servem só de referência.
- **Não saber se o banco vai perder** responde pela maior parte do erro restante: sabendo, o R² sobe de 0,54 para 0,92.
- **A severidade já está no limite** do que a base permite.
- **Ganhos reais têm de vir de uma P(perda) melhor**, com informação que a base não tem, como o conteúdo dos documentos. Uma regressão mais sofisticada não resolve.

O erro típico de um processo individual é de ~R$ 3.723. O modelo serve para custo esperado e para a política de acordos, não para adivinhar a sentença de um caso.

## Calibração do modelo escolhido

Decis da condenação prevista, fora da amostra.

| Decil | Previsto (média) | Observado (média) | Desvio |
|---|---|---|---|
| 1 | R$ 118 | R$ 104 | −14 (−12,0%) |
| 2 | R$ 237 | R$ 243 | +6 (+2,6%) |
| 3 | R$ 374 | R$ 401 | +28 (+7,4%) |
| 4 | R$ 525 | R$ 510 | −15 (−2,8%) |
| 5 | R$ 783 | R$ 808 | +24 (+3,1%) |
| 6 | R$ 1.374 | R$ 1.367 | −8 (−0,6%) |
| 7 | R$ 2.711 | R$ 2.717 | +6 (+0,2%) |
| 8 | R$ 5.300 | R$ 5.332 | +33 (+0,6%) |
| 9 | R$ 8.147 | R$ 8.036 | −111 (−1,4%) |
| 10 | R$ 12.533 | R$ 12.584 | +50 (+0,4%) |

O maior desvio é no decil 9: −111 (−1,4%). O viés total é de +0,001%.

## Decisão

**Mantido o modelo de duas partes do motor atual:**
- A diferença para a melhor variante (−0,61 ± 0,83) está dentro do ruído.
- A P(perda) fica idêntica à do modelo de risco.
- Cada parte é explicável para o time jurídico.

**Simplificação possível, não aplicada:** tirar dossiê e laudo dos dois modelos juntos (31 parâmetros em vez de 33, sem perda de desempenho). Fazer isso só aqui deixaria as duas P(perda) diferentes.

## Arquivos

| Arquivo | Conteúdo |
|---|---|
| `analise.py` | Comparação completa: descritiva, 64 modelos, empilhamento, ablação, severidade e calibração |
| `motor.py` | `prever_condenacao()`, que usa `../taxa_de_risco/taxa_de_risco.py` |
| `resultados/comparacao_modelos.csv` | Todas as métricas de todos os modelos, com diferenças pareadas por partição |
| `resultados/severidade_modelos.csv` | Modelos de severidade avaliados entre as perdas |
| `resultados/calibracao_dp_ufsub.csv` | Calibração do modelo escolhido |
| `resultados/calibracao_ab_sem_dossie_laudo.csv` | Calibração da variante sem dossiê e laudo |
| `resultados/descritiva_*.csv` | Tabelas por UF, nº de subsídios, sub-assunto e faixa de causa |
| `resultados/correlacoes.csv` | Correlações das variáveis com condenação e severidade |
| `resultados/previsoes_validacao.csv` | Condenação observada e prevista fora da amostra, por processo (3 MB) |
| `resultados/resumo.json` | Estatísticas do alvo e metadados da execução |
| `resultados/analise.log` | Saída completa da última execução |

## Limitações

- **O erro individual é grande** (~R$ 3.723) porque o resultado da sentença é incerto. Use para custo esperado, não como previsão de um caso.
- **Subsídio é presença, não conteúdo.** É aí que está o ganho que falta.
- **A condenação não inclui custas, honorários nem custo de defender.** O custo total de defesa é maior que a condenação esperada.
- **Os acordos ficam fora, e extinção conta como condenação zero.**
- **Sem datas:** a validação não é temporal.
- **Há indícios de base sintética:** condenação é um percentual sorteado em faixas fixas e o valor da causa não tem relação com o resultado. Os resultados devem ser refeitos com dados reais.
