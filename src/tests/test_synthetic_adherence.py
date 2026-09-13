from __future__ import annotations

import unittest

from src.synthetic_adherence import summarize


def decision(
    *,
    lawyer_id: str,
    lawyer_name: str,
    office_id: str,
    office_name: str,
    adherent: bool,
    action: str = "defesa",
    confidence: float = 0.7,
    completeness: str = "Media",
    minutes: int = 20,
    follow_probability: float = 0.5,
    negotiation_result: str | None = None,
    override_reason: str = "avaliacao_juridica_individual",
) -> dict[str, object]:
    return {
        "advogado_id": lawyer_id,
        "advogado_nome": lawyer_name,
        "escritorio_id": office_id,
        "escritorio_nome": office_name,
        "aderente": int(adherent),
        "override": int(not adherent),
        "acao_tomada": action,
        "resultado_negociacao": negotiation_result,
        "razao_override": "" if adherent else override_reason,
        "score_confianca": confidence,
        "faixa_completude": completeness,
        "tempo_decisao_min": minutes,
        "probabilidade_seguir": follow_probability,
    }


class SummarizeCompleteTotalsTest(unittest.TestCase):
    def test_aggregates_all_metrics_by_lawyer_and_office(self) -> None:
        records = [
            decision(
                lawyer_id="ADV001",
                lawyer_name="Ana",
                office_id="ESC01",
                office_name="Almeida Rocha",
                adherent=True,
                action="acordo",
                confidence=0.9,
                completeness="Alta",
                minutes=10,
                follow_probability=0.8,
                negotiation_result="aceito",
            ),
            decision(
                lawyer_id="ADV001",
                lawyer_name="Ana",
                office_id="ESC01",
                office_name="Almeida Rocha",
                adherent=False,
                confidence=0.84,
                minutes=20,
                follow_probability=0.6,
            ),
            decision(
                lawyer_id="ADV001",
                lawyer_name="Ana",
                office_id="ESC01",
                office_name="Almeida Rocha",
                adherent=True,
                confidence=0.85,
                completeness="Alta",
                minutes=30,
                follow_probability=0.7,
            ),
            decision(
                lawyer_id="ADV002",
                lawyer_name="Bruno",
                office_id="ESC01",
                office_name="Almeida Rocha",
                adherent=False,
                action="acordo",
                confidence=0.5,
                completeness="Baixa",
                minutes=40,
                follow_probability=0.4,
                negotiation_result="rejeitado",
            ),
            decision(
                lawyer_id="ADV003",
                lawyer_name="Carla",
                office_id="ESC02",
                office_name="Costa Ribeiro",
                adherent=True,
                confidence=0.95,
                completeness="Alta",
                minutes=50,
                follow_probability=0.9,
            ),
        ]

        summary = summarize(records)

        lawyers = summary["totais_por_advogado"]
        self.assertEqual([item["advogado_id"] for item in lawyers], ["ADV001", "ADV002", "ADV003"])
        self.assertEqual(
            lawyers[0],
            {
                "advogado_id": "ADV001",
                "advogado_nome": "Ana",
                "escritorio_id": "ESC01",
                "escritorio_nome": "Almeida Rocha",
                "total_decisoes": 3,
                "total_aderentes": 2,
                "total_divergencias": 1,
                "taxa_aderencia": 0.6667,
                "total_acordos": 1,
                "taxa_acordo": 0.3333,
                "total_alta_confianca": 2,
                "taxa_alta_confianca": 0.6667,
                "total_documentacao_completa": 2,
                "taxa_documentacao_completa": 0.6667,
                "tempo_decisao_medio_min": 20.0,
                "probabilidade_media_seguir": 0.7,
            },
        )

        offices = summary["totais_por_escritorio"]
        self.assertEqual([item["escritorio_id"] for item in offices], ["ESC01", "ESC02"])
        self.assertEqual(offices[0]["total_advogados"], 2)
        self.assertEqual(offices[0]["total_decisoes"], 4)
        self.assertEqual(offices[0]["total_aderentes"], 2)
        self.assertEqual(offices[0]["total_divergencias"], 2)
        self.assertEqual(offices[0]["total_acordos"], 2)
        self.assertEqual(offices[0]["taxa_aderencia"], 0.5)
        self.assertEqual(offices[0]["taxa_acordo"], 0.5)
        self.assertEqual(offices[0]["taxa_alta_confianca"], 0.5)
        self.assertEqual(offices[0]["taxa_documentacao_completa"], 0.5)
        self.assertEqual(offices[0]["tempo_decisao_medio_min"], 25.0)
        self.assertEqual(offices[0]["probabilidade_media_seguir"], 0.625)

        self.assertEqual(
            sum(item["total_decisoes"] for item in lawyers),
            summary["total_processos"],
        )
        self.assertEqual(
            sum(item["total_divergencias"] for item in offices),
            sum(summary["razoes_override"].values()),
        )

    def test_complete_totals_are_not_truncated_like_existing_rankings(self) -> None:
        records = [
            decision(
                lawyer_id=f"ADV{index:03d}",
                lawyer_name=f"Advogado {index}",
                office_id="ESC01" if index <= 4 else "ESC02",
                office_name="Escritorio 1" if index <= 4 else "Escritorio 2",
                adherent=index % 2 == 0,
            )
            for index in range(1, 8)
        ]

        summary = summarize(records)

        self.assertEqual(len(summary["totais_por_advogado"]), 7)
        self.assertEqual(len(summary["totais_por_escritorio"]), 2)
        self.assertEqual(len(summary["piores_advogados"]), 5)
        self.assertEqual(len(summary["melhores_advogados"]), 5)
        self.assertEqual(
            [item["advogado_id"] for item in summary["totais_por_advogado"]],
            [f"ADV{index:03d}" for index in range(1, 8)],
        )

    def test_empty_dataset_keeps_existing_fields_and_empty_complete_totals(self) -> None:
        summary = summarize([])

        self.assertEqual(summary["total_processos"], 0)
        self.assertEqual(summary["taxa_aderencia_global"], 0.0)
        self.assertEqual(summary["piores_advogados"], [])
        self.assertEqual(summary["melhores_advogados"], [])
        self.assertEqual(summary["totais_por_advogado"], [])
        self.assertEqual(summary["totais_por_escritorio"], [])


if __name__ == "__main__":
    unittest.main()
