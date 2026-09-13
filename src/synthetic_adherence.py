from __future__ import annotations

import argparse
import csv
import json
import math
import random
import zipfile
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterable
import xml.etree.ElementTree as ET


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_XLSX = ROOT_DIR / "data" / "Hackaton_Enter_Base_Candidatos.xlsx"
DEFAULT_OUTPUT_CSV = ROOT_DIR / "data" / "synthetic_adherence.csv"
DEFAULT_OUTPUT_JSON = ROOT_DIR / "data" / "synthetic_adherence_summary.json"

XML_NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

SUBSIDY_FIELDS = (
    "contrato",
    "extrato",
    "comprovante_credito",
    "dossie",
    "demonstrativo_divida",
    "laudo_referenciado",
)

CRITICAL_SUBSIDIES = (
    "contrato",
    "extrato",
    "comprovante_credito",
)


@dataclass(frozen=True)
class CaseRecord:
    process_id: str
    uf: str
    assunto: str
    sub_assunto: str
    resultado_macro: str
    resultado_micro: str
    valor_causa: float
    valor_condenacao: float
    subsidies: dict[str, int]

    @property
    def qtd_subsidios(self) -> int:
        return sum(self.subsidies.values())

    @property
    def qtd_subsidios_criticos(self) -> int:
        return sum(self.subsidies[name] for name in CRITICAL_SUBSIDIES)


@dataclass(frozen=True)
class OfficeProfile:
    office_id: str
    office_name: str
    cluster: str
    adherence_base: float
    negotiation_style: str


@dataclass(frozen=True)
class LawyerProfile:
    lawyer_id: str
    lawyer_name: str
    office_id: str
    office_name: str
    persona: str
    persona_description: str
    adherence_base: float
    risk_tolerance: float
    confidence_trust: float
    high_value_aversion: float
    settlement_appetite: float
    documentation_respect: float


def _shared_strings(xlsx_path: Path) -> list[str]:
    with zipfile.ZipFile(xlsx_path) as workbook:
        if "xl/sharedStrings.xml" not in workbook.namelist():
            return []

        shared: list[str] = []
        for _event, elem in ET.iterparse(
            workbook.open("xl/sharedStrings.xml"),
            events=("end",),
        ):
            if elem.tag.endswith("si"):
                text = "".join(
                    node.text or ""
                    for node in elem.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")
                )
                shared.append(text)
                elem.clear()
        return shared


def _iter_sheet_rows(
    xlsx_path: Path,
    sheet_filename: str,
    shared_strings: list[str],
) -> Iterable[list[str | None]]:
    with zipfile.ZipFile(xlsx_path) as workbook:
        root = ET.fromstring(workbook.read(sheet_filename))
        sheet_data = root.find("a:sheetData", XML_NS)
        if sheet_data is None:
            return

        for row in sheet_data.findall("a:row", XML_NS):
            current_row: list[str | None] = []
            for cell in row.findall("a:c", XML_NS):
                cell_type = cell.attrib.get("t")
                value_node = cell.find("a:v", XML_NS)
                if cell_type == "inlineStr":
                    inline_node = cell.find("a:is", XML_NS)
                    if inline_node is None:
                        current_row.append(None)
                    else:
                        text = "".join(
                            node.text or ""
                            for node in inline_node.iter(
                                "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t"
                            )
                        )
                        current_row.append(text)
                    continue

                if value_node is None:
                    current_row.append(None)
                    continue

                raw_value = value_node.text
                if cell_type == "s":
                    current_row.append(shared_strings[int(raw_value)])
                else:
                    current_row.append(raw_value)
            yield current_row


def _clean_text(value: str | None) -> str:
    return " ".join((value or "").strip().split())


def _parse_float(value: str | None) -> float:
    if value in (None, ""):
        return 0.0
    return float(str(value).replace(",", "."))


def load_cases(xlsx_path: Path) -> list[CaseRecord]:
    shared_strings = _shared_strings(xlsx_path)

    result_rows = list(
        _iter_sheet_rows(xlsx_path, "xl/worksheets/sheet1.xml", shared_strings)
    )
    subsidy_rows = list(
        _iter_sheet_rows(xlsx_path, "xl/worksheets/sheet2.xml", shared_strings)
    )

    subsidy_by_process: dict[str, dict[str, int]] = {}
    for row in subsidy_rows[2:]:
        if not row:
            continue
        process_id = _clean_text(row[0])
        if not process_id:
            continue
        subsidy_by_process[process_id] = {
            "contrato": int(_parse_float(row[1])),
            "extrato": int(_parse_float(row[2])),
            "comprovante_credito": int(_parse_float(row[3])),
            "dossie": int(_parse_float(row[4])),
            "demonstrativo_divida": int(_parse_float(row[5])),
            "laudo_referenciado": int(_parse_float(row[6])),
        }

    cases: list[CaseRecord] = []
    for row in result_rows[1:]:
        if not row:
            continue
        process_id = _clean_text(row[0])
        if not process_id:
            continue
        subsidies = subsidy_by_process.get(
            process_id,
            {name: 0 for name in SUBSIDY_FIELDS},
        )
        cases.append(
            CaseRecord(
                process_id=process_id,
                uf=_clean_text(row[1]).upper(),
                assunto=_clean_text(row[2]),
                sub_assunto=_clean_text(row[3]),
                resultado_macro=_clean_text(row[4]),
                resultado_micro=_clean_text(row[5]),
                valor_causa=_parse_float(row[6]),
                valor_condenacao=_parse_float(row[7]),
                subsidies=subsidies,
            )
        )
    return cases


def faixa_valor(valor_causa: float) -> str:
    if valor_causa < 8000:
        return "Baixo"
    if valor_causa < 15000:
        return "Medio"
    return "Alto"


def faixa_completude(qtd_subsidios: int) -> str:
    if qtd_subsidios <= 2:
        return "Baixa"
    if qtd_subsidios <= 4:
        return "Media"
    return "Alta"


def confidence_band(score: float) -> str:
    if score >= 0.85:
        return "Alta"
    if score >= 0.65:
        return "Media"
    return "Baixa"


def recommendation_for_case(case: CaseRecord) -> tuple[str, float | None, float, list[str]]:
    reasons: list[str] = []
    score = 0.52

    if case.qtd_subsidios_criticos <= 1:
        score -= 0.24
        reasons.append("Poucos subsidios criticos disponiveis.")
    elif case.qtd_subsidios_criticos == 2:
        score -= 0.08
        reasons.append("Completude critica intermediaria.")
    else:
        score += 0.14
        reasons.append("Documentacao critica robusta.")

    if case.subsidies["dossie"] == 1:
        score += 0.08
        reasons.append("Dossie presente reforca a defesa.")
    else:
        score -= 0.06
        reasons.append("Ausencia de dossie aumenta incerteza.")

    if case.subsidies["laudo_referenciado"] == 1:
        score += 0.05
        reasons.append("Laudo referenciado ajuda a sustentar a contratacao.")

    if case.uf in {"AM", "AP", "PA"}:
        score -= 0.05
        reasons.append("UF historicamente mais sensivel para o banco.")

    if case.sub_assunto.lower() == "golpe":
        score -= 0.04
        reasons.append("Sub-assunto 'Golpe' sugere maior risco de condenacao.")

    score = max(0.05, min(0.95, score))

    if score < 0.50:
        action = "acordo"
        pct = 0.28 + (0.06 if case.sub_assunto.lower() == "golpe" else 0.0)
        pct += 0.04 if faixa_valor(case.valor_causa) == "Alto" else 0.0
        pct -= 0.03 if case.qtd_subsidios >= 5 else 0.0
        pct = max(0.20, min(0.45, pct))
        value = round(case.valor_causa * pct, 2)
        reasons.append("Custo esperado de defesa supera a proposta sugerida.")
    else:
        action = "defesa"
        value = None
        reasons.append("Conjunto probatorio sugere manter defesa.")

    confidence = max(score, 1.0 - score)
    return action, value, round(confidence, 4), reasons


def build_offices() -> list[OfficeProfile]:
    return [
        OfficeProfile("ESC01", "Almeida Rocha", "alto", 0.93, "disciplinado"),
        OfficeProfile("ESC02", "Costa Ribeiro", "alto", 0.90, "disciplinado"),
        OfficeProfile("ESC03", "Prado Tavares", "medio", 0.82, "equilibrado"),
        OfficeProfile("ESC04", "Silva Moura", "medio", 0.79, "equilibrado"),
        OfficeProfile("ESC05", "Nogueira Bastos", "baixo", 0.67, "autonomo"),
        OfficeProfile("ESC06", "Duarte Fontes", "baixo", 0.62, "agressivo"),
    ]


def build_lawyers(rng: random.Random) -> list[LawyerProfile]:
    offices = build_offices()
    templates = [
        {
            "name": "Marina Azevedo",
            "persona": "guardiao_da_politica",
            "description": "Segue a politica de forma disciplinada e diverge pouco.",
            "delta_base": 0.03,
            "confidence_trust": 0.18,
            "high_value_aversion": 0.10,
            "settlement_appetite": -0.08,
            "documentation_respect": 0.22,
        },
        {
            "name": "Carlos Nunes",
            "persona": "conservador_caso_caro",
            "description": "Fica mais defensivo em casos de alto valor e evita acordo caro.",
            "delta_base": -0.02,
            "confidence_trust": 0.05,
            "high_value_aversion": 0.28,
            "settlement_appetite": -0.14,
            "documentation_respect": 0.18,
        },
        {
            "name": "Bianca Prado",
            "persona": "pragmatica_negociadora",
            "description": "Tem viés negociador e aceita acordo com mais facilidade.",
            "delta_base": 0.01,
            "confidence_trust": 0.20,
            "high_value_aversion": 0.02,
            "settlement_appetite": 0.12,
            "documentation_respect": 0.12,
        },
        {
            "name": "Rafael Moura",
            "persona": "cauteloso_com_baixa_confianca",
            "description": "Confia no modelo quando a confiança e alta, mas revisa casos cinzentos.",
            "delta_base": -0.01,
            "confidence_trust": 0.30,
            "high_value_aversion": 0.08,
            "settlement_appetite": -0.05,
            "documentation_respect": 0.16,
        },
        {
            "name": "Fernanda Lima",
            "persona": "independente",
            "description": "Tem alta autonomia e diverge mais da recomendacao automatica.",
            "delta_base": -0.08,
            "confidence_trust": 0.04,
            "high_value_aversion": 0.12,
            "settlement_appetite": -0.02,
            "documentation_respect": 0.05,
        },
        {
            "name": "Thiago Barros",
            "persona": "formalista_documental",
            "description": "Da muito peso a robustez documental antes de fechar acordo.",
            "delta_base": 0.00,
            "confidence_trust": 0.10,
            "high_value_aversion": 0.06,
            "settlement_appetite": -0.06,
            "documentation_respect": 0.30,
        },
        {
            "name": "Juliana Teixeira",
            "persona": "sensivel_ao_cliente",
            "description": "Aceita elevar valor quando percebe maior vulnerabilidade do autor.",
            "delta_base": -0.01,
            "confidence_trust": 0.12,
            "high_value_aversion": 0.04,
            "settlement_appetite": 0.18,
            "documentation_respect": 0.08,
        },
        {
            "name": "Gustavo Ribeiro",
            "persona": "orientado_a_meta",
            "description": "Busca throughput e tende a seguir o fluxo padrao da politica.",
            "delta_base": 0.04,
            "confidence_trust": 0.14,
            "high_value_aversion": 0.05,
            "settlement_appetite": 0.02,
            "documentation_respect": 0.14,
        },
        {
            "name": "Patricia Coelho",
            "persona": "litigante_estrategica",
            "description": "Prefere defender quando enxerga chance razoavel de exito judicial.",
            "delta_base": -0.03,
            "confidence_trust": 0.16,
            "high_value_aversion": 0.09,
            "settlement_appetite": -0.16,
            "documentation_respect": 0.18,
        },
        {
            "name": "Leonardo Siqueira",
            "persona": "seguidor_de_confianca",
            "description": "Acompanha a politica quando o score e alto e pede revisao quando e baixo.",
            "delta_base": 0.02,
            "confidence_trust": 0.34,
            "high_value_aversion": 0.07,
            "settlement_appetite": 0.00,
            "documentation_respect": 0.12,
        },
        {
            "name": "Camila Duarte",
            "persona": "avesso_a_ruido",
            "description": "Diverge em casos pouco documentados ou com sinais contraditorios.",
            "delta_base": -0.04,
            "confidence_trust": 0.09,
            "high_value_aversion": 0.11,
            "settlement_appetite": -0.04,
            "documentation_respect": 0.24,
        },
        {
            "name": "Eduardo Bastos",
            "persona": "fechador_de_acordo",
            "description": "Tem apetite alto por acordo e busca encerrar casos cedo.",
            "delta_base": -0.02,
            "confidence_trust": 0.13,
            "high_value_aversion": 0.03,
            "settlement_appetite": 0.26,
            "documentation_respect": 0.04,
        },
    ]

    lawyers: list[LawyerProfile] = []
    counter = 1
    for office in offices:
        for _ in range(6):
            template = rng.choice(templates)
            risk_tolerance = max(0.05, min(0.95, 0.50 + template["settlement_appetite"]))
            adherence = max(
                0.40,
                min(0.97, office.adherence_base + template["delta_base"] + rng.uniform(-0.03, 0.03)),
            )
            lawyers.append(
                LawyerProfile(
                    lawyer_id=f"ADV{counter:03d}",
                    lawyer_name=f"{template['name']} {counter}",
                    office_id=office.office_id,
                    office_name=office.office_name,
                    persona=template["persona"],
                    persona_description=template["description"],
                    adherence_base=round(adherence, 4),
                    risk_tolerance=round(risk_tolerance, 4),
                    confidence_trust=round(template["confidence_trust"], 4),
                    high_value_aversion=round(template["high_value_aversion"], 4),
                    settlement_appetite=round(template["settlement_appetite"], 4),
                    documentation_respect=round(template["documentation_respect"], 4),
                )
            )
            counter += 1
    return lawyers


def choose_lawyer(case: CaseRecord, lawyers: list[LawyerProfile], rng: random.Random) -> LawyerProfile:
    bucket = sum(ord(char) for char in case.uf) + case.qtd_subsidios + len(case.sub_assunto)
    eligible = [lawyer for lawyer in lawyers if (int(lawyer.lawyer_id[-3:]) + bucket) % 3 != 0]
    if not eligible:
        eligible = lawyers
    return eligible[rng.randrange(len(eligible))]


def _sigmoid(value: float) -> float:
    return 1.0 / (1.0 + math.exp(-value))


def _override_reason(adjustments: list[tuple[str, float]], rng: random.Random) -> str:
    negatives = sorted((item for item in adjustments if item[1] < 0), key=lambda item: item[1])
    if negatives:
        top_reason = negatives[0][0]
        mapping = {
            "alta_confianca_modelo": "confianca_insuficiente_para_divergir",
            "baixa_confianca_modelo": "baixa_confianca_modelo",
            "valor_causa_alto": "caso_caro_exigiu_postura_propria",
            "documentacao_muito_forte": "documentacao_robusta_para_defesa",
            "documentacao_fraca": "fragilidade_documental",
            "perfil_pro_acordo": "advogado_mais_negociador",
            "perfil_mais_autonomo": "estrategia_autonoma_do_advogado",
        }
        return mapping.get(top_reason, "avaliacao_juridica_individual")
    return rng.choice(
        [
            "avaliacao_juridica_individual",
            "estrategia_do_escritorio",
            "informacao_nova_na_analise",
        ]
    )


def simulate_lawyer_decision(
    case: CaseRecord,
    lawyer: LawyerProfile,
    recommended_action: str,
    recommended_value: float | None,
    confidence: float,
    rng: random.Random,
) -> dict[str, object]:
    adjustments: list[tuple[str, float]] = [("aderencia_base", lawyer.adherence_base - 0.5)]

    if confidence >= 0.85:
        adjustments.append(("alta_confianca_modelo", lawyer.confidence_trust))
    elif confidence < 0.65:
        adjustments.append(("baixa_confianca_modelo", -0.18 + (lawyer.confidence_trust / 3.0)))

    if faixa_valor(case.valor_causa) == "Alto":
        adjustments.append(("valor_causa_alto", -lawyer.high_value_aversion))
    elif faixa_valor(case.valor_causa) == "Baixo":
        adjustments.append(("valor_causa_baixo", 0.04))

    if case.qtd_subsidios >= 5:
        adjustments.append(("documentacao_muito_forte", lawyer.documentation_respect))
    elif case.qtd_subsidios <= 2:
        adjustments.append(("documentacao_fraca", max(0.04, lawyer.settlement_appetite)))

    if recommended_action == "acordo":
        adjustments.append(("perfil_pro_acordo", lawyer.settlement_appetite))
    else:
        adjustments.append(("perfil_pro_defesa", -lawyer.settlement_appetite / 2.0))

    if lawyer.persona == "independente":
        adjustments.append(("perfil_mais_autonomo", -0.12))
    elif lawyer.persona == "guardiao_da_politica":
        adjustments.append(("perfil_mais_disciplinado", 0.10))
    elif lawyer.persona == "fechador_de_acordo" and recommended_action == "acordo":
        adjustments.append(("perfil_fechador_de_acordo", 0.14))
    elif lawyer.persona == "litigante_estrategica" and recommended_action == "defesa":
        adjustments.append(("perfil_litigante", 0.10))
    elif lawyer.persona == "avesso_a_ruido" and confidence < 0.65:
        adjustments.append(("perfil_avesso_a_ruido", -0.10))
    elif lawyer.persona == "sensivel_ao_cliente" and recommended_action == "acordo":
        adjustments.append(("perfil_sensivel_ao_cliente", 0.08))

    score = sum(weight for _label, weight in adjustments)
    follow_probability = max(0.05, min(0.95, _sigmoid(score)))
    aderente = rng.random() < follow_probability

    action_taken = recommended_action if aderente else ("defesa" if recommended_action == "acordo" else "acordo")

    if action_taken == "acordo":
        base_value = recommended_value if recommended_value is not None else round(case.valor_causa * 0.32, 2)
        if aderente:
            noise = rng.uniform(0.97, 1.03)
        elif lawyer.persona in {"pragmatica_negociadora", "guardiao_da_politica"}:
            noise = rng.uniform(1.03, 1.20)
        else:
            noise = rng.uniform(0.80, 0.97)
        proposed_value = round(base_value * noise, 2)
        ratio = proposed_value / case.valor_causa if case.valor_causa else 0.0
        if ratio >= 0.40:
            negotiation_result = rng.choices(
                ["aceito", "contraproposta", "rejeitado"],
                weights=[0.78, 0.17, 0.05],
                k=1,
            )[0]
        elif ratio >= 0.25:
            negotiation_result = rng.choices(
                ["aceito", "contraproposta", "rejeitado"],
                weights=[0.58, 0.27, 0.15],
                k=1,
            )[0]
        else:
            negotiation_result = rng.choices(
                ["aceito", "contraproposta", "rejeitado"],
                weights=[0.28, 0.34, 0.38],
                k=1,
            )[0]
    else:
        proposed_value = None
        negotiation_result = None

    if aderente:
        override_reason = ""
        explanation = "Seguiu a recomendacao por alinhamento entre politica, perfil e sinais do caso."
    else:
        override_reason = _override_reason(adjustments, rng)
        explanation = (
            f"Divergiu da recomendacao por {override_reason}. "
            f"Os fatores de maior peso foram: "
            + ", ".join(f"{label}={weight:+.2f}" for label, weight in adjustments[:4])
        )

    minutes = max(
        5,
        int(
            18
            + case.qtd_subsidios * 7
            + (22 if faixa_valor(case.valor_causa) == "Alto" else 0)
            + (16 if confidence < 0.65 else 0)
            + rng.randint(-6, 28)
        ),
    )

    return {
        "action_taken": action_taken,
        "follow_probability": round(follow_probability, 4),
        "aderente": int(aderente),
        "override_reason": override_reason,
        "proposed_value": proposed_value,
        "negotiation_result": negotiation_result,
        "decision_minutes": minutes,
        "decision_explanation": explanation,
        "behavior_factors": "; ".join(f"{label}={weight:+.2f}" for label, weight in adjustments),
    }


def simulate_dataset(cases: list[CaseRecord], seed: int) -> list[dict[str, object]]:
    rng = random.Random(seed)
    lawyers = build_lawyers(rng)
    start_date = datetime(2025, 4, 1, 9, 0, 0)
    horizon_days = 365
    records: list[dict[str, object]] = []

    for case in cases:
        recommendation, suggested_value, confidence, recommendation_reasons = recommendation_for_case(case)
        lawyer = choose_lawyer(case, lawyers, rng)
        decision = simulate_lawyer_decision(
            case=case,
            lawyer=lawyer,
            recommended_action=recommendation,
            recommended_value=suggested_value,
            confidence=confidence,
            rng=rng,
        )

        distributed_at = start_date + timedelta(days=rng.randint(0, horizon_days), minutes=rng.randint(0, 240))
        decided_at = distributed_at + timedelta(minutes=int(decision["decision_minutes"]))

        record = {
            "processo_id": case.process_id,
            "uf": case.uf,
            "assunto": case.assunto,
            "sub_assunto": case.sub_assunto,
            "resultado_macro_historico": case.resultado_macro,
            "resultado_micro_historico": case.resultado_micro,
            "valor_causa": round(case.valor_causa, 2),
            "valor_condenacao_historica": round(case.valor_condenacao, 2),
            "qtd_subsidios": case.qtd_subsidios,
            "qtd_subsidios_criticos": case.qtd_subsidios_criticos,
            "faixa_valor": faixa_valor(case.valor_causa),
            "faixa_completude": faixa_completude(case.qtd_subsidios),
            "tem_contrato": case.subsidies["contrato"],
            "tem_extrato": case.subsidies["extrato"],
            "tem_comprovante_credito": case.subsidies["comprovante_credito"],
            "tem_dossie": case.subsidies["dossie"],
            "tem_demonstrativo_divida": case.subsidies["demonstrativo_divida"],
            "tem_laudo_referenciado": case.subsidies["laudo_referenciado"],
            "advogado_id": lawyer.lawyer_id,
            "advogado_nome": lawyer.lawyer_name,
            "escritorio_id": lawyer.office_id,
            "escritorio_nome": lawyer.office_name,
            "perfil_advogado": lawyer.persona,
            "descricao_perfil_advogado": lawyer.persona_description,
            "aderencia_base_advogado": lawyer.adherence_base,
            "acao_recomendada": recommendation,
            "valor_acordo_recomendado": suggested_value,
            "score_confianca": confidence,
            "faixa_confianca": confidence_band(confidence),
            "fundamentos_recomendacao": " | ".join(recommendation_reasons),
            "acao_tomada": decision["action_taken"],
            "valor_acordo_proposto": decision["proposed_value"],
            "aderente": decision["aderente"],
            "override": int(not decision["aderente"]),
            "razao_override": decision["override_reason"],
            "probabilidade_seguir": decision["follow_probability"],
            "fatores_comportamentais": decision["behavior_factors"],
            "explicacao_decisao_advogado": decision["decision_explanation"],
            "resultado_negociacao": decision["negotiation_result"],
            "data_distribuicao": distributed_at.isoformat(),
            "data_decisao": decided_at.isoformat(),
            "tempo_decisao_min": decision["decision_minutes"],
        }
        records.append(record)
    return records


def summarize(records: list[dict[str, object]]) -> dict[str, object]:
    total = len(records)
    agreements = [row for row in records if row["acao_tomada"] == "acordo"]
    overrides = [row for row in records if row["override"] == 1]
    accepted = [row for row in agreements if row["resultado_negociacao"] == "aceito"]

    by_lawyer: dict[str, dict[str, object]] = {}
    by_office: dict[str, dict[str, object]] = {}
    for row in records:
        lawyer_id = str(row["advogado_id"])
        office_id = str(row["escritorio_id"])
        adherent = int(row["aderente"])
        agreement = int(row["acao_tomada"] == "acordo")
        confidence = row.get("score_confianca")
        high_confidence = int(
            isinstance(confidence, (int, float)) and float(confidence) >= 0.85
        )
        complete_documentation = int(
            str(row.get("faixa_completude", "")).strip().lower() == "alta"
        )
        decision_minutes = row.get("tempo_decisao_min")
        follow_probability = row.get("probabilidade_seguir")

        lawyer_bucket = by_lawyer.setdefault(
            lawyer_id,
            {
                "advogado_nome": str(row["advogado_nome"]),
                "escritorio_id": office_id,
                "escritorio_nome": str(row["escritorio_nome"]),
                "total": 0,
                "aderentes": 0,
                "acordos": 0,
                "alta_confianca": 0,
                "documentacao_completa": 0,
                "tempo_decisao_total": 0.0,
                "tempo_decisao_quantidade": 0,
                "probabilidade_seguir_total": 0.0,
                "probabilidade_seguir_quantidade": 0,
            },
        )
        lawyer_bucket["total"] += 1
        lawyer_bucket["aderentes"] += adherent
        lawyer_bucket["acordos"] += agreement
        lawyer_bucket["alta_confianca"] += high_confidence
        lawyer_bucket["documentacao_completa"] += complete_documentation
        if isinstance(decision_minutes, (int, float)):
            lawyer_bucket["tempo_decisao_total"] += float(decision_minutes)
            lawyer_bucket["tempo_decisao_quantidade"] += 1
        if isinstance(follow_probability, (int, float)):
            lawyer_bucket["probabilidade_seguir_total"] += float(follow_probability)
            lawyer_bucket["probabilidade_seguir_quantidade"] += 1

        office_bucket = by_office.setdefault(
            office_id,
            {
                "escritorio_nome": str(row["escritorio_nome"]),
                "advogados": set(),
                "total": 0,
                "aderentes": 0,
                "acordos": 0,
                "alta_confianca": 0,
                "documentacao_completa": 0,
                "tempo_decisao_total": 0.0,
                "tempo_decisao_quantidade": 0,
                "probabilidade_seguir_total": 0.0,
                "probabilidade_seguir_quantidade": 0,
            },
        )
        office_bucket["advogados"].add(lawyer_id)
        office_bucket["total"] += 1
        office_bucket["aderentes"] += adherent
        office_bucket["acordos"] += agreement
        office_bucket["alta_confianca"] += high_confidence
        office_bucket["documentacao_completa"] += complete_documentation
        if isinstance(decision_minutes, (int, float)):
            office_bucket["tempo_decisao_total"] += float(decision_minutes)
            office_bucket["tempo_decisao_quantidade"] += 1
        if isinstance(follow_probability, (int, float)):
            office_bucket["probabilidade_seguir_total"] += float(follow_probability)
            office_bucket["probabilidade_seguir_quantidade"] += 1

    def aggregate_rates(bucket: dict[str, object]) -> dict[str, float | int]:
        bucket_total = int(bucket["total"])
        adherent_total = int(bucket["aderentes"])
        agreement_total = int(bucket["acordos"])
        high_confidence_total = int(bucket["alta_confianca"])
        complete_documentation_total = int(bucket["documentacao_completa"])
        decision_minutes_count = int(bucket["tempo_decisao_quantidade"])
        follow_probability_count = int(bucket["probabilidade_seguir_quantidade"])
        return {
            "total_decisoes": bucket_total,
            "total_aderentes": adherent_total,
            "total_divergencias": bucket_total - adherent_total,
            "taxa_aderencia": round(adherent_total / bucket_total, 4) if bucket_total else 0.0,
            "total_acordos": agreement_total,
            "taxa_acordo": round(agreement_total / bucket_total, 4) if bucket_total else 0.0,
            "total_alta_confianca": high_confidence_total,
            "taxa_alta_confianca": (
                round(high_confidence_total / bucket_total, 4) if bucket_total else 0.0
            ),
            "total_documentacao_completa": complete_documentation_total,
            "taxa_documentacao_completa": (
                round(complete_documentation_total / bucket_total, 4) if bucket_total else 0.0
            ),
            "tempo_decisao_medio_min": (
                round(float(bucket["tempo_decisao_total"]) / decision_minutes_count, 2)
                if decision_minutes_count
                else 0.0
            ),
            "probabilidade_media_seguir": (
                round(float(bucket["probabilidade_seguir_total"]) / follow_probability_count, 4)
                if follow_probability_count
                else 0.0
            ),
        }

    lawyer_totals = [
        {
            "advogado_id": lawyer_id,
            "advogado_nome": str(bucket["advogado_nome"]),
            "escritorio_id": str(bucket["escritorio_id"]),
            "escritorio_nome": str(bucket["escritorio_nome"]),
            **aggregate_rates(bucket),
        }
        for lawyer_id, bucket in sorted(by_lawyer.items())
    ]

    office_totals = [
        {
            "escritorio_id": office_id,
            "escritorio_nome": str(bucket["escritorio_nome"]),
            "total_advogados": len(bucket["advogados"]),
            **aggregate_rates(bucket),
        }
        for office_id, bucket in sorted(by_office.items())
    ]

    lawyer_ranking = sorted(
        [
            {
                "advogado_id": lawyer_id,
                "advogado_nome": bucket["advogado_nome"],
                "escritorio_nome": bucket["escritorio_nome"],
                "total": bucket["total"],
                "taxa_aderencia": round(bucket["aderentes"] / bucket["total"], 4),
            }
            for lawyer_id, bucket in by_lawyer.items()
        ],
        key=lambda item: item["taxa_aderencia"],
    )

    override_distribution: dict[str, int] = {}
    for row in overrides:
        reason = str(row["razao_override"] or "sem_motivo")
        override_distribution[reason] = override_distribution.get(reason, 0) + 1

    return {
        "total_processos": total,
        "taxa_aderencia_global": round(sum(int(row["aderente"]) for row in records) / total, 4) if total else 0.0,
        "taxa_override": round(len(overrides) / total, 4) if total else 0.0,
        "taxa_aceite_acordos": round(len(accepted) / len(agreements), 4) if agreements else 0.0,
        "tempo_decisao_medio_min": round(sum(int(row["tempo_decisao_min"]) for row in records) / total, 2) if total else 0.0,
        "razoes_override": override_distribution,
        "totais_por_advogado": lawyer_totals,
        "totais_por_escritorio": office_totals,
        "piores_advogados": lawyer_ranking[:5],
        "melhores_advogados": lawyer_ranking[-5:][::-1],
    }


def export_csv(records: list[dict[str, object]], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(records[0].keys()) if records else []
    with output_path.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(records)


def export_json(summary: dict[str, object], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Gera uma base sintetica de aderencia com perfis comportamentais explicaveis."
    )
    parser.add_argument("--xlsx", type=Path, default=DEFAULT_XLSX, help="Caminho do arquivo XLSX de entrada.")
    parser.add_argument("--output-csv", type=Path, default=DEFAULT_OUTPUT_CSV, help="CSV sintetico de saida.")
    parser.add_argument("--output-json", type=Path, default=DEFAULT_OUTPUT_JSON, help="Resumo JSON de saida.")
    parser.add_argument("--seed", type=int, default=42, help="Seed para reproducibilidade.")
    parser.add_argument("--limit", type=int, default=0, help="Limita a quantidade de casos processados.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    cases = load_cases(args.xlsx)
    if args.limit > 0:
        cases = cases[: args.limit]

    records = simulate_dataset(cases, seed=args.seed)
    summary = summarize(records)

    export_csv(records, args.output_csv)
    export_json(summary, args.output_json)

    print(f"Casos processados: {len(records)}")
    print(f"CSV sintetico: {args.output_csv}")
    print(f"Resumo JSON: {args.output_json}")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
