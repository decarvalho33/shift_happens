# Modelos

Três modelos treinados nas 60 mil sentenças de `data/Hackaton_Enter_Base_Candidatos.xlsx`. Cada um tem script, resultados e README próprios em `src/modelo/`.

| Modelo | Pergunta | Resultado principal | Detalhes |
| --- | --- | --- | --- |
| Taxa de risco | Qual a chance de o banco perder? | AUC **0,923**; maior desvio de calibração **0,5 p.p.** | [README](../src/modelo/taxa_de_risco/README.md) |
| Valor da condenação | Quanto o banco paga, em média, se defender? | RMSE **R$ 3.723**, R² **0,544**; venceu 64 configurações | [README](../src/modelo/condenacao/README.md) |
| Valor de oferta | Por quanto os acordos costumam fechar? | **29,8%** da causa, faixa de 80% entre **21,6% e 38,6%** | [README](../src/modelo/valor_oferta/README.md) |

## Taxa de risco e score de defesa

```
soma      = intercepto + pesos dos subsídios juntados + peso do golpe + efeito da UF
P(perda)  = 1 / (1 + e^(−soma))
score     = arredondar(100 × (1 − P(perda)))      0 = fechar acordo · 100 = pode defender
```

| Informação | Peso (log-odds) | Efeito médio na chance de perder |
| --- | --- | --- |
| Contrato juntado | −3,080 | −44,9 p.p. |
| Extrato juntado | −2,997 | −41,6 p.p. |
| Comprovante de crédito juntado | −1,271 | −12,7 p.p. |
| Demonstrativo da dívida juntado | −0,520 | −5,0 p.p. |
| Dossiê / laudo juntado | ≈ 0 | indistinguível de zero |
| Sub-assunto golpe | +1,022 | +9,3 p.p. |
| UF | de −0,458 (MA) a +0,826 (AP) | 17 de 26 UFs diferem da média |

O score é a chance de o banco ganhar, e é calibrado: nos processos com score entre 81 e 95, o banco ganhou 90,6% das vezes. O site calcula o score no navegador com os mesmos coeficientes (`src/frontend/src/lib/riskModel.ts`), com diferença de 10⁻¹⁶ para o Python.

## Valor da condenação

```
condenação esperada = P(perda) × valor da causa × severidade[UF, sub-assunto]
```

A severidade é a fração da causa paga quando o banco perde: 71% em média, de 61% (MA) a 85% (AP). Árvores, GLMs, regressões diretas e empilhamento não superaram o modelo de duas partes além do ruído.

## Valor de oferta

Os 280 acordos da base pagam entre 20% e 40% da causa, sem relação com o risco do processo. Com bootstrap (1.000 reamostragens), nenhum dos 11 candidatos superou o percentual fixo. A faixa de 80% contém 80,2% dos acordos fora da amostra. O valor acordado não é a oferta ótima: a base não registra propostas recusadas.

## Limitações

- A base registra se o subsídio foi juntado, não o que ele conclui.
- Não há custo de defesa, datas, escritório nem histórico de negociação.
- Há indícios de dados sintéticos: UFs com contagens idênticas, dígito verificador do CNJ inválido e percentuais de acordo sorteados.
