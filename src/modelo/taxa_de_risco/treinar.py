"""Treina o modelo de taxa de risco para ações de "não reconhece operação".

O modelo tem duas partes, estimadas com processos já julgados:

1. Risco: regressão logística aditiva
       P(perda) = σ(β₀ + Σ β_subsídio + β_golpe + β_UF)
   perda = 1 para procedência ou parcial procedência; 0 para improcedência ou extinção.
   Os acordos ficam fora, porque não são sentença.
2. Severidade: média de condenação ÷ valor da causa entre as perdas, por UF e sub-assunto.

Uso:
    python treinar.py
    python treinar.py --dados caminho/Hackaton_Enter_Base_Candidatos.xlsx --saida resultados
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import StratifiedKFold

PASTA = Path(__file__).resolve().parent
DADOS_PADRAO = PASTA.parents[2] / "data" / "Hackaton_Enter_Base_Candidatos.xlsx"

# coluna da aba "Subsídios disponibilizados" -> nome da variável no modelo
SUBSIDIOS = {
    "Contrato": "contrato",
    "Extrato": "extrato",
    "Comprovante de crédito": "comprovante",
    "Dossiê": "dossie",
    "Demonstrativo de evolução da dívida": "demonstrativo",
    "Laudo referenciado": "laudo",
}
VARS_SUBSIDIO = list(SUBSIDIOS.values())
TODAS_UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA",
             "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"]
Z95 = 1.959964
N_PARTICOES = 5
SEMENTE = 7


def sigmoide(z):
    return 1.0 / (1.0 + np.exp(-np.clip(z, -35, 35)))


def carregar(caminho: Path) -> tuple[pd.DataFrame, dict]:
    resultados = pd.read_excel(caminho, sheet_name="Resultados dos processos")
    # a aba de subsídios traz uma legenda na 1ª linha; o cabeçalho está na 2ª
    subsidios = pd.read_excel(caminho, sheet_name="Subsídios disponibilizados", header=1)
    subsidios = subsidios.rename(columns={"Número do processos": "Número do processo"})
    base = resultados.merge(subsidios, on="Número do processo", how="inner", validate="1:1")
    if not len(base) == len(resultados) == len(subsidios):
        raise ValueError("as abas de resultados e subsídios não casam 1:1 pelo número do processo")

    acordo = base["Resultado micro"] == "Acordo"
    info = {"n_planilha": len(base), "n_acordos_excluidos": int(acordo.sum())}
    base = base[~acordo].reset_index(drop=True)

    df = pd.DataFrame({
        "processo": base["Número do processo"],
        "uf": base["UF"],
        "golpe": (base["Sub-assunto"] == "Golpe").astype(int),
        "perda": base["Resultado micro"].isin(["Procedência", "Parcial procedência"]).astype(int),
        "valor_causa": base["Valor da causa"].astype(float),
        "condenacao": base["Valor da condenação/indenização"].astype(float),
    })
    for coluna, nome in SUBSIDIOS.items():
        df[nome] = base[coluna].astype(int)
    return df, info


def matriz(df: pd.DataFrame, ufs: list[str]) -> tuple[np.ndarray, list[str]]:
    """Intercepto, 6 subsídios, golpe e UF em codificação soma-zero (efeito relativo à UF média)."""
    indice = df["uf"].map({u: i for i, u in enumerate(ufs)})
    if indice.isna().any():
        raise ValueError(f"UF fora do modelo: {sorted(df.loc[indice.isna(), 'uf'].unique())}")
    n = len(df)
    uf = np.zeros((n, len(ufs)))
    uf[np.arange(n), indice.to_numpy(int)] = 1.0
    X = np.column_stack([
        np.ones(n),
        df[VARS_SUBSIDIO].to_numpy(float),
        df["golpe"].to_numpy(float),
        uf[:, :-1] - uf[:, [-1]],
    ])
    return X, ["intercepto", *VARS_SUBSIDIO, "golpe", *[f"uf_{u}" for u in ufs[:-1]]]


def ajustar(X: np.ndarray, y: np.ndarray, max_iter: int = 100, tol: float = 1e-10):
    """Máxima verossimilhança por Newton-Raphson. Devolve coeficientes e covariância."""
    beta = np.zeros(X.shape[1])
    beta[0] = np.log(y.mean() / (1 - y.mean()))
    for _ in range(max_iter):
        p = sigmoide(X @ beta)
        hessiana = (X * (p * (1 - p))[:, None]).T @ X
        passo = np.linalg.solve(hessiana, X.T @ (y - p))
        beta += passo
        if np.max(np.abs(passo)) < tol:
            break
    else:
        raise RuntimeError("Newton-Raphson não convergiu")
    p = sigmoide(X @ beta)
    hessiana = (X * (p * (1 - p))[:, None]).T @ X
    return beta, np.linalg.inv(hessiana)


def metricas(y: np.ndarray, p: np.ndarray) -> dict:
    p = np.clip(p, 1e-12, 1 - 1e-12)
    return {
        "log_loss": float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))),
        "auc": float(roc_auc_score(y, p)),
        "brier": float(np.mean((p - y) ** 2)),
    }


def validar(X: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, list[dict]]:
    """Validação cruzada estratificada. Devolve a previsão fora da amostra de cada processo."""
    particoes = StratifiedKFold(N_PARTICOES, shuffle=True, random_state=SEMENTE)
    previsto = np.zeros(len(y))
    detalhe = []
    for i, (treino, teste) in enumerate(particoes.split(X, y), start=1):
        beta, _ = ajustar(X[treino], y[treino])
        previsto[teste] = sigmoide(X[teste] @ beta)
        taxa_base = np.full(len(teste), y[treino].mean())
        detalhe.append({"particao": i, "n_teste": int(len(teste)), **metricas(y[teste], previsto[teste]),
                        "log_loss_taxa_base": metricas(y[teste], taxa_base)["log_loss"]})
    return previsto, detalhe


def tabela_coeficientes(X, nomes, beta, cov) -> pd.DataFrame:
    eta = X @ beta
    erro = np.sqrt(np.diag(cov))
    linhas = []
    for j, nome in enumerate(nomes):
        if nome.startswith("uf_"):
            continue
        inf, sup = beta[j] - Z95 * erro[j], beta[j] + Z95 * erro[j]
        linha = {"termo": nome, "log_odds": beta[j], "erro_padrao": erro[j], "ic95_inf": inf, "ic95_sup": sup,
                 "razao_chances": np.nan, "efeito_medio_pp": np.nan, "distinguivel_de_zero": bool(inf > 0 or sup < 0)}
        if nome != "intercepto":
            # efeito médio marginal: P(perda) com a variável = 1 menos com = 0, na carteira inteira
            com = sigmoide(eta + beta[j] * (1 - X[:, j]))
            sem = sigmoide(eta - beta[j] * X[:, j])
            linha.update(razao_chances=np.exp(beta[j]), efeito_medio_pp=100 * float(np.mean(com - sem)))
        linhas.append(linha)
    return pd.DataFrame(linhas)


def tabela_uf(X, nomes, beta, cov, ufs) -> pd.DataFrame:
    j = [i for i, nome in enumerate(nomes) if nome.startswith("uf_")]
    cov_uf = cov[np.ix_(j, j)]
    efeito = np.append(beta[j], -beta[j].sum())  # soma-zero: a última UF é menos a soma das outras
    erro = np.append(np.sqrt(np.diag(cov_uf)), np.sqrt(cov_uf.sum()))
    linhas = []
    for i, uf in enumerate(ufs):
        # padronização direta: P(perda) média se a carteira inteira estivesse nesta UF
        Xu = X.copy()
        Xu[:, j] = 0.0
        if i < len(ufs) - 1:
            Xu[:, j[i]] = 1.0
        else:
            Xu[:, j] = -1.0
        inf, sup = efeito[i] - Z95 * erro[i], efeito[i] + Z95 * erro[i]
        linhas.append({"uf": uf, "log_odds": efeito[i], "erro_padrao": erro[i], "ic95_inf": inf, "ic95_sup": sup,
                       "distinguivel_de_zero": bool(inf > 0 or sup < 0),
                       "p_perda_ajustada": float(sigmoide(Xu @ beta).mean())})
    return pd.DataFrame(linhas).sort_values("log_odds", ascending=False).reset_index(drop=True)


def tabela_calibracao(y, previsto) -> pd.DataFrame:
    decil = pd.qcut(previsto, 10, labels=False, duplicates="drop") + 1
    t = (pd.DataFrame({"decil": decil, "previsto": previsto, "observado": y})
         .groupby("decil").agg(n=("observado", "size"), previsto=("previsto", "mean"), observado=("observado", "mean"))
         .reset_index())
    t["desvio_pp"] = 100 * (t["observado"] - t["previsto"])
    return t


def tabelas_severidade(df: pd.DataFrame):
    perdas = df[df["perda"] == 1].assign(
        severidade=lambda t: t["condenacao"] / t["valor_causa"],
        sub_assunto=lambda t: np.where(t["golpe"] == 1, "golpe", "generico"),
    )

    def resumir(chaves):
        t = perdas.groupby(chaves)["severidade"].agg(n_perdas="size", severidade="mean", desvio="std").reset_index()
        margem = Z95 * t["desvio"] / np.sqrt(t["n_perdas"])
        return t.assign(ic95_inf=t["severidade"] - margem, ic95_sup=t["severidade"] + margem).drop(columns="desvio")

    return resumir(["uf", "sub_assunto"]), resumir(["uf"]), perdas.groupby("sub_assunto")["severidade"].mean()


def main():
    parser = argparse.ArgumentParser(description="Treina o modelo de risco processual.")
    parser.add_argument("--dados", type=Path, default=DADOS_PADRAO, help="planilha Hackaton_Enter_Base_Candidatos.xlsx")
    parser.add_argument("--saida", type=Path, default=PASTA / "resultados", help="pasta dos resultados")
    args = parser.parse_args()
    args.saida.mkdir(parents=True, exist_ok=True)

    df, info = carregar(args.dados)
    ufs = sorted(df["uf"].unique())
    X, nomes = matriz(df, ufs)
    y = df["perda"].to_numpy(float)

    previsto_cv, particoes = validar(X, y)
    beta, cov = ajustar(X, y)

    coeficientes = tabela_coeficientes(X, nomes, beta, cov)
    efeitos_uf = tabela_uf(X, nomes, beta, cov, ufs)
    calibracao = tabela_calibracao(y, previsto_cv)
    sev_uf_sub, sev_uf, sev_media = tabelas_severidade(df)

    cv = pd.DataFrame(particoes)
    resumo_cv = {m: {"media": float(cv[m].mean()), "desvio_padrao": float(cv[m].std(ddof=1))}
                 for m in ["log_loss", "auc", "brier", "log_loss_taxa_base"]}
    agora = datetime.now().isoformat(timespec="seconds")

    metricas_json = {
        "treinado_em": agora,
        "arquivo_dados": args.dados.name,
        **info,
        "n_modelo": int(len(df)),
        "n_perdas": int(y.sum()),
        "taxa_perda": float(y.mean()),
        "n_parametros": int(X.shape[1]),
        "validacao": {"tipo": "k-fold estratificado", "particoes": N_PARTICOES, "semente": SEMENTE},
        "cv_resumo": resumo_cv,
        "cv_fora_da_amostra_agregado": metricas(y, previsto_cv),
        "cv_por_particao": particoes,
        "calibracao_maior_desvio_decil_pp": float(calibracao["desvio_pp"].abs().max()),
    }
    modelo_json = {
        "descricao": "P(perda) = sigmoide(intercepto + soma dos subsídios juntados + golpe + efeito_uf); "
                     "exposição = P(perda) × valor da causa × severidade[uf|sub_assunto]",
        "treinado_em": agora,
        "n_processos": int(len(df)),
        "coeficientes": {n: float(b) for n, b in zip(nomes, beta) if not n.startswith("uf_")},
        "efeito_uf": {r.uf: float(r.log_odds) for r in efeitos_uf.sort_values("uf").itertuples()},
        "ufs_sem_dados": sorted(set(TODAS_UFS) - set(ufs)),
        "severidade": {f"{r.uf}|{r.sub_assunto}": float(r.severidade) for r in sev_uf_sub.itertuples()},
        "severidade_media": {k: float(v) for k, v in sev_media.items()},
    }

    (args.saida / "modelo.json").write_text(json.dumps(modelo_json, ensure_ascii=False, indent=2), encoding="utf-8")
    (args.saida / "metricas.json").write_text(json.dumps(metricas_json, ensure_ascii=False, indent=2), encoding="utf-8")
    csv = dict(index=False, float_format="%.6f")
    coeficientes.to_csv(args.saida / "coeficientes.csv", **csv)
    efeitos_uf.to_csv(args.saida / "efeitos_uf.csv", **csv)
    calibracao.to_csv(args.saida / "calibracao.csv", **csv)
    sev_uf_sub.to_csv(args.saida / "severidade_uf_subassunto.csv", **csv)
    sev_uf.sort_values("severidade", ascending=False).to_csv(args.saida / "severidade_uf.csv", **csv)
    (df[["processo", "uf", "golpe", *VARS_SUBSIDIO, "perda"]]
     .assign(p_perda_validacao=previsto_cv)
     .to_csv(args.saida / "previsoes_validacao.csv", **csv))

    print(f"processos: {len(df)} (acordos excluídos: {info['n_acordos_excluidos']}) · perdas: {int(y.sum())} ({y.mean():.1%})")
    print(f"validação cruzada ({N_PARTICOES} partes): "
          f"log-loss {resumo_cv['log_loss']['media']:.5f} ± {resumo_cv['log_loss']['desvio_padrao']:.5f} · "
          f"AUC {resumo_cv['auc']['media']:.4f} ± {resumo_cv['auc']['desvio_padrao']:.4f} · "
          f"Brier {resumo_cv['brier']['media']:.5f} · taxa-base {resumo_cv['log_loss_taxa_base']['media']:.5f}")
    print(f"maior desvio de calibração por decil: {metricas_json['calibracao_maior_desvio_decil_pp']:.2f} p.p.")
    print("\ncoeficientes:")
    print(coeficientes.to_string(index=False, float_format=lambda v: f"{v:.4f}"))
    print(f"\nUFs com efeito distinguível de zero: {int(efeitos_uf['distinguivel_de_zero'].sum())} de {len(ufs)}")
    print(efeitos_uf.iloc[[0, 1, 2, -3, -2, -1]].to_string(index=False, float_format=lambda v: f"{v:.4f}"))
    print(f"\nseveridade média: {sev_media.round(4).to_dict()} · por UF de {sev_uf['severidade'].min():.1%} a {sev_uf['severidade'].max():.1%}")
    print(f"UFs sem dados: {modelo_json['ufs_sem_dados']}")
    print(f"\nresultados salvos em {args.saida}")


if __name__ == "__main__":
    main()
