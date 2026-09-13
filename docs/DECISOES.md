# Decisões

Registro das escolhas técnicas, do motivo de cada uma e do que ainda está em aberto.

## Tomadas

| # | Decisão | Motivo | Alternativas descartadas |
| --- | --- | --- | --- |
| D01 | **Perda** = procedência ou parcial procedência. Improcedência e extinção contam como ganho; os 280 acordos ficam fora do modelo de risco | Acordo não é sentença; extinção não gera condenação | Tratar extinção como perda (ela pode voltar como ação nova: o risco pode estar subestimado) |
| D02 | Variáveis da taxa de risco: os 6 subsídios, sub-assunto e UF | São conhecidas quando o advogado decide | Valor da causa (6 formas testadas, sem ganho); código de origem do CNJ (sem efeito, χ²/gl = 0,99) |
| D03 | Regressão logística aditiva com 33 parâmetros | Log-loss 0,30785 e AUC 0,923; nenhuma interação melhora | Tábua célula a célula (mediana de 6 processos por célula); árvores; interações |
| D04 | **Score de defesa** = 100 × (1 − P(perda)), arredondado | É a chance de o banco ganhar, calibrada e fácil de explicar | Percentil na carteira (perde o significado de probabilidade) |
| D05 | Score calculado no navegador com os coeficientes do modelo treinado | Funciona sem backend; resultado idêntico ao Python | Probabilidades fixas nos casos de demonstração (removidas) |
| D06 | Subsídio **juntado** = documento fornecido, presente ou inconclusivo | É a definição da planilha (“1 = subsídio foi fornecido”) | Contar só documentos presentes (ver P01) |
| D07 | Documentos dos casos sintéticos mapeados para os subsídios: comprovante de liberação → extrato; consulta BACEN → comprovante de crédito; biometria e assinatura → dossiê; histórico de pagamentos → demonstrativo | Correspondência pelo conteúdo de cada documento | — |
| D08 | Sub-assunto **golpe** nos casos de demonstração só quando a alegação fala em fraude ou diz que a conta que recebeu o dinheiro não é do autor | Regra objetiva e verificável no texto | Classificar por interpretação livre da alegação |
| D09 | Condenação esperada = P(perda) × valor da causa × severidade[UF, sub-assunto] | Melhor entre 64 configurações; mantém a mesma P(perda) da taxa de risco | GLMs Poisson e Tweedie; árvores; empilhamento (inclinação de calibração 1,000, sem ganho) |
| D10 | Valor de oferta de referência = 29,8% da causa, com faixa preditiva por bootstrap | Nenhum dos 11 modelos superou o percentual fixo nas mesmas reamostragens | Floresta aleatória, ridge, bagging e modelos com UF (sobreajuste) |
| D11 | Repositório no formato do template do hackathon (`src/`, `data/`, `docs/`) | Padrão exigido na entrega | — |

## Em aberto

| # | Pendência | Por que importa |
| --- | --- | --- |
| P01 | Regra para documento inconclusivo | Contar só documentos presentes muda o score de alguns casos de demonstração de 98 para 3 |
| P02 | Limiares do score (acordo, zona cinzenta, defesa) | Pelo acordo típico e pela severidade média, o ponto de equilíbrio fica em score ≈ 58 |
| P03 | Custo de defender (honorários, custas, tempo) | Não existe na base e move a linha entre acordo e defesa |
| P04 | Recomendação, selo de risco e faixa de acordo dos casos de demonstração | Continuam demonstrativos; em 4 casos a recomendação é acordo e o score indica defesa |
| P05 | Retirar dossiê e laudo dos modelos | Empatam em desempenho com 2 parâmetros a menos |
| P06 | Versionar a planilha em `data/` | O template recomenda não versionar dados fornecidos pela organização |
