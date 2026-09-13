"""Valor de referência para oferta de acordo, a partir dos acordos homologados na base.

    from valor_oferta import prever_valor_oferta
    prever_valor_oferta(uf="SP", golpe=False, subsidios={"contrato", "extrato"}, valor_causa=15000)

O modelo escolhido em analise.py é o percentual médio da causa: nenhuma variável (subsídios,
sub-assunto, UF, P(perda)) mudou o percentual acordado de forma distinguível do acaso.
A faixa vem da distribuição preditiva por bootstrap, com cobertura conferida por validação cruzada.

O valor é onde acordos aceitos costumam fechar, não a oferta ótima. A comparação com a condenação
esperada (../taxa_de_risco) mostra quando esse valor passa do custo esperado da sentença.
Rode `python analise.py` antes, para gerar resultados/modelo.json.
"""
from __future__ import annotations

import importlib.util
import json
from functools import lru_cache
from pathlib import Path

PASTA = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("taxa_de_risco", PASTA.parent / "taxa_de_risco" / "taxa_de_risco.py")
taxa_de_risco = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(taxa_de_risco)

SUBSIDIOS = taxa_de_risco.SUBSIDIOS


@lru_cache(maxsize=None)
def carregar(caminho: str = str(PASTA / "resultados" / "modelo.json")) -> dict:
    return json.loads(Path(caminho).read_text(encoding="utf-8"))


def prever_valor_oferta(uf: str, golpe: bool, subsidios, valor_causa: float) -> dict:
    """Valor típico de acordo, faixas de 80% e 95% e comparação com a condenação esperada, em reais.

    acordo_tipico_sobre_condenacao_esperada > 1 indica que o acordo típico custa mais que a sentença esperada.
    """
    m = carregar()
    risco = taxa_de_risco.prever_taxa_de_risco(uf=uf, golpe=golpe, subsidios=subsidios, valor_causa=valor_causa)
    q = m["quantis_preditivos_percentual"]
    tipico = m["percentual_medio"] * valor_causa
    condenacao = risco["exposicao_esperada"]
    return {
        "valor_acordo_tipico": tipico,
        "faixa_80": (q["p10"] * valor_causa, q["p90"] * valor_causa),
        "faixa_95": (q["p2_5"] * valor_causa, q["p97_5"] * valor_causa),
        "percentual_da_causa": m["percentual_medio"],
        "p_perda": risco["p_perda"],
        "condenacao_esperada": condenacao,
        "acordo_tipico_sobre_condenacao_esperada": tipico / condenacao if condenacao > 0 else None,
    }


if __name__ == "__main__":
    exemplos = [("baixo risco", dict(uf="SP", golpe=False, subsidios={"contrato", "extrato"}, valor_causa=15000)),
                ("alto risco", dict(uf="AM", golpe=True, subsidios={"comprovante", "demonstrativo", "laudo"}, valor_causa=25000))]
    for nome, entrada in exemplos:
        print(f"--- {nome}: {entrada}")
        for chave, valor in prever_valor_oferta(**entrada).items():
            print(f"{chave:40s} {valor}")
