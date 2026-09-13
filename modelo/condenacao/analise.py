"""Compara modelos para prever o valor da condenação.

Alvo principal: valor da condenação de cada processo (R$), zero quando o banco ganha.
É o custo esperado de defender, estimado só com o que existe na hora da decisão:
UF, sub-assunto, subsídios juntados e valor da causa.

Alvo secundário: condenação entre os processos perdidos (severidade).

Todos os modelos passam pelas mesmas 5 partições (estratificadas por perda, semente 7).
Os acordos ficam fora, como no modelo de risco.

Uso: python analise.py    (alguns minutos; grava resultados/)
"""
from __future__ import annotations

import json
import time
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.exceptions import ConvergenceWarning
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import TweedieRegressor
from sklearn.metrics import mean_tweedie_deviance, roc_auc_score
from sklearn.model_selection import StratifiedKFold

PASTA = Path(__file__).resolve().parent
DADOS = PASTA.parents[1] / "Hackaton_Enter_Base_Candidatos.xlsx"
SAIDA = PASTA / "resultados"
SUBSIDIOS = {"Contrato": "contrato", "Extrato": "extrato", "Comprovante de crédito": "comprovante",
             "Dossiê": "dossie", "Demonstrativo de evolução da dívida": "demonstrativo", "Laudo referenciado": "laudo"}
DOCS = list(SUBSIDIOS.values())
SEMENTE, K = 7, 5
HGB = dict(learning_rate=0.05, max_iter=600, max_leaf_nodes=15, min_samples_leaf=100, l2_regularization=1.0,
           early_stopping=True, validation_fraction=0.1, n_iter_no_change=30, random_state=SEMENTE)
REF_VAZAMENTO = "vazamento (referência)"
EMP = "empilhamento"
T0 = time.time()
AVISOS: list[str] = []


def log(msg):
    print(f"[{time.time() - T0:6.1f}s] {msg}", flush=True)


# ---------------------------------------------------------------- dados
def carregar() -> pd.DataFrame:
    res = pd.read_excel(DADOS, sheet_name="Resultados dos processos")
    sub = pd.read_excel(DADOS, sheet_name="Subsídios disponibilizados", header=1)
    sub = sub.rename(columns={"Número do processos": "Número do processo"})
    b = res.merge(sub, on="Número do processo", how="inner", validate="1:1")
    b = b[b["Resultado micro"] != "Acordo"].reset_index(drop=True)
    df = pd.DataFrame({"processo": b["Número do processo"], "uf": b["UF"],
                       "golpe": (b["Sub-assunto"] == "Golpe").astype(int), "resultado": b["Resultado micro"],
                       "causa": b["Valor da causa"].astype(float),
                       "cond": b["Valor da condenação/indenização"].astype(float)})
    for coluna, nome in SUBSIDIOS.items():
        df[nome] = b[coluna].astype(int)
    df["perda"] = df["resultado"].isin(["Procedência", "Parcial procedência"]).astype(int)
    df["total"] = (df["resultado"] == "Procedência").astype(int)
    df["razao"] = df["cond"] / df["causa"]
    df["n_doc"] = df[DOCS].sum(1)
    return df


df = carregar()
n = len(df)
y = df["cond"].to_numpy(float)
causa = df["causa"].to_numpy(float)
perda = df["perda"].to_numpy(float)
total = df["total"].to_numpy(float)
razao = df["razao"].to_numpy(float)
golpe = df["golpe"].to_numpy(int)
resultado = df["resultado"].to_numpy(str)
UFS = sorted(df["uf"].unique())
uf_i = df["uf"].map({u: i for i, u in enumerate(UFS)}).to_numpy(int)
ORIGEM = (df["uf"] + "|" + df["processo"].str[21:25]).to_numpy(str)
U = np.eye(len(UFS))[uf_i]
Ue = U[:, :-1] - U[:, [-1]]                      # UF em codificação soma-zero
D = df[DOCS].to_numpy(float)
zs = lambda v: (v - v.mean()) / v.std()
BLOCOS = {"golpe": golpe[:, None].astype(float), "uf": Ue, "causa": zs(causa)[:, None],
          "logcausa": zs(np.log(causa))[:, None], "gxd": D * golpe[:, None],
          "ndoc": np.column_stack([(df["n_doc"].to_numpy() == k).astype(float) for k in range(1, 7)])}
ARV = np.column_stack([D, golpe, uf_i, causa])   # árvores: UF categórica na coluna 7
ARV_OH = np.column_stack([D, golpe, U, causa])   # floresta: UF one-hot
FOLDS = list(StratifiedKFold(K, shuffle=True, random_state=SEMENTE).split(np.zeros(n), perda))


def matriz(partes, excluir=(), intercepto=True, extra=None):
    cols = [np.ones((n, 1))] if intercepto else []
    for p in partes:
        cols.append(D[:, [j for j, d in enumerate(DOCS) if d not in excluir]] if p == "docs" else BLOCOS[p])
    if extra is not None:
        cols.append(extra)
    return np.hstack(cols)


# ---------------------------------------------------------------- ajustes
sig = lambda z: 1 / (1 + np.exp(-np.clip(z, -35, 35)))


def logit(X, alvo, l2=0.1):
    k = X.shape[1]
    b = np.zeros(k)
    b[0] = np.log(alvo.mean() / (1 - alvo.mean()))
    pen = np.full(k, l2)
    pen[0] = 0
    for _ in range(100):
        p = sig(X @ b)
        passo = np.linalg.solve((X * (p * (1 - p))[:, None]).T @ X + np.diag(pen), X.T @ (alvo - p) - pen * b)
        b += passo
        if np.abs(passo).max() < 1e-8:
            break
    return b


def mq(X, alvo, peso=None):
    if peso is None:
        return np.linalg.lstsq(X, alvo, rcond=None)[0]
    s = np.sqrt(peso)
    return np.linalg.lstsq(X * s[:, None], alvo * s, rcond=None)[0]


def glm(potencia, X_tr, alvo, peso, X_te):
    m = TweedieRegressor(power=potencia, link="log", alpha=1e-6, solver="newton-cholesky", max_iter=1000)
    with warnings.catch_warnings(record=True) as ws:
        warnings.simplefilter("always", ConvergenceWarning)
        m.fit(X_tr, alvo, sample_weight=peso)
    if any(issubclass(w.category, ConvergenceWarning) for w in ws):
        AVISOS.append(f"TweedieRegressor power={potencia} não convergiu")
    return m.predict(X_te)


def media_celula(chave_tr, valor, chave_te, reserva, peso=None):
    peso = np.ones(len(valor)) if peso is None else peso
    s = pd.DataFrame({"c": chave_tr, "vw": valor * peso, "w": peso}).groupby("c").sum()
    out = pd.Series(chave_te).map(s["vw"] / s["w"]).to_numpy(float)
    return np.where(np.isnan(out), reserva, out)


def codigo_origem(tr, te, k=10):
    """Taxa de perda da unidade de origem (UF + código CNJ), codificada fora da amostra."""
    prior = pd.Series(perda[tr]).groupby(uf_i[tr]).mean()
    col = np.full(n, 0.5)

    def codificar(base, alvo_idx):
        g = pd.DataFrame({"c": ORIGEM[base], "y": perda[base]}).groupby("c")["y"].agg(["sum", "count"])
        c = pd.Series(ORIGEM[alvo_idx])
        soma, cont = c.map(g["sum"]).fillna(0).to_numpy(), c.map(g["count"]).fillna(0).to_numpy()
        return (soma + k * prior.reindex(uf_i[alvo_idx]).to_numpy()) / (cont + k)

    for a, b in StratifiedKFold(5, shuffle=True, random_state=SEMENTE + 1).split(tr, perda[tr]):
        col[tr[b]] = codificar(tr[a], tr[b])
    col[te] = codificar(tr, te)
    lg = np.log(col / (1 - col))
    return ((lg - lg[tr].mean()) / lg[tr].std())[:, None]


EXTRAS = {"origem": codigo_origem}
_P, _S = {}, {}


def p_perda(i, tr, te, partes=("docs", "golpe", "uf"), excluir=(), extra=None):
    chave = (i, partes, excluir, extra)
    if chave not in _P:
        X = matriz(partes, excluir, extra=EXTRAS[extra](tr, te) if extra else None)
        _P[chave] = sig(X[te] @ logit(X[tr], perda[tr]))
    return _P[chave]


def severidade(i, tr, te, tipo):
    """E[condenação ÷ causa | perda] nas linhas de teste, aprendida nas perdas do treino."""
    if (i, tipo) in _S:
        return _S[(i, tipo)]
    trp = tr[perda[tr] == 1]
    r = razao[trp]
    por_uf = lambda: media_celula(uf_i[trp], r, uf_i[te], r.mean())
    ufsub_tr, ufsub_te = uf_i[trp] * 2 + golpe[trp], uf_i[te] * 2 + golpe[te]
    if tipo == "global":
        s = np.full(len(te), r.mean())
    elif tipo == "uf":
        s = por_uf()
    elif tipo == "ufsub":
        s = media_celula(ufsub_tr, r, ufsub_te, por_uf())
    elif tipo == "ufsub_peso_causa":
        s = media_celula(ufsub_tr, r, ufsub_te, por_uf(), peso=causa[trp])
    elif tipo == "ufsub_peso_causa2":
        s = media_celula(ufsub_tr, r, ufsub_te, por_uf(), peso=causa[trp] ** 2)
    elif tipo == "ufsub_ndoc":
        chave = uf_i * 10 + golpe * 5 + np.clip(df["n_doc"].to_numpy() - 2, 0, 4)
        s = media_celula(chave[trp], r, chave[te], media_celula(ufsub_tr, r, ufsub_te, por_uf()))
    elif tipo in ("mq_ufg", "mq_docs_ufg", "mq_ufg_causa"):
        partes = {"mq_ufg": ("golpe", "uf"), "mq_docs_ufg": ("docs", "golpe", "uf"),
                  "mq_ufg_causa": ("golpe", "uf", "causa")}[tipo]
        X = matriz(partes)
        s = X[te] @ mq(X[trp], r)
    elif tipo in ("gama_ufg", "gama_docs_ufg"):
        X = matriz(("golpe", "uf") if tipo == "gama_ufg" else ("docs", "golpe", "uf"), intercepto=False)
        s = glm(2, X[trp], r, None, X[te])
    elif tipo == "hgb":
        m = HistGradientBoostingRegressor(categorical_features=[7], **HGB)
        w = causa[trp] ** 2
        m.fit(ARV[trp], r, sample_weight=w / w.mean())
        s = m.predict(ARV[te])
    elif tipo in ("tres_partes", "tres_partes_docs"):
        X = matriz(("golpe", "uf") if tipo == "tres_partes" else ("docs", "golpe", "uf"))
        p_total = sig(X[te] @ logit(X[trp], total[trp]))
        tot, par = trp[total[trp] == 1], trp[total[trp] == 0]
        r_tot = media_celula(uf_i[tot], razao[tot], uf_i[te], razao[tot].mean())
        r_par = media_celula(uf_i[par] * 2 + golpe[par], razao[par], ufsub_te,
                             media_celula(uf_i[par], razao[par], uf_i[te], razao[par].mean()))
        s = p_total * r_tot + (1 - p_total) * r_par
    else:
        raise ValueError(tipo)
    _S[(i, tipo)] = s
    return s


# ---------------------------------------------------------------- modelos
def media_global(i, tr, te):
    return {"cond": np.full(len(te), y[tr].mean())}


def media_uf(i, tr, te):
    return {"cond": media_celula(uf_i[tr], y[tr], uf_i[te], y[tr].mean())}


def razao_global(i, tr, te):
    return {"cond": causa[te] * y[tr].sum() / causa[tr].sum()}


def direto_mq(partes, alvo="cond", ponderado=False, interacao_causa=False):
    def f(i, tr, te):
        X = matriz(partes)
        if interacao_causa:
            X = np.hstack([X, X * (causa / 1e4)[:, None]])
        if alvo == "cond":
            return {"cond": X[te] @ mq(X[tr], y[tr])}
        w = (causa[tr] ** 2) / np.mean(causa[tr] ** 2) if ponderado else None
        return {"cond": (X[te] @ mq(X[tr], razao[tr], w)) * causa[te]}
    return f


def direto_glm(potencia, partes, offset):
    def f(i, tr, te):
        X = matriz(partes, intercepto=False)
        if offset:  # E[cond] = causa × exp(Xb): ajusta a razão com peso causa^(2-p)
            w = causa[tr] ** (2 - potencia)
            return {"cond": glm(potencia, X[tr], razao[tr], w / w.mean(), X[te]) * causa[te]}
        return {"cond": glm(potencia, X[tr], y[tr], None, X[te])}
    return f


def hgb_direto(funcao_perda, alvo):
    def f(i, tr, te):
        m = HistGradientBoostingRegressor(loss=funcao_perda, categorical_features=[7], **HGB)
        if alvo == "cond":
            m.fit(ARV[tr], y[tr])
            return {"cond": m.predict(ARV[te])}
        w = causa[tr] ** 2
        m.fit(ARV[tr], razao[tr], sample_weight=w / w.mean())
        return {"cond": m.predict(ARV[te]) * causa[te]}
    return f


def floresta(i, tr, te):
    m = RandomForestRegressor(n_estimators=200, min_samples_leaf=30, max_features=0.6, n_jobs=-1, random_state=SEMENTE)
    m.fit(ARV_OH[tr], y[tr])
    return {"cond": m.predict(ARV_OH[te])}


def hgb_duas_partes(i, tr, te):
    c = HistGradientBoostingClassifier(categorical_features=[7], **HGB).fit(ARV[tr], perda[tr])
    p = c.predict_proba(ARV[te])[:, 1]
    s = severidade(i, tr, te, "hgb")
    return {"cond": p * s * causa[te], "sev": s * causa[te], "p": p}


def duas_partes(sev="ufsub", **p_kw):
    def f(i, tr, te):
        p = p_perda(i, tr, te, **p_kw)
        s = severidade(i, tr, te, sev)
        return {"cond": p * s * causa[te], "sev": s * causa[te], "p": p}
    return f


def ref_perda(i, tr, te):
    return {"cond": perda[te] * severidade(i, tr, te, "ufsub") * causa[te]}


def ref_resultado(i, tr, te):
    chave = np.char.add(np.char.add(resultado, "|"), df["uf"].to_numpy(str))
    reserva = media_celula(resultado[tr], razao[tr], resultado[te], razao[tr].mean())
    return {"cond": media_celula(chave[tr], razao[tr], chave[te], reserva) * causa[te]}


# ---------------------------------------------------------------- empilhamento: P(perda) como variável
_PA = {}
P_ARQUIVO = (df[["processo"]]
             .merge(pd.read_csv(PASTA.parent / "taxa_de_risco" / "resultados" / "previsoes_validacao.csv", usecols=["processo", "p_perda_validacao"]),
                    on="processo", how="left", validate="1:1")["p_perda_validacao"].to_numpy(float))
assert not np.isnan(P_ARQUIVO).any(), "rode ../taxa_de_risco/treinar.py antes"
logito = lambda p: np.log(p / (1 - p))


def sev_ufsub_de(base, alvo):
    bp = base[perda[base] == 1]
    r = razao[bp]
    return media_celula(uf_i[bp] * 2 + golpe[bp], r, uf_i[alvo] * 2 + golpe[alvo], media_celula(uf_i[bp], r, uf_i[alvo], r.mean()))


def p_aninhada(i, tr, te):
    """P(perda) e severidade fora da amostra também nas linhas de treino, por validação interna."""
    if i not in _PA:
        X = matriz(("docs", "golpe", "uf"))
        p_tr, s_tr = np.zeros(len(tr)), np.zeros(len(tr))
        for a, b in StratifiedKFold(5, shuffle=True, random_state=SEMENTE + 1).split(tr, perda[tr]):
            p_tr[b] = sig(X[tr[b]] @ logit(X[tr[a]], perda[tr[a]]))
            s_tr[b] = sev_ufsub_de(tr[a], tr[b])
        _PA[i] = (p_tr, p_perda(i, tr, te), s_tr, sev_ufsub_de(tr, te))
    return _PA[i]


def empilhado(tipo, arquivo=False):
    def f(i, tr, te):
        p_tr, p_te, s_tr, s_te = p_aninhada(i, tr, te)
        if arquivo:  # P(perda) salva em ../taxa_de_risco/resultados: nas linhas de treino, veio de modelos que viram o teste
            p_tr, p_te = P_ARQUIVO[tr], P_ARQUIVO[te]
        p_tr, p_te = np.clip(p_tr, 1e-6, 1 - 1e-6), np.clip(p_te, 1e-6, 1 - 1e-6)
        c_tr, c_te = causa[tr], causa[te]
        if tipo == "mq_pc":
            pred = (p_te * c_te)[:, None] @ mq((p_tr * c_tr)[:, None], y[tr])
        elif tipo == "mq_pcs":
            pred = (p_te * c_te * s_te)[:, None] @ mq((p_tr * c_tr * s_tr)[:, None], y[tr])
        elif tipo == "mq_pc_ufsub":
            Z = np.column_stack([U, U * golpe[:, None]])
            pred = (Z[te] * (p_te * c_te)[:, None]) @ mq(Z[tr] * (p_tr * c_tr)[:, None], y[tr])
        elif tipo == "mq_linear":
            X = matriz(("docs", "golpe", "uf"))
            pred = (np.column_stack([X[te], p_te * c_te, p_te, c_te / 1e4])
                    @ mq(np.column_stack([X[tr], p_tr * c_tr, p_tr, c_tr / 1e4]), y[tr]))
        elif tipo in ("poisson_offset_p", "tweedie_offset_p"):
            pot = 1 if tipo.startswith("poisson") else 1.5
            X = matriz(("golpe", "uf"), intercepto=False)
            w = (p_tr * c_tr) ** (2 - pot)
            pred = glm(pot, X[tr], y[tr] / (p_tr * c_tr), w / w.mean(), X[te]) * p_te * c_te
        elif tipo == "tweedie_logp":
            X = matriz(("golpe", "uf"), intercepto=False)
            w = c_tr ** 0.5
            pred = glm(1.5, np.column_stack([X[tr], np.log(p_tr)]), razao[tr], w / w.mean(),
                       np.column_stack([X[te], np.log(p_te)])) * c_te
        elif tipo in ("hgb_p", "hgb_p_docs"):
            extra_tr, extra_te = ([D[tr]], [D[te]]) if tipo == "hgb_p_docs" else ([], [])
            m = HistGradientBoostingRegressor(categorical_features=[2], **HGB)
            m.fit(np.column_stack([p_tr, c_tr, uf_i[tr], golpe[tr], *extra_tr]), y[tr])
            pred = m.predict(np.column_stack([p_te, c_te, uf_i[te], golpe[te], *extra_te]))
        elif tipo == "hgb_razao_p":
            m = HistGradientBoostingRegressor(categorical_features=[1], **HGB)
            w = c_tr ** 2
            m.fit(np.column_stack([p_tr, uf_i[tr], golpe[tr]]), razao[tr], sample_weight=w / w.mean())
            pred = m.predict(np.column_stack([p_te, uf_i[te], golpe[te]])) * c_te
        elif tipo == "isotonica":
            iso = IsotonicRegression(y_min=0, y_max=1, out_of_bounds="clip").fit(p_tr, perda[tr])
            pred = iso.predict(p_te) * c_te * s_te
        elif tipo == "platt":
            b = logit(np.column_stack([np.ones(len(tr)), logito(p_tr)]), perda[tr])
            pred = sig(np.column_stack([np.ones(len(te)), logito(p_te)]) @ b) * c_te * s_te
        else:
            raise ValueError(tipo)
        return {"cond": pred}
    return f


X3 = ("docs", "golpe", "uf")
MODELOS = [
    ("media_global", "referência", "Média geral da condenação", media_global),
    ("media_uf", "referência", "Média da condenação por UF", media_uf),
    ("razao_global", "referência", "Valor da causa × razão média da base", razao_global),
    ("mq_causa", "linear direto", "MQO: condenação ~ causa", direto_mq(("causa",))),
    ("mq_x", "linear direto", "MQO: condenação ~ subsídios + golpe + UF", direto_mq(X3)),
    ("mq_x_causa", "linear direto", "MQO: condenação ~ subsídios + golpe + UF + causa", direto_mq(X3 + ("causa",))),
    ("mq_x_por_causa", "linear direto", "MQO: condenação ~ (subsídios + golpe + UF) × causa", direto_mq(X3, interacao_causa=True)),
    ("mq_razao", "linear direto", "MQO na razão condenação ÷ causa, × causa", direto_mq(X3, alvo="razao")),
    ("mqp_razao", "linear direto", "MQ ponderado (causa²) na razão, × causa", direto_mq(X3, alvo="razao", ponderado=True)),
    ("poisson_offset", "GLM", "Poisson log, offset log(causa)", direto_glm(1, X3, True)),
    ("poisson_logcausa", "GLM", "Poisson log, log(causa) como variável", direto_glm(1, X3 + ("logcausa",), False)),
    ("tweedie_offset", "GLM", "Tweedie p=1,5 log, offset log(causa)", direto_glm(1.5, X3, True)),
    ("tweedie_logcausa", "GLM", "Tweedie p=1,5 log, log(causa) como variável", direto_glm(1.5, X3 + ("logcausa",), False)),
    ("tweedie_offset_gxd", "GLM", "Tweedie p=1,5 offset + golpe × subsídios", direto_glm(1.5, X3 + ("gxd",), True)),
    ("hgb_quadratico", "árvores", "Gradient boosting (erro quadrático) na condenação", hgb_direto("squared_error", "cond")),
    ("hgb_poisson", "árvores", "Gradient boosting (Poisson) na condenação", hgb_direto("poisson", "cond")),
    ("hgb_razao", "árvores", "Gradient boosting na razão (peso causa²), × causa", hgb_direto("squared_error", "razao")),
    ("floresta", "árvores", "Floresta aleatória na condenação", floresta),
    ("hgb_duas_partes", "árvores", "Gradient boosting em duas partes (P(perda) × severidade)", hgb_duas_partes),
    ("dp_global", "duas partes", "Logística × causa × severidade média", duas_partes("global")),
    ("dp_uf", "duas partes", "Logística × causa × severidade por UF", duas_partes("uf")),
    ("dp_ufsub", "duas partes", "Logística × causa × severidade por UF e sub-assunto (motor atual)", duas_partes("ufsub")),
    ("dp_ufsub_w1", "duas partes", "idem, severidade ponderada por causa", duas_partes("ufsub_peso_causa")),
    ("dp_ufsub_w2", "duas partes", "idem, severidade ponderada por causa²", duas_partes("ufsub_peso_causa2")),
    ("dp_ufsub_ndoc", "duas partes", "Logística × causa × severidade por UF, sub-assunto e nº subsídios", duas_partes("ufsub_ndoc")),
    ("dp_mq_ufg", "duas partes", "Logística × causa × MQO severidade ~ golpe + UF", duas_partes("mq_ufg")),
    ("dp_mq_docs", "duas partes", "Logística × causa × MQO severidade ~ subsídios + golpe + UF", duas_partes("mq_docs_ufg")),
    ("dp_mq_causa", "duas partes", "Logística × causa × MQO severidade ~ golpe + UF + causa", duas_partes("mq_ufg_causa")),
    ("dp_gama", "duas partes", "Logística × causa × Gama severidade ~ golpe + UF", duas_partes("gama_ufg")),
    ("dp_gama_docs", "duas partes", "Logística × causa × Gama severidade ~ subsídios + golpe + UF", duas_partes("gama_docs_ufg")),
    ("dp_hgb_sev", "duas partes", "Logística × causa × boosting na severidade", duas_partes("hgb")),
    ("tres_partes", "três partes", "Logística × [P(total) × razão total + P(parcial) × razão parcial] × causa", duas_partes("tres_partes")),
    ("tres_partes_docs", "três partes", "idem, com subsídios em P(total | perda)", duas_partes("tres_partes_docs")),
    ("emp_mq_pc", EMP, "MQO sem intercepto: condenação ~ P(perda) × causa", empilhado("mq_pc")),
    ("emp_mq_pcs", EMP, "MQO sem intercepto: condenação ~ P(perda) × causa × severidade UF×sub", empilhado("mq_pcs")),
    ("emp_mq_pc_ufsub", EMP, "MQO: condenação ~ P(perda) × causa × (UF × sub-assunto), zeros incluídos", empilhado("mq_pc_ufsub")),
    ("emp_mq_linear", EMP, "MQO: condenação ~ P(perda) × causa + P(perda) + causa + subsídios + golpe + UF", empilhado("mq_linear")),
    ("emp_poisson_offset_p", EMP, "Poisson log: offset log(P(perda) × causa) + golpe + UF", empilhado("poisson_offset_p")),
    ("emp_tweedie_offset_p", EMP, "Tweedie p=1,5 log: offset log(P(perda) × causa) + golpe + UF", empilhado("tweedie_offset_p")),
    ("emp_tweedie_logp", EMP, "Tweedie p=1,5 log: log(P(perda)) livre + golpe + UF, offset log(causa)", empilhado("tweedie_logp")),
    ("emp_hgb_p", EMP, "Gradient boosting: condenação ~ P(perda), causa, UF, golpe", empilhado("hgb_p")),
    ("emp_hgb_p_docs", EMP, "Gradient boosting: condenação ~ P(perda), causa, UF, golpe, subsídios", empilhado("hgb_p_docs")),
    ("emp_hgb_razao_p", EMP, "Gradient boosting na razão ~ P(perda), UF, golpe (peso causa²), × causa", empilhado("hgb_razao_p")),
    ("emp_isotonica", EMP, "P(perda) recalibrada por isotônica × causa × severidade UF×sub", empilhado("isotonica")),
    ("emp_platt", EMP, "P(perda) recalibrada por logística no logit × causa × severidade UF×sub", empilhado("platt")),
    ("emp_hgb_p_arquivo", EMP, "Gradient boosting ~ P(perda) do arquivo salvo, causa, UF, golpe", empilhado("hgb_p", arquivo=True)),
    ("emp_mq_pcs_arquivo", EMP, "MQO ~ P(perda) do arquivo salvo × causa × severidade UF×sub", empilhado("mq_pcs", arquivo=True)),
    *[(f"ab_sem_{d}", "ablação P(perda)", f"sem {d}", duas_partes("ufsub", excluir=(d,))) for d in DOCS],
    ("ab_sem_dossie_laudo", "ablação P(perda)", "sem dossie e laudo", duas_partes("ufsub", excluir=("dossie", "laudo"))),
    ("ab_sem_docs", "ablação P(perda)", "sem nenhum subsídio", duas_partes("ufsub", partes=("golpe", "uf"))),
    ("ab_ndoc", "ablação P(perda)", "nº de subsídios no lugar dos seis", duas_partes("ufsub", partes=("ndoc", "golpe", "uf"))),
    ("ab_sem_uf", "ablação P(perda)", "sem UF", duas_partes("ufsub", partes=("docs", "golpe"))),
    ("ab_sem_golpe", "ablação P(perda)", "sem sub-assunto", duas_partes("ufsub", partes=("docs", "uf"))),
    ("ab_mais_causa", "ablação P(perda)", "+ valor da causa", duas_partes("ufsub", partes=X3 + ("causa",))),
    ("ab_mais_logcausa", "ablação P(perda)", "+ log(valor da causa)", duas_partes("ufsub", partes=X3 + ("logcausa",))),
    ("ab_mais_gxd", "ablação P(perda)", "+ golpe × subsídios", duas_partes("ufsub", partes=X3 + ("gxd",))),
    ("ab_mais_origem", "ablação P(perda)", "+ código de origem do CNJ (codificado fora da amostra)", duas_partes("ufsub", extra="origem")),
    ("ref_perda", REF_VAZAMENTO, "Sabendo se perdeu: perda × causa × severidade UF×sub", ref_perda),
    ("ref_resultado", REF_VAZAMENTO, "Sabendo o resultado: causa × razão média do resultado na UF", ref_resultado),
]


# ---------------------------------------------------------------- avaliação
def metricas(obs, prev):
    erro = prev - obs
    lorenz = lambda o: np.cumsum(obs[o]).sum() / obs.sum() / len(obs) - (len(obs) + 1) / (2 * len(obs))
    return {"rmse": float(np.sqrt(np.mean(erro ** 2))), "mae": float(np.mean(np.abs(erro))),
            "r2": float(1 - np.sum(erro ** 2) / np.sum((obs - obs.mean()) ** 2)),
            "desvio_tweedie_1_5": float(mean_tweedie_deviance(obs, np.maximum(prev, 1.0), power=1.5)),
            "gini": float(lorenz(np.argsort(-prev, kind="mergesort")) / lorenz(np.argsort(-obs, kind="mergesort"))),
            "vies_pct": float(100 * (prev.sum() / obs.sum() - 1)), "previsoes_negativas": int((prev < 0).sum())}


RES, OOF, OOF_SEV, RMSE_PART = [], {}, {}, {}
for chave, grupo, rotulo, f in MODELOS:
    oof, oof_p, oof_s, part = np.zeros(n), np.full(n, np.nan), np.full(n, np.nan), []
    for i, (tr, te) in enumerate(FOLDS):
        out = f(i, tr, te)
        oof[te] = out["cond"]
        part.append(float(np.sqrt(np.mean((out["cond"] - y[te]) ** 2))))
        if "p" in out:
            oof_p[te] = out["p"]
        if "sev" in out:
            oof_s[te] = out["sev"]
    linha = {"chave": chave, "grupo": grupo, "modelo": rotulo, **metricas(y, oof),
             "rmse_desvio_particoes": float(np.std(part, ddof=1)),
             "auc_perda": float(roc_auc_score(perda, oof_p)) if not np.isnan(oof_p).any() else np.nan}
    RES.append(linha)
    OOF[chave], RMSE_PART[chave] = oof, np.array(part)
    if not np.isnan(oof_s).any():
        OOF_SEV[chave] = oof_s
    log(f"{grupo:22s} {rotulo[:62]:62s} RMSE {linha['rmse']:8.1f}  R² {linha['r2']:.4f}  Gini {linha['gini']:.4f}  viés {linha['vies_pct']:+.2f}%")

tab = pd.DataFrame(RES)
utilizaveis = tab[tab["grupo"] != REF_VAZAMENTO]
melhor = utilizaveis.sort_values("rmse").iloc[0]["chave"]
for alvo, nome in [(melhor, "melhor"), ("dp_ufsub", "motor_atual")]:
    tab[f"delta_rmse_vs_{nome}"] = [float(np.mean(RMSE_PART[k] - RMSE_PART[alvo])) for k in tab["chave"]]
    tab[f"delta_rmse_vs_{nome}_desvio"] = [float(np.std(RMSE_PART[k] - RMSE_PART[alvo], ddof=1)) for k in tab["chave"]]
    tab[f"particoes_melhores_que_{nome}"] = [int((RMSE_PART[k] < RMSE_PART[alvo]).sum()) for k in tab["chave"]]
tab.sort_values("rmse").to_csv(SAIDA / "comparacao_modelos.csv", index=False, float_format="%.6f")

mask = perda == 1
rotulos = dict(zip(tab["chave"], tab["modelo"]))
sev = pd.DataFrame([{"chave": k, "modelo": rotulos[k], **metricas(y[mask], s[mask])} for k, s in OOF_SEV.items()
                    if not k.startswith("ab_")]).sort_values("rmse")
sev.to_csv(SAIDA / "severidade_modelos.csv", index=False, float_format="%.6f")

for chave in dict.fromkeys([melhor, "dp_ufsub"]):
    dec = pd.qcut(OOF[chave], 10, labels=False, duplicates="drop") + 1
    (pd.DataFrame({"decil": dec, "previsto": OOF[chave], "observado": y}).groupby("decil")
     .agg(n=("observado", "size"), previsto_medio=("previsto", "mean"), observado_medio=("observado", "mean")).reset_index()
     .assign(desvio=lambda t: t["observado_medio"] - t["previsto_medio"])
     .to_csv(SAIDA / f"calibracao_{chave}.csv", index=False, float_format="%.4f"))
pd.DataFrame({"processo": df["processo"], "perda": df["perda"], "condenacao": y, "previsto_melhor": OOF[melhor],
              "previsto_motor_atual": OOF["dp_ufsub"]}).to_csv(SAIDA / "previsoes_validacao.csv", index=False, float_format="%.2f")

# ---------------------------------------------------------------- descritiva
def descrever(chave):
    g, gp = df.groupby(chave), df[df["perda"] == 1].groupby(chave)
    return pd.DataFrame({"n": g.size(), "taxa_perda": g["perda"].mean(), "causa_media": g["causa"].mean(),
                         "condenacao_media": g["cond"].mean(), "condenacao_media_se_perder": gp["cond"].mean(),
                         "severidade_se_perder": gp["razao"].mean()}).reset_index()


descrever("uf").to_csv(SAIDA / "descritiva_uf.csv", index=False, float_format="%.4f")
descrever("n_doc").to_csv(SAIDA / "descritiva_n_subsidios.csv", index=False, float_format="%.4f")
descrever("golpe").to_csv(SAIDA / "descritiva_subassunto.csv", index=False, float_format="%.4f")
df["faixa_causa"] = pd.qcut(df["causa"], 5).astype(str)
descrever("faixa_causa").to_csv(SAIDA / "descritiva_faixa_causa.csv", index=False, float_format="%.4f")
variaveis = DOCS + ["n_doc", "golpe", "causa"]
perdas = df[df["perda"] == 1]
pd.DataFrame({"variavel": variaveis,
              "corr_condenacao": [np.corrcoef(df[v], df["cond"])[0, 1] for v in variaveis],
              "corr_condenacao_se_perder": [np.corrcoef(perdas[v], perdas["cond"])[0, 1] for v in variaveis],
              "corr_severidade_se_perder": [np.corrcoef(perdas[v], perdas["razao"])[0, 1] for v in variaveis]}
             ).to_csv(SAIDA / "correlacoes.csv", index=False, float_format="%.4f")
resumo = {"n_modelo": n, "n_modelos_testados": len(MODELOS), "particoes": K, "semente": SEMENTE,
          "pct_zeros": float(100 * (y == 0).mean()), "condenacao_media": float(y.mean()),
          "condenacao_desvio": float(y.std()), "condenacao_quantis": {q: float(np.quantile(y, q / 100)) for q in (50, 75, 90, 99)},
          "condenacao_media_se_perder": float(y[mask].mean()), "corr_condenacao_causa": float(np.corrcoef(y, causa)[0, 1]),
          "corr_condenacao_causa_se_perder": float(np.corrcoef(y[mask], causa[mask])[0, 1]),
          "melhor_modelo": melhor, "avisos": sorted(set(AVISOS)), "tempo_s": round(time.time() - T0)}
(SAIDA / "resumo.json").write_text(json.dumps(resumo, ensure_ascii=False, indent=2), encoding="utf-8")

pd.set_option("display.width", 250)
cols = ["modelo", "rmse", "rmse_desvio_particoes", "r2", "mae", "desvio_tweedie_1_5", "gini", "vies_pct", "auc_perda",
        "delta_rmse_vs_melhor", "particoes_melhores_que_melhor", "delta_rmse_vs_motor_atual", "previsoes_negativas"]
fmt = lambda v: f"{v:.4f}" if isinstance(v, float) else v
print("\n================ COMPARAÇÃO (RMSE fora da amostra, R$) ================")
for g_, t in tab.sort_values("rmse").groupby("grupo", sort=False):
    print(f"\n--- {g_}")
    print(t[cols].to_string(index=False, float_format=lambda v: f"{v:.4f}"))
print("\n================ SEVERIDADE: condenação entre as perdas ================")
print(sev[["modelo", "rmse", "r2", "mae", "gini", "vies_pct"]].to_string(index=False, float_format=lambda v: f"{v:.4f}"))
print("\nresumo:", json.dumps(resumo, ensure_ascii=False))
log("fim")
