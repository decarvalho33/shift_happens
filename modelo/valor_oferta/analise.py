"""Modelo do valor de acordo com bootstrap.

A base tem só 280 acordos. O alvo é o valor acordado (R$), modelado também como percentual
do valor da causa. Com amostra pequena, o bootstrap entra em quatro frentes:
  1. erro fora da amostra: bootstrap fora da bolsa (out-of-bag) e estimador .632+;
  2. comparação pareada de cada modelo com o percentual fixo, nas mesmas reamostragens;
  3. bagging (média de modelos ajustados em reamostragens) entre os candidatos;
  4. intervalos de confiança e faixa de previsão, com cobertura conferida por validação cruzada.

O valor acordado não é a oferta ótima: é onde acordos homologados fecharam.
Propostas recusadas não aparecem na base.

Uso: python analise.py    (alguns minutos; grava resultados/)
"""
from __future__ import annotations

import importlib.util
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import RidgeCV
from sklearn.model_selection import KFold

PASTA = Path(__file__).resolve().parent
RAIZ_MODELOS = PASTA.parent
DADOS = RAIZ_MODELOS.parent / "Hackaton_Enter_Base_Candidatos.xlsx"
SAIDA = PASTA / "resultados"
SUBSIDIOS = {"Contrato": "contrato", "Extrato": "extrato", "Comprovante de crédito": "comprovante",
             "Dossiê": "dossie", "Demonstrativo de evolução da dívida": "demonstrativo", "Laudo referenciado": "laudo"}
DOCS = list(SUBSIDIOS.values())
SEMENTE, B, REPETICOES, B_BAGGING = 7, 1000, 20, 100
T0 = time.time()

_spec = importlib.util.spec_from_file_location("taxa_de_risco", RAIZ_MODELOS / "taxa_de_risco" / "taxa_de_risco.py")
risco = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(risco)


def log(msg):
    print(f"[{time.time() - T0:6.1f}s] {msg}", flush=True)


def carregar() -> pd.DataFrame:
    res = pd.read_excel(DADOS, sheet_name="Resultados dos processos")
    sub = pd.read_excel(DADOS, sheet_name="Subsídios disponibilizados", header=1)
    sub = sub.rename(columns={"Número do processos": "Número do processo"})
    b = res.merge(sub, on="Número do processo", how="inner", validate="1:1")
    df = pd.DataFrame({"processo": b["Número do processo"], "uf": b["UF"], "golpe": (b["Sub-assunto"] == "Golpe").astype(int),
                       "resultado": b["Resultado micro"], "causa": b["Valor da causa"].astype(float),
                       "valor": b["Valor da condenação/indenização"].astype(float)})
    for coluna, nome in SUBSIDIOS.items():
        df[nome] = b[coluna].astype(int)
    df["n_subsidios"] = df[DOCS].sum(1)
    # P(perda) e condenação esperada vêm dos modelos treinados só com sentenças: sem vazamento para os acordos
    saida = [risco.prever_taxa_de_risco(t.uf, bool(t.golpe), {d for d in DOCS if getattr(t, d)}, t.causa) for t in df.itertuples()]
    df["p_perda"] = [s["p_perda"] for s in saida]
    df["condenacao_esperada"] = [s["exposicao_esperada"] for s in saida]
    df["acordo"] = (df["resultado"] == "Acordo").astype(int)
    return df


SAIDA.mkdir(exist_ok=True)
base = carregar()
ac = base[base["acordo"] == 1].reset_index(drop=True)
se = base[base["acordo"] == 0]
n = len(ac)
y = ac["valor"].to_numpy(float)
causa = ac["causa"].to_numpy(float)
razao = y / causa
pct = 100 * razao
P = ac["p_perda"].to_numpy(float)
CE = ac["condenacao_esperada"].to_numpy(float)
D = ac[DOCS].to_numpy(float)
G = ac["golpe"].to_numpy(float)
UFS = sorted(base["uf"].unique())
uf_i = ac["uf"].map({u: i for i, u in enumerate(UFS)}).to_numpy(int)
U = np.eye(len(UFS))[uf_i]
Ue = U[:, :-1] - U[:, [-1]]
um = np.ones(n)
log(f"{len(base)} processos, {n} acordos")

# ---------------------------------------------------------------- descritiva dos acordos
arred = np.round(pct).astype(int)
contagem = pd.Series(arred).value_counts().reindex(range(arred.min(), arred.max() + 1), fill_value=0)
qui_unif, p_unif = stats.chisquare(contagem.to_numpy())
contagem.rename_axis("percentual_da_causa").reset_index(name="acordos").to_csv(SAIDA / "distribuicao_percentual.csv", index=False)

testes = []
for nome, v in [(d, ac[d].to_numpy()) for d in DOCS] + [("golpe", ac["golpe"].to_numpy())]:
    com, sem = pct[v == 1], pct[v == 0]
    _, p = stats.ttest_ind(com, sem, equal_var=False)
    testes.append({"variavel": nome, "teste": "Welch", "n_com": len(com), "n_sem": len(sem), "percentual_medio_com": com.mean(),
                   "percentual_medio_sem": sem.mean(), "diferenca_pp": com.mean() - sem.mean(), "p_valor": p})
for nome, v in [("p_perda", P), ("condenacao_esperada", CE), ("causa", causa), ("n_subsidios", ac["n_subsidios"].to_numpy())]:
    rho, p = stats.spearmanr(v, pct)
    r, _ = stats.pearsonr(v, pct)
    testes.append({"variavel": nome, "teste": "Spearman", "spearman": rho, "pearson": r, "p_valor": p})
_, p_kw = stats.kruskal(*[pct[uf_i == i] for i in np.unique(uf_i)])
testes.append({"variavel": "uf", "teste": "Kruskal-Wallis", "p_valor": p_kw})
testes = pd.DataFrame(testes)
testes["p_valor_bonferroni"] = np.minimum(1, testes["p_valor"] * len(testes))
testes.to_csv(SAIDA / "testes_variaveis.csv", index=False, float_format="%.6f")

def por(chave, nome):
    return (pd.DataFrame({"grupo": chave, "valor": y, "pct": pct, "causa": causa, "ce": CE, "ce_pct": 100 * CE / causa, "abaixo": y < CE})
            .groupby("grupo", observed=True)
            .agg(acordos=("valor", "size"), valor_medio=("valor", "mean"), percentual_medio=("pct", "mean"), causa_media=("causa", "mean"),
                 condenacao_esperada_media=("ce", "mean"), condenacao_esperada_pct_causa=("ce_pct", "mean"),
                 fracao_acordo_abaixo_da_condenacao_esperada=("abaixo", "mean"))
            .reset_index().assign(recorte=nome))

descritiva = pd.concat([
    por(np.where(G == 1, "golpe", "genérico"), "sub-assunto"),
    por(pd.cut(ac["n_subsidios"], [-1, 3, 4, 5, 6], labels=["0–3", "4", "5", "6"]), "nº de subsídios"),
    por(pd.cut(P, [0, .2, .5, .8, 1.0001], right=False, labels=["<20%", "20–50%", "50–80%", "≥80%"]), "P(perda)"),
    por(np.full(n, "todos"), "todos"),
])
descritiva.to_csv(SAIDA / "descritiva_acordos.csv", index=False, float_format="%.4f")

selecao = []
for nome in ["p_perda", "condenacao_esperada", "causa", "n_subsidios"]:
    _, p = stats.ttest_ind(ac[nome], se[nome], equal_var=False)
    selecao.append({"variavel": nome, "acordos": ac[nome].mean(), "sentencas": se[nome].mean(), "teste": "Welch", "p_valor": p})
for nome in DOCS + ["golpe"]:
    _, p, _, _ = stats.chi2_contingency([[ac[nome].sum(), n - ac[nome].sum()], [se[nome].sum(), len(se) - se[nome].sum()]])
    selecao.append({"variavel": nome, "acordos": ac[nome].mean(), "sentencas": se[nome].mean(), "teste": "qui-quadrado", "p_valor": p})
_, p_uf, _, _ = stats.chi2_contingency(pd.crosstab(base["uf"], base["acordo"]))
selecao.append({"variavel": "uf (distribuição)", "teste": "qui-quadrado 26×2", "p_valor": p_uf})
selecao = pd.DataFrame(selecao)
selecao.to_csv(SAIDA / "acordos_vs_sentencas.csv", index=False, float_format="%.6f")
log("descritiva pronta")

# ---------------------------------------------------------------- candidatos
mq = lambda X, t: np.linalg.lstsq(X, t, rcond=None)[0]
X_causa = np.column_stack([um, causa])
X_sub = np.column_stack([um, G])
X_p = np.column_stack([um, P])
X_ce = np.column_stack([um, causa, CE])
X_dg = np.column_stack([um, D, G])
X_dgu = np.column_stack([um, D, G, Ue])
X_ridge = np.column_stack([D, G, U, (P - P.mean()) / P.std()])
X_rf = np.column_stack([D, G, U, P])
RNG_BAGGING = np.random.default_rng(SEMENTE + 1)


def media_valor(tr):
    m = y[tr].mean()
    return lambda te: np.full(len(te), m)


def percentual(estatistica):
    def f(tr):
        k = estatistica(razao[tr])
        return lambda te: k * causa[te]
    return f


def mq_percentual(X):
    def f(tr):
        b = mq(X[tr], razao[tr])
        return lambda te: (X[te] @ b) * causa[te]
    return f


def mq_valor(X):
    def f(tr):
        b = mq(X[tr], y[tr])
        return lambda te: X[te] @ b
    return f


def ridge(tr):
    m = RidgeCV(alphas=np.logspace(-3, 4, 30)).fit(X_ridge[tr], razao[tr])
    return lambda te: m.predict(X_ridge[te]) * causa[te]


def bagging(X):
    def f(tr):
        b = np.mean([mq(X[s], razao[s]) for s in (tr[RNG_BAGGING.integers(0, len(tr), len(tr))] for _ in range(B_BAGGING))], axis=0)
        return lambda te: (X[te] @ b) * causa[te]
    return f


def floresta(tr):
    m = RandomForestRegressor(n_estimators=150, min_samples_leaf=10, max_features=0.5, random_state=SEMENTE).fit(X_rf[tr], razao[tr])
    return lambda te: m.predict(X_rf[te]) * causa[te]


MODELOS = [
    ("media_valor", "Média do valor acordado", 1, media_valor),
    ("pct_medio", "Percentual médio × valor da causa", 1, percentual(np.mean)),
    ("pct_mediano", "Percentual mediano × valor da causa", 1, percentual(np.median)),
    ("mq_valor_causa", "MQO: valor ~ causa", 2, mq_valor(X_causa)),
    ("pct_por_sub", "Percentual médio por sub-assunto × causa", 2, mq_percentual(X_sub)),
    ("mq_pct_p", "MQO: percentual ~ P(perda)", 2, mq_percentual(X_p)),
    ("mq_valor_ce", "MQO: valor ~ causa + condenação esperada", 3, mq_valor(X_ce)),
    ("mq_pct_dg", "MQO: percentual ~ subsídios + sub-assunto", 8, mq_percentual(X_dg)),
    ("mq_pct_dgu", "MQO: percentual ~ subsídios + sub-assunto + UF", 33, mq_percentual(X_dgu)),
    ("ridge", "Ridge: percentual ~ subsídios + sub-assunto + UF + P(perda)", 34, ridge),
    ("bagging_dg", f"Bagging ({B_BAGGING} reamostragens) de MQO: percentual ~ subsídios + sub-assunto", 8, bagging(X_dg)),
    ("floresta", "Floresta aleatória (bagging de árvores): percentual ~ subsídios, sub-assunto, UF, P(perda)", 34, floresta),
]
REF = "pct_medio"
rmse = lambda a, b: float(np.sqrt(np.mean((a - b) ** 2)))

# ---------------------------------------------------------------- validação cruzada repetida
cv = {k: {"rmse": [], "mae": [], "r2": [], "rmse_pp": []} for k, *_ in MODELOS}
prev_cv = {k: np.zeros(n) for k, *_ in MODELOS}
for rep in range(REPETICOES):
    pred = {k: np.zeros(n) for k, *_ in MODELOS}
    for tr, te in KFold(5, shuffle=True, random_state=rep).split(np.zeros(n)):
        for k, _, _, f in MODELOS:
            pred[k][te] = f(tr)(te)
    for k in pred:
        cv[k]["rmse"].append(rmse(pred[k], y))
        cv[k]["mae"].append(float(np.mean(np.abs(pred[k] - y))))
        cv[k]["r2"].append(float(1 - np.sum((pred[k] - y) ** 2) / np.sum((y - y.mean()) ** 2)))
        cv[k]["rmse_pp"].append(rmse(100 * pred[k] / causa, pct))
        prev_cv[k] += pred[k] / REPETICOES
log("validação cruzada repetida pronta")

# ---------------------------------------------------------------- bootstrap fora da bolsa e .632+
rng = np.random.default_rng(SEMENTE)
AMOSTRAS = [rng.integers(0, n, n) for _ in range(B)]
todos = np.arange(n)
linhas, RMSE_B = [], {}
for k, rotulo, n_par, f in MODELOS:
    soma, cont, rmse_b = np.zeros(n), np.zeros(n), np.full(B, np.nan)
    for i, idx in enumerate(AMOSTRAS):
        fora = np.setdiff1d(todos, idx)
        e2 = (f(idx)(fora) - y[fora]) ** 2
        np.add.at(soma, fora, e2)
        np.add.at(cont, fora, 1)
        rmse_b[i] = np.sqrt(e2.mean())
    err_1 = float(np.mean(soma[cont > 0] / cont[cont > 0]))            # erro "leave-one-out bootstrap" de Efron
    aparente = f(todos)(todos)
    err_ap = float(np.mean((aparente - y) ** 2))
    gama = float(np.mean((y[:, None] - aparente[None, :]) ** 2))        # erro sem informação
    err_1c = min(err_1, gama)
    taxa = (err_1c - err_ap) / (gama - err_ap) if err_1c > err_ap and gama > err_ap else 0.0
    peso = 0.632 / (1 - 0.368 * min(max(taxa, 0.0), 1.0))
    err_632 = (1 - peso) * err_ap + peso * err_1c
    RMSE_B[k] = rmse_b
    linhas.append({"chave": k, "modelo": rotulo, "parametros": n_par,
                   "rmse_cv": np.mean(cv[k]["rmse"]), "rmse_cv_desvio": np.std(cv[k]["rmse"], ddof=1),
                   "mae_cv": np.mean(cv[k]["mae"]), "r2_cv": np.mean(cv[k]["r2"]), "rmse_pp_cv": np.mean(cv[k]["rmse_pp"]),
                   "rmse_aparente": np.sqrt(err_ap), "rmse_oob": np.sqrt(err_1), "rmse_632mais": np.sqrt(err_632),
                   "taxa_sobreajuste": taxa})
    log(f"{rotulo[:70]:70s} RMSE .632+ {np.sqrt(err_632):8.1f} · CV {np.mean(cv[k]['rmse']):8.1f} · aparente {np.sqrt(err_ap):8.1f}")
comp = pd.DataFrame(linhas)
for col, fn in [("delta_rmse_oob_vs_percentual_medio", np.mean), ("delta_ic95_inf", lambda d: np.percentile(d, 2.5)),
                ("delta_ic95_sup", lambda d: np.percentile(d, 97.5)), ("prob_melhor_que_percentual_medio", lambda d: np.mean(d < 0))]:
    comp[col] = [float(fn(RMSE_B[k] - RMSE_B[REF])) for k in comp["chave"]]
comp.loc[comp["chave"] == REF, "prob_melhor_que_percentual_medio"] = np.nan
comp = comp.sort_values("rmse_632mais")
comp.to_csv(SAIDA / "comparacao_modelos.csv", index=False, float_format="%.6f")
pd.DataFrame(RMSE_B).to_csv(SAIDA / "bootstrap_rmse_oob.csv", index_label="reamostragem", float_format="%.2f")
claramente_melhores = comp[(comp["chave"] != REF) & (comp["delta_ic95_sup"] < 0)]
escolhido = claramente_melhores.iloc[0]["chave"] if len(claramente_melhores) else REF

# ---------------------------------------------------------------- incerteza por bootstrap
rng = np.random.default_rng(SEMENTE + 2)
boot_media = np.array([razao[rng.integers(0, n, n)].mean() for _ in range(5000)])
boot_mediana = np.array([np.median(razao[rng.integers(0, n, n)]) for _ in range(5000)])


def faixa_preditiva(r, gerador, b=5000, residuos=20):
    """Percentual de um acordo novo: incerteza da média (reamostragem) + dispersão dos acordos (resíduo sorteado)."""
    # o resíduo vem da amostra original: tirado da própria reamostragem, cancelaria a média
    residuos_obs = r - r.mean()
    sorteios = []
    for _ in range(b):
        media = r[gerador.integers(0, len(r), len(r))].mean()
        sorteios.append(media + gerador.choice(residuos_obs, residuos))
    return np.concatenate(sorteios)


QUANTIS = (2.5, 10, 25, 50, 75, 90, 97.5)
sorteios = faixa_preditiva(razao, rng)
quantis = {f"p{str(q).replace('.', '_')}": float(np.quantile(sorteios, q / 100)) for q in QUANTIS}

rng_cob = np.random.default_rng(SEMENTE + 3)
cob80, cob95 = [], []
for rep in range(REPETICOES):
    for tr, te in KFold(5, shuffle=True, random_state=rep).split(np.zeros(n)):
        s = faixa_preditiva(razao[tr], rng_cob, b=300)
        q = np.quantile(s, [0.1, 0.9, 0.025, 0.975])
        cob80.append(np.mean((razao[te] >= q[0]) & (razao[te] <= q[1])))
        cob95.append(np.mean((razao[te] >= q[2]) & (razao[te] <= q[3])))

coefs = []
for chave, X, nomes in [("mq_pct_dg", X_dg, ["intercepto", *DOCS, "golpe"]), ("mq_pct_p", X_p, ["intercepto", "p_perda"])]:
    est = 100 * mq(X, razao)
    draws = 100 * np.array([mq(X[s], razao[s]) for s in (rng.integers(0, n, n) for _ in range(2000))])
    for j, nome in enumerate(nomes):
        coefs.append({"modelo": chave, "termo": nome, "estimativa_pp": est[j], "ic95_inf": np.percentile(draws[:, j], 2.5),
                      "ic95_sup": np.percentile(draws[:, j], 97.5), "fracao_sinal_oposto": float(np.mean(np.sign(draws[:, j]) != np.sign(est[j])))})
coefs = pd.DataFrame(coefs)
coefs.to_csv(SAIDA / "coeficientes_bootstrap.csv", index=False, float_format="%.4f")

modelo = {
    "descricao": "valor de acordo típico = percentual × valor da causa; faixas pela distribuição preditiva por bootstrap",
    "alvo": "valor dos acordos homologados na base (não inclui propostas recusadas)",
    "n_acordos": n, "reamostragens_bootstrap": 5000, "sorteios_de_residuo_por_reamostragem": 20,
    "percentual_medio": float(razao.mean()), "ic95_percentual_medio": [float(np.percentile(boot_media, 2.5)), float(np.percentile(boot_media, 97.5))],
    "percentual_mediano": float(np.median(razao)), "ic95_percentual_mediano": [float(np.percentile(boot_mediana, 2.5)), float(np.percentile(boot_mediana, 97.5))],
    "quantis_preditivos_percentual": quantis,
    "cobertura_validacao_cruzada": {"faixa_80": float(np.mean(cob80)), "faixa_95": float(np.mean(cob95))},
    "modelo_escolhido": escolhido,
}
(SAIDA / "modelo.json").write_text(json.dumps(modelo, ensure_ascii=False, indent=2), encoding="utf-8")

(ac[["processo", "uf", "golpe", *DOCS, "n_subsidios", "causa", "valor", "p_perda", "condenacao_esperada"]]
 .assign(percentual=pct, previsto_cv_percentual_medio=prev_cv[REF], previsto_cv_melhor_por_632mais=prev_cv[comp.iloc[0]["chave"]])
 .to_csv(SAIDA / "acordos_com_previsoes.csv", index=False, float_format="%.4f"))

resumo = {"n_processos": len(base), "n_acordos": n, "valor": {q: float(np.quantile(y, q / 100)) for q in (0, 25, 50, 75, 100)},
          "valor_medio": float(y.mean()), "percentual": {"min": float(pct.min()), "max": float(pct.max()), "media": float(pct.mean()),
          "mediana": float(np.median(pct)), "desvio": float(pct.std(ddof=1))},
          "fracao_em_percentual_inteiro": float(np.isclose(pct, np.round(pct), atol=1e-6).mean()),
          "uniformidade_percentual": {"qui_quadrado": float(qui_unif), "p_valor": float(p_unif), "categorias": len(contagem)},
          "fracao_acordos_abaixo_da_condenacao_esperada": float(np.mean(y < CE)),
          "acordo_sobre_condenacao_esperada_mediana": float(np.median(y / CE)),
          "bootstrap": B, "repeticoes_cv": REPETICOES, "melhor_por_632mais": comp.iloc[0]["chave"],
          "modelos_claramente_melhores_que_percentual_medio": claramente_melhores["chave"].tolist(), "modelo_escolhido": escolhido,
          "tempo_s": round(time.time() - T0)}
(SAIDA / "resumo.json").write_text(json.dumps(resumo, ensure_ascii=False, indent=2), encoding="utf-8")

pd.set_option("display.width", 250)
f4 = lambda v: f"{v:.4f}"
print("\n=== RESUMO ===\n", json.dumps(resumo, ensure_ascii=False))
print("\n=== ACORDOS × SENTENÇAS ===\n", selecao.to_string(index=False, float_format=f4))
print("\n=== EFEITO DAS VARIÁVEIS NO PERCENTUAL ===\n", testes.to_string(index=False, float_format=f4))
print("\n=== DESCRITIVA ===\n", descritiva.to_string(index=False, float_format=lambda v: f"{v:.3f}"))
print("\n=== COMPARAÇÃO ===\n", comp.drop(columns=["chave"]).to_string(index=False, float_format=lambda v: f"{v:.3f}"))
print("\n=== COEFICIENTES (p.p., IC por bootstrap) ===\n", coefs.to_string(index=False, float_format=lambda v: f"{v:.3f}"))
print("\n=== MODELO ===\n", json.dumps(modelo, ensure_ascii=False, indent=1))
log("fim")
