"""Calcula a taxa de risco de um processo: a probabilidade de o banco perder e o score de defesa.

    from taxa_de_risco import prever_taxa_de_risco
    prever_taxa_de_risco(uf="SP", golpe=False, subsidios={"contrato", "extrato"}, valor_causa=15000)

Rode `python treinar.py` antes, para gerar resultados/modelo.json.
"""
from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path

MODELO = Path(__file__).resolve().parent / "resultados" / "modelo.json"
SUBSIDIOS = ("contrato", "extrato", "comprovante", "dossie", "demonstrativo", "laudo")


@lru_cache(maxsize=None)
def carregar(caminho: str = str(MODELO)) -> dict:
    return json.loads(Path(caminho).read_text(encoding="utf-8"))


def score_defesa(p_perda: float) -> int:
    """Converte a probabilidade de perda num score de 0 a 100: 0 = fechar acordo, 100 = pode defender.

    score = 100 × (1 − P(perda)), arredondado. É a chance de o banco ganhar, em pontos.
    """
    if not 0.0 <= p_perda <= 1.0:
        raise ValueError(f"p_perda deve estar entre 0 e 1, recebido {p_perda}")
    return int(math.floor(100 * (1 - p_perda) + 0.5))


def prever_taxa_de_risco(uf: str, golpe: bool, subsidios, valor_causa: float, modelo: dict | None = None) -> dict:
    """Probabilidade de perda e exposição esperada de um processo.

    uf: sigla, ex. "SP". UF sem processos na base de treino usa efeito zero (o da UF média).
    golpe: True se o sub-assunto é golpe, False se genérico.
    subsidios: nomes dos subsídios juntados, entre SUBSIDIOS.
    valor_causa: em reais.
    """
    m = modelo or carregar()
    subsidios = set(subsidios)
    invalidos = subsidios - set(SUBSIDIOS)
    if invalidos:
        raise ValueError(f"subsídio desconhecido: {sorted(invalidos)}. Use: {', '.join(SUBSIDIOS)}")
    if valor_causa < 0:
        raise ValueError("valor_causa não pode ser negativo")
    uf = uf.strip().upper()
    if uf not in m["efeito_uf"] and uf not in m["ufs_sem_dados"]:
        raise ValueError(f"UF inválida: {uf}")

    coef = m["coeficientes"]
    log_odds = (coef["intercepto"] + coef["golpe"] * bool(golpe)
                + sum(coef[s] for s in subsidios) + m["efeito_uf"].get(uf, 0.0))
    p_perda = 1.0 / (1.0 + math.exp(-log_odds))

    sub_assunto = "golpe" if golpe else "generico"
    severidade = m["severidade"].get(f"{uf}|{sub_assunto}", m["severidade_media"][sub_assunto])
    condenacao = valor_causa * severidade
    return {
        "p_perda": p_perda,
        "score_defesa": score_defesa(p_perda),
        "log_odds": log_odds,
        "severidade": severidade,
        "condenacao_se_perder": condenacao,
        "exposicao_esperada": p_perda * condenacao,
        "uf_com_dados": uf in m["efeito_uf"],
    }


if __name__ == "__main__":
    exemplo = prever_taxa_de_risco(uf="SP", golpe=False, subsidios={"contrato", "extrato"}, valor_causa=15000)
    for chave, valor in exemplo.items():
        print(f"{chave:22s} {valor}")
