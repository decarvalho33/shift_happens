"""Prevê o valor da condenação de um processo.

    from motor import prever_condenacao
    prever_condenacao(uf="SP", golpe=False, subsidios={"contrato", "extrato"}, valor_causa=15000)

Usa a taxa de risco de ../taxa_de_risco/taxa_de_risco.py no modelo de duas partes, que venceu a comparação de analise.py:
    condenação esperada = P(perda) × valor da causa × severidade[UF, sub-assunto]
Rode `python ../taxa_de_risco/treinar.py` antes, para gerar ../taxa_de_risco/resultados/modelo.json.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "taxa_de_risco", Path(__file__).resolve().parents[1] / "taxa_de_risco" / "taxa_de_risco.py")
taxa_de_risco = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(taxa_de_risco)

SUBSIDIOS = taxa_de_risco.SUBSIDIOS


def prever_condenacao(uf: str, golpe: bool, subsidios, valor_causa: float) -> dict:
    """Condenação esperada de um processo, em reais.

    condenacao_esperada: valor médio de condenação pesando a chance de perder (zero quando o banco ganha).
    condenacao_se_perder: valor esperado caso a sentença seja de procedência ou parcial procedência.
    """
    r = taxa_de_risco.prever_taxa_de_risco(uf=uf, golpe=golpe, subsidios=subsidios, valor_causa=valor_causa)
    return {
        "condenacao_esperada": r["exposicao_esperada"],
        "p_perda": r["p_perda"],
        "condenacao_se_perder": r["condenacao_se_perder"],
        "severidade": r["severidade"],
        "uf_com_dados": r["uf_com_dados"],
    }


if __name__ == "__main__":
    exemplo = prever_condenacao(uf="SP", golpe=False, subsidios={"contrato", "extrato"}, valor_causa=15000)
    for chave, valor in exemplo.items():
        print(f"{chave:22s} {valor}")
