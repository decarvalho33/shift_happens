"""Screen-only usability evaluator for the existing local frontend.

The simulated user receives only the current viewport screenshot, the task and
its own interaction history. Task completion is derived from required,
observable milestones; it is never accepted from a model-provided success flag.
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import os
import re
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse

try:
    from openai import OpenAI
except ImportError:  # pragma: no cover - optional dependency guard
    OpenAI = None  # type: ignore[assignment,misc]

try:
    from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError, sync_playwright
except ImportError:  # pragma: no cover - optional dependency guard
    Page = Any  # type: ignore[assignment,misc]
    PlaywrightTimeoutError = TimeoutError  # type: ignore[assignment,misc]
    sync_playwright = None  # type: ignore[assignment]


ROOT = Path(__file__).resolve().parent
PROMPT_PATH = ROOT / "prompts" / "agent_system.md"
REPORTS_DIR = ROOT / "reports"
SCREENSHOTS_DIR = ROOT / "screenshots"
DEFAULT_BASE_URL = "http://127.0.0.1:5173"
DEFAULT_MODEL = "gpt-4.1-mini"
MODEL_ATTEMPTS = 3

SEVERITIES = ("crítico", "alto", "médio", "baixo")
SEVERITY_RANK = {severity: index for index, severity in enumerate(SEVERITIES)}


MILESTONE_DESCRIPTIONS: dict[str, str] = {
    "opened_process": "abriu um processo pela interface visível",
    "recommendation_identified": "identificou a recomendação exibida",
    "risk_identified": "identificou o risco de perda exibido",
    "reason_identified": "identificou ao menos um motivo visível da recomendação",
    "primary_action_identified": "identificou a ação principal disponível",
    "recommendation_reason_explained": "explicou por que a recomendação foi feita",
    "key_evidence_identified": "localizou e descreveu ao menos uma evidência principal",
    "important_evidence_identified": "identificou uma evidência importante para rastrear",
    "document_source_opened": "abriu a fonte documental da evidência",
    "document_identified": "identificou o documento de origem",
    "page_or_origin_identified": "identificou a página ou origem da evidência",
    "claim_vs_document_distinguished": "distinguiu alegação de fato documental",
    "recommendation_followed": "acionou Seguir recomendação",
    "decision_submitted": "enviou a decisão recomendada",
    "decision_confirmation_seen": "viu confirmação final da decisão recomendada",
    "divergence_started": "acionou Divergir ou a opção equivalente visível",
    "different_decision_confirmed": "confirmou visualmente uma decisão diferente da recomendação",
    "divergence_reason_selected": "selecionou o motivo da divergência",
    "divergence_justification_filled": "preencheu uma justificativa não vazia",
    "divergence_submitted": "enviou a decisão divergente",
    "divergence_confirmation_seen": "viu confirmação final da divergência",
    "agreement_case_found": "encontrou visualmente um caso cuja recomendação é ACORDO",
    "agreement_process_opened": "abriu o caso com recomendação ACORDO",
    "agreement_recommendation_confirmed": "confirmou na tela do processo que a recomendação é ACORDO",
    "agreement_recommendation_followed": "acionou Seguir recomendação no caso ACORDO",
    "agreement_decision_submitted": "enviou a decisão de ACORDO",
    "agreement_decision_confirmed": "viu confirmação da decisão de ACORDO",
    "negotiation_form_opened": "abriu o formulário de proposta e resultado",
    "proposal_value_filled": "preencheu o valor da proposta",
    "proposal_and_result_submitted": "enviou a proposta e o resultado da negociação",
    "proposal_confirmation_seen": "viu confirmação da proposta registrada",
    "negotiation_result_selected": "selecionou o resultado da negociação",
    "negotiation_result_confirmation_seen": "viu confirmação final do resultado da negociação",
}


@dataclass(frozen=True)
class TaskSpec:
    id: str
    name: str
    instruction: str
    required_milestones: tuple[str, ...]
    observable_milestones: tuple[str, ...]
    executable_milestones: tuple[str, ...]
    no_actions_after: str | None = None


TASKS: tuple[TaskSpec, ...] = (
    TaskSpec(
        id="test-1-compreensao-imediata",
        name="Compreensão imediata",
        instruction=(
            "Entre como Advogado e abra um processo. Assim que a tela do processo aparecer, "
            "sem clicar, rolar ou abrir outra seção, responda o que você entende que deveria "
            "fazer neste caso. Identifique recomendação, risco, ao menos um motivo e a ação principal."
        ),
        required_milestones=(
            "opened_process",
            "recommendation_identified",
            "risk_identified",
            "reason_identified",
            "primary_action_identified",
        ),
        observable_milestones=(
            "recommendation_identified",
            "risk_identified",
            "reason_identified",
            "primary_action_identified",
        ),
        executable_milestones=("opened_process",),
        no_actions_after="opened_process",
    ),
    TaskSpec(
        id="test-2-entender-recomendacao",
        name="Entender a recomendação",
        instruction=(
            "Entre como Advogado, abra um processo e descubra por que o sistema recomenda "
            "ACORDO ou DEFESA. Conclua somente após explicar o motivo e localizar as principais evidências."
        ),
        required_milestones=(
            "opened_process",
            "recommendation_identified",
            "recommendation_reason_explained",
            "key_evidence_identified",
        ),
        observable_milestones=(
            "recommendation_identified",
            "recommendation_reason_explained",
            "key_evidence_identified",
        ),
        executable_milestones=("opened_process",),
    ),
    TaskSpec(
        id="test-3-rastreabilidade",
        name="Rastreabilidade",
        instruction=(
            "Entre como Advogado, abra um processo e encontre a fonte documental de uma "
            "evidência importante. Abra a fonte e identifique documento, página ou origem, "
            "além de explicar se o item é alegação ou fato documental."
        ),
        required_milestones=(
            "opened_process",
            "important_evidence_identified",
            "document_source_opened",
            "document_identified",
            "page_or_origin_identified",
            "claim_vs_document_distinguished",
        ),
        observable_milestones=(
            "important_evidence_identified",
            "document_identified",
            "page_or_origin_identified",
            "claim_vs_document_distinguished",
        ),
        executable_milestones=("opened_process", "document_source_opened"),
    ),
    TaskSpec(
        id="test-4-seguir-recomendacao",
        name="Seguir recomendação",
        instruction=(
            "Entre como Advogado, abra um processo, identifique a recomendação, concorde com "
            "ela e registre a decisão. Conclua somente depois de ver a confirmação final."
        ),
        required_milestones=(
            "opened_process",
            "recommendation_identified",
            "recommendation_followed",
            "decision_submitted",
            "decision_confirmation_seen",
        ),
        observable_milestones=("recommendation_identified", "decision_confirmation_seen"),
        executable_milestones=("opened_process", "recommendation_followed", "decision_submitted"),
    ),
    TaskSpec(
        id="test-5-divergir",
        name="Divergir da recomendação",
        instruction=(
            "Entre como Advogado, abra um processo, identifique a recomendação e registre uma "
            "decisão diferente. Use a ação Divergir, confirme a alternativa, preencha uma "
            "justificativa e conclua somente depois de ver a confirmação final."
        ),
        required_milestones=(
            "opened_process",
            "recommendation_identified",
            "divergence_started",
            "different_decision_confirmed",
            "divergence_reason_selected",
            "divergence_justification_filled",
            "divergence_submitted",
            "divergence_confirmation_seen",
        ),
        observable_milestones=(
            "recommendation_identified",
            "different_decision_confirmed",
            "divergence_confirmation_seen",
        ),
        executable_milestones=(
            "opened_process",
            "divergence_started",
            "divergence_reason_selected",
            "divergence_justification_filled",
            "divergence_submitted",
        ),
    ),
    TaskSpec(
        id="test-6-negociacao",
        name="Negociação",
        instruction=(
            "Entre como Advogado e procure, pela interface visível, um caso com recomendação "
            "ACORDO. Não encerre em um caso DEFESA ou REVISAR: volte à fila e continue procurando. "
            "Abra o caso ACORDO, siga a recomendação e confirme a decisão. Depois abra o formulário "
            "de negociação, informe uma proposta, selecione um resultado final diferente de Pendente "
            "e envie ambos. Conclua somente após ver a confirmação final da negociação."
        ),
        required_milestones=(
            "agreement_case_found",
            "agreement_process_opened",
            "agreement_recommendation_confirmed",
            "agreement_recommendation_followed",
            "agreement_decision_submitted",
            "agreement_decision_confirmed",
            "negotiation_form_opened",
            "proposal_value_filled",
            "negotiation_result_selected",
            "proposal_and_result_submitted",
            "proposal_confirmation_seen",
            "negotiation_result_confirmation_seen",
        ),
        observable_milestones=(
            "agreement_case_found",
            "agreement_recommendation_confirmed",
            "agreement_decision_confirmed",
            "proposal_confirmation_seen",
            "negotiation_result_confirmation_seen",
        ),
        executable_milestones=(
            "agreement_process_opened",
            "agreement_recommendation_followed",
            "agreement_decision_submitted",
            "negotiation_form_opened",
            "proposal_value_filled",
            "negotiation_result_selected",
            "proposal_and_result_submitted",
        ),
    ),
)

TASK_BY_ID = {task.id: task for task in TASKS}

EXECUTABLE_ACTION_TYPES: dict[str, set[str]] = {
    "opened_process": {"click"},
    "document_source_opened": {"click", "press"},
    "recommendation_followed": {"click", "press"},
    "decision_submitted": {"click", "press"},
    "divergence_started": {"click", "press"},
    "divergence_reason_selected": {"click", "select"},
    "divergence_justification_filled": {"fill"},
    "divergence_submitted": {"click", "press"},
    "agreement_process_opened": {"click", "press"},
    "agreement_recommendation_followed": {"click", "press"},
    "agreement_decision_submitted": {"click", "press"},
    "negotiation_form_opened": {"click", "press"},
    "proposal_value_filled": {"click", "fill"},
    "negotiation_result_selected": {"click", "select"},
    "proposal_and_result_submitted": {"click", "press"},
}

OBSERVATION_PREREQUISITES: dict[str, tuple[str, ...]] = {
    "recommendation_identified": ("opened_process",),
    "risk_identified": ("opened_process",),
    "reason_identified": ("opened_process",),
    "primary_action_identified": ("opened_process",),
    "recommendation_reason_explained": ("opened_process",),
    "key_evidence_identified": ("opened_process",),
    "important_evidence_identified": ("opened_process",),
    "document_identified": ("document_source_opened",),
    "page_or_origin_identified": ("document_source_opened",),
    "claim_vs_document_distinguished": ("document_source_opened",),
    "decision_confirmation_seen": ("decision_submitted",),
    "different_decision_confirmed": ("divergence_started",),
    "divergence_confirmation_seen": ("divergence_submitted",),
    "agreement_recommendation_confirmed": ("agreement_process_opened",),
    "agreement_decision_confirmed": ("agreement_decision_submitted",),
    "proposal_confirmation_seen": ("proposal_and_result_submitted",),
    "negotiation_result_confirmation_seen": ("proposal_and_result_submitted",),
}

ACTION_PREREQUISITES: dict[str, tuple[str, ...]] = {
    "document_source_opened": ("opened_process", "important_evidence_identified"),
    "recommendation_followed": ("opened_process", "recommendation_identified"),
    "decision_submitted": ("recommendation_followed",),
    "divergence_started": ("opened_process", "recommendation_identified"),
    "divergence_reason_selected": ("divergence_started", "different_decision_confirmed"),
    "divergence_justification_filled": ("divergence_started", "different_decision_confirmed"),
    "divergence_submitted": (
        "divergence_reason_selected",
        "divergence_justification_filled",
        "different_decision_confirmed",
    ),
    "agreement_process_opened": ("agreement_case_found",),
    "agreement_recommendation_followed": (
        "agreement_process_opened",
        "agreement_recommendation_confirmed",
    ),
    "agreement_decision_submitted": ("agreement_recommendation_followed",),
    "negotiation_form_opened": ("agreement_decision_confirmed",),
    "proposal_value_filled": ("negotiation_form_opened",),
    "negotiation_result_selected": ("negotiation_form_opened",),
    "proposal_and_result_submitted": ("proposal_value_filled", "negotiation_result_selected"),
}


class ModelResponseValidationError(ValueError):
    """The model response is syntactically or semantically invalid."""


class ModelResponseExhaustedError(ModelResponseValidationError):
    """All attempts to obtain a valid model response failed."""

    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__(
            f"resposta inválida após {len(errors)} tentativas: " + " | ".join(errors)
        )


class ElementNotFoundError(ValueError):
    """No visible, user-facing control matched the requested target."""


@dataclass
class ActionRecord:
    index: int
    action: str
    target: str = ""
    near_text: str = ""
    value: str = ""
    milestone: str = "none"
    screen_before: str = ""
    success: bool = False
    error: str = ""
    duration_ms: int = 0
    scroll_delta: int | None = None


@dataclass
class TestResult:
    id: str
    name: str
    task: str
    task_status: str = "not_evaluated"
    task_success: bool = False
    done_requested: bool = False
    required_milestones: list[str] = field(default_factory=list)
    completed_milestones: list[str] = field(default_factory=list)
    missing_milestones: list[str] = field(default_factory=list)
    milestone_evidence: dict[str, list[str]] = field(default_factory=dict)
    completion_rate: float = 0.0
    action_count: int = 0
    necessary_action_count: int = 0
    scroll_count: int = 0
    wait_count: int = 0
    failed_action_count: int = 0
    hesitation_count: int = 0
    actions: list[ActionRecord] = field(default_factory=list)
    next_actions: list[str] = field(default_factory=list)
    hesitations: list[dict[str, str]] = field(default_factory=list)
    elements_not_found: list[str] = field(default_factory=list)
    screen_sequence: list[str] = field(default_factory=list)
    screens_visited: list[str] = field(default_factory=list)
    screenshots: list[str] = field(default_factory=list)
    interpretations: list[str] = field(default_factory=list)
    confusion: list[str] = field(default_factory=list)
    important: list[str] = field(default_factory=list)
    excess_information: list[str] = field(default_factory=list)
    interpretation_errors: list[str] = field(default_factory=list)
    confusing_fields: list[str] = field(default_factory=list)
    hard_to_find_buttons: list[str] = field(default_factory=list)
    missing_information: list[str] = field(default_factory=list)
    action_errors: list[str] = field(default_factory=list)
    model_validation_errors: list[str] = field(default_factory=list)
    infrastructure_errors: list[str] = field(default_factory=list)
    score_normalization_warnings: list[str] = field(default_factory=list)
    summary: str = ""
    clarity_score: float | None = None
    ease_score: float | None = None
    confidence_score: float | None = None
    ux_scores_valid: bool = False
    recommendations: list[dict[str, str]] = field(default_factory=list)
    stopped_reason: str = ""
    duration_seconds: float = 0.0


def unique(values: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(item.strip() for item in values if isinstance(item, str) and item.strip()))


def normalize_score(value: Any, scale: str | None = None) -> float:
    """Normalize a score to 0-10 and reject unusable values."""

    percent_literal = False
    if isinstance(value, bool) or value is None:
        raise ModelResponseValidationError("nota ausente ou booleana")
    if isinstance(value, str):
        candidate = value.strip().replace(",", ".")
        percent_literal = candidate.endswith("%")
        if percent_literal:
            candidate = candidate[:-1].strip()
        try:
            numeric = float(candidate)
        except ValueError as exc:
            raise ModelResponseValidationError(f"nota não numérica: {value!r}") from exc
    elif isinstance(value, (int, float)):
        numeric = float(value)
    else:
        raise ModelResponseValidationError(f"tipo de nota inválido: {type(value).__name__}")

    if not math.isfinite(numeric):
        raise ModelResponseValidationError("nota deve ser finita")
    if numeric < 0:
        raise ModelResponseValidationError("nota não pode ser negativa")

    if percent_literal:
        normalized = numeric / 10
    elif scale == "0-1":
        if numeric > 1:
            raise ModelResponseValidationError("nota fora da escala declarada 0-1")
        normalized = numeric * 10
    elif scale == "0-100":
        if numeric > 100:
            raise ModelResponseValidationError("nota fora da escala declarada 0-100")
        normalized = numeric / 10
    elif scale in (None, "0-10"):
        if 0 < numeric < 1:
            normalized = numeric * 10
        elif numeric <= 10:
            normalized = numeric
        elif numeric <= 100:
            normalized = numeric / 10
        else:
            raise ModelResponseValidationError("nota acima do máximo aceito")
    else:
        raise ModelResponseValidationError(f"escala de nota inválida: {scale!r}")

    if not 0 <= normalized <= 10:
        raise ModelResponseValidationError("nota normalizada fora de 0-10")
    return round(normalized, 2)


def validate_normalized_score(value: Any) -> float:
    """Validate an internal 0-10 score without applying ingestion heuristics again."""

    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ModelResponseValidationError("nota normalizada ausente ou não numérica")
    numeric = float(value)
    if not math.isfinite(numeric) or not 0 <= numeric <= 10:
        raise ModelResponseValidationError("nota interna fora da escala 0-10")
    return round(numeric, 2)


def _require_keys(value: dict[str, Any], expected: set[str], context: str) -> None:
    missing = expected - set(value)
    extra = set(value) - expected
    if missing:
        raise ModelResponseValidationError(f"{context}: campos ausentes: {', '.join(sorted(missing))}")
    if extra:
        raise ModelResponseValidationError(f"{context}: campos inesperados: {', '.join(sorted(extra))}")


def _require_string(value: Any, context: str, allow_empty: bool = False) -> str:
    if not isinstance(value, str) or (not allow_empty and not value.strip()):
        raise ModelResponseValidationError(f"{context}: texto inválido")
    return value.strip()


def _require_string_list(value: Any, context: str) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise ModelResponseValidationError(f"{context}: deve ser uma lista de textos")
    return [item.strip() for item in value if item.strip()]


def clean_json(text: str) -> dict[str, Any]:
    candidate = text.strip()
    if candidate.startswith("```"):
        candidate = re.sub(
            r"^```(?:json)?\s*|\s*```$", "", candidate, flags=re.IGNORECASE | re.DOTALL
        ).strip()

    def reject_constant(constant: str) -> None:
        raise ModelResponseValidationError(f"constante JSON inválida: {constant}")

    try:
        parsed = json.loads(candidate, parse_constant=reject_constant)
    except (json.JSONDecodeError, ModelResponseValidationError) as exc:
        raise ModelResponseValidationError(f"JSON inválido: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ModelResponseValidationError("a resposta do modelo não é um objeto JSON")
    return parsed


def _validate_final_evaluation(final: Any) -> tuple[dict[str, Any], dict[str, float], list[str]]:
    if not isinstance(final, dict):
        raise ModelResponseValidationError("final_evaluation deve ser um objeto ao concluir")
    expected = {
        "interpretation_errors",
        "confusing_fields",
        "hard_to_find_buttons",
        "missing_information",
        "summary",
        "score_scale",
        "clarity_score",
        "ease_score",
        "confidence_score",
        "recommendations",
    }
    _require_keys(final, expected, "final_evaluation")
    for key in (
        "interpretation_errors",
        "confusing_fields",
        "hard_to_find_buttons",
        "missing_information",
    ):
        _require_string_list(final[key], f"final_evaluation.{key}")
    _require_string(final["summary"], "final_evaluation.summary")
    scale = _require_string(final["score_scale"], "final_evaluation.score_scale")
    if scale not in {"0-1", "0-10", "0-100"}:
        raise ModelResponseValidationError("final_evaluation.score_scale inválida")

    normalized: dict[str, float] = {}
    warnings: list[str] = []
    for key in ("clarity_score", "ease_score", "confidence_score"):
        raw = final[key]
        normalized[key] = normalize_score(raw, scale)
        if scale == "0-10" and isinstance(raw, (int, float)) and not isinstance(raw, bool) and 0 < raw < 1:
            warnings.append(f"{key}: {raw} foi tratado como proporção e normalizado para {normalized[key]}/10")
        elif scale == "0-10" and isinstance(raw, (int, float)) and not isinstance(raw, bool) and 10 < raw <= 100:
            warnings.append(f"{key}: {raw} foi tratado como percentual e normalizado para {normalized[key]}/10")

    recommendations = final["recommendations"]
    if not isinstance(recommendations, list):
        raise ModelResponseValidationError("final_evaluation.recommendations deve ser uma lista")
    if not recommendations:
        raise ModelResponseValidationError(
            "final_evaluation.recommendations deve conter ao menos uma melhoria acionável"
        )
    for index, recommendation in enumerate(recommendations):
        if not isinstance(recommendation, dict):
            raise ModelResponseValidationError(f"recomendação {index}: objeto inválido")
        _require_keys(recommendation, {"severity", "title", "description", "evidence"}, f"recomendação {index}")
        if recommendation["severity"] not in SEVERITIES:
            raise ModelResponseValidationError(f"recomendação {index}: severidade inválida")
        for key in ("title", "description", "evidence"):
            _require_string(recommendation[key], f"recomendação {index}.{key}")
    return final, normalized, warnings


def validate_model_turn(raw: dict[str, Any], task: TaskSpec, force_done: bool = False) -> dict[str, Any]:
    expected = {
        "screen_name",
        "understanding",
        "next_action",
        "confusing",
        "important",
        "excess_information",
        "hesitation",
        "elements_not_found",
        "observed_milestones",
        "action",
        "final_evaluation",
    }
    _require_keys(raw, expected, "resposta")
    for key in ("screen_name", "understanding", "next_action"):
        _require_string(raw[key], key)
    for key in ("confusing", "important", "excess_information", "elements_not_found"):
        _require_string_list(raw[key], key)

    hesitation = raw["hesitation"]
    if not isinstance(hesitation, dict):
        raise ModelResponseValidationError("hesitation deve ser um objeto")
    _require_keys(hesitation, {"occurred", "reason"}, "hesitation")
    if not isinstance(hesitation["occurred"], bool):
        raise ModelResponseValidationError("hesitation.occurred deve ser booleano")
    _require_string(hesitation["reason"], "hesitation.reason", allow_empty=not hesitation["occurred"])

    observations = raw["observed_milestones"]
    if not isinstance(observations, list):
        raise ModelResponseValidationError("observed_milestones deve ser uma lista")
    for index, observation in enumerate(observations):
        if not isinstance(observation, dict):
            raise ModelResponseValidationError(f"observed_milestones[{index}] inválido")
        _require_keys(observation, {"id", "evidence"}, f"observed_milestones[{index}]")
        milestone = _require_string(observation["id"], f"observed_milestones[{index}].id")
        _require_string(observation["evidence"], f"observed_milestones[{index}].evidence")
        if milestone not in task.observable_milestones:
            raise ModelResponseValidationError(
                f"marco {milestone!r} não pode ser comprovado apenas por observação no teste {task.id}"
            )

    action = raw["action"]
    if not isinstance(action, dict):
        raise ModelResponseValidationError("action deve ser um objeto")
    _require_keys(
        action,
        {"type", "target", "near_text", "value", "direction", "milestone", "reason"},
        "action",
    )
    action_type = _require_string(action["type"], "action.type")
    if action_type not in {"click", "fill", "select", "press", "scroll", "wait", "done"}:
        raise ModelResponseValidationError(f"action.type não suportado: {action_type}")
    target = _require_string(action["target"], "action.target", allow_empty=True)
    near_text = _require_string(action["near_text"], "action.near_text", allow_empty=True)
    value = _require_string(action["value"], "action.value", allow_empty=True)
    direction = _require_string(action["direction"], "action.direction", allow_empty=True)
    milestone = _require_string(action["milestone"], "action.milestone")
    _require_string(action["reason"], "action.reason")

    if force_done and action_type != "done":
        raise ModelResponseValidationError("o limite foi alcançado; a ação deve ser done")
    if action_type in {"click", "fill", "select", "press"} and not target:
        raise ModelResponseValidationError(f"action.target é obrigatório para {action_type}")
    if milestone == "agreement_process_opened" and not near_text:
        raise ModelResponseValidationError(
            "agreement_process_opened exige near_text com o caso ACORDO visível para distinguir controles repetidos"
        )
    if action_type in {"fill", "select"} and not value:
        raise ModelResponseValidationError(f"action.value é obrigatório para {action_type}")
    if action_type == "scroll" and direction not in {"up", "down"}:
        raise ModelResponseValidationError("action.direction deve ser up ou down para scroll")
    if action_type == "wait":
        try:
            int(value or "800")
        except ValueError as exc:
            raise ModelResponseValidationError("action.value de wait deve conter milissegundos") from exc
    if milestone == "negotiation_result_selected":
        selected_result = (value if action_type == "select" else target).casefold()
        if not selected_result or "pendent" in selected_result or "aguardando" in selected_result:
            raise ModelResponseValidationError(
                "negotiation_result_selected exige um resultado final diferente de Pendente"
            )

    if action_type in {"scroll", "wait", "done"} and milestone != "none":
        raise ModelResponseValidationError(f"{action_type} não pode comprovar um marco executável")
    if milestone != "none":
        if milestone not in task.executable_milestones:
            raise ModelResponseValidationError(f"marco executável {milestone!r} não pertence ao teste")
        allowed_types = EXECUTABLE_ACTION_TYPES.get(milestone, set())
        if action_type not in allowed_types:
            raise ModelResponseValidationError(
                f"marco {milestone!r} não pode ser comprovado por ação {action_type!r}"
            )

    if action_type == "done":
        final, scores, warnings = _validate_final_evaluation(raw["final_evaluation"])
        raw["final_evaluation"] = final
        raw["_normalized_scores"] = scores
        raw["_score_warnings"] = warnings
    elif raw["final_evaluation"] is not None:
        raise ModelResponseValidationError("final_evaluation deve ser null antes da ação done")
    return raw


def _string_array_schema() -> dict[str, Any]:
    return {"type": "array", "items": {"type": "string"}}


def turn_schema_for_task(task: TaskSpec) -> dict[str, Any]:
    recommendation_schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "severity": {"type": "string", "enum": list(SEVERITIES)},
            "title": {"type": "string"},
            "description": {"type": "string"},
            "evidence": {"type": "string"},
        },
        "required": ["severity", "title", "description", "evidence"],
    }
    final_schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "interpretation_errors": _string_array_schema(),
            "confusing_fields": _string_array_schema(),
            "hard_to_find_buttons": _string_array_schema(),
            "missing_information": _string_array_schema(),
            "summary": {"type": "string"},
            "score_scale": {"type": "string", "enum": ["0-10", "0-1", "0-100"]},
            "clarity_score": {"type": "number", "minimum": 0, "maximum": 100},
            "ease_score": {"type": "number", "minimum": 0, "maximum": 100},
            "confidence_score": {"type": "number", "minimum": 0, "maximum": 100},
            "recommendations": {"type": "array", "minItems": 1, "items": recommendation_schema},
        },
        "required": [
            "interpretation_errors",
            "confusing_fields",
            "hard_to_find_buttons",
            "missing_information",
            "summary",
            "score_scale",
            "clarity_score",
            "ease_score",
            "confidence_score",
            "recommendations",
        ],
    }
    observable_ids = list(task.observable_milestones)
    executable_ids = ["none", *task.executable_milestones]
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "screen_name": {"type": "string"},
            "understanding": {"type": "string"},
            "next_action": {"type": "string"},
            "confusing": _string_array_schema(),
            "important": _string_array_schema(),
            "excess_information": _string_array_schema(),
            "hesitation": {
                "type": "object",
                "additionalProperties": False,
                "properties": {"occurred": {"type": "boolean"}, "reason": {"type": "string"}},
                "required": ["occurred", "reason"],
            },
            "elements_not_found": _string_array_schema(),
            "observed_milestones": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "id": {"type": "string", "enum": observable_ids},
                        "evidence": {"type": "string"},
                    },
                    "required": ["id", "evidence"],
                },
            },
            "action": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": ["click", "fill", "select", "press", "scroll", "wait", "done"],
                    },
                    "target": {"type": "string"},
                    "near_text": {"type": "string"},
                    "value": {"type": "string"},
                    "direction": {"type": "string", "enum": ["", "up", "down"]},
                    "milestone": {"type": "string", "enum": executable_ids},
                    "reason": {"type": "string"},
                },
                "required": ["type", "target", "near_text", "value", "direction", "milestone", "reason"],
            },
            "final_evaluation": {"anyOf": [final_schema, {"type": "null"}]},
        },
        "required": [
            "screen_name",
            "understanding",
            "next_action",
            "confusing",
            "important",
            "excess_information",
            "hesitation",
            "elements_not_found",
            "observed_milestones",
            "action",
            "final_evaluation",
        ],
    }


def screenshot(page: Page, test_id: str, step: int) -> Path:
    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    destination = SCREENSHOTS_DIR / f"{test_id}-step-{step:02d}.png"
    page.screenshot(path=str(destination), full_page=False)
    return destination


def data_url(path: Path) -> str:
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def record_milestone(result: TestResult, milestone: str, evidence: str) -> None:
    if milestone not in result.completed_milestones:
        result.completed_milestones.append(milestone)
    result.milestone_evidence.setdefault(milestone, [])
    if evidence.strip() not in result.milestone_evidence[milestone]:
        result.milestone_evidence[milestone].append(evidence.strip())


def model_context(task: TaskSpec, result: TestResult, remaining_actions: int, feedback: str = "") -> str:
    criteria = "\n".join(
        f"- {milestone}: {MILESTONE_DESCRIPTIONS[milestone]}" for milestone in task.required_milestones
    )
    history = "\n".join(
        f"- {record.action} em '{record.target}'"
        f"{f' perto de {record.near_text!r}' if record.near_text else ''} "
        f"({'foi executada; confirme o resultado na tela' if record.success else 'não foi executada'})"
        for record in result.actions
    ) or "- Nenhuma ação executada ainda."
    completed = "\n".join(
        f"- {milestone}: {MILESTONE_DESCRIPTIONS[milestone]}" for milestone in result.completed_milestones
    ) or "- Nenhum marco confirmado ainda."
    prior_findings = "\n".join(f"- {item}" for item in result.interpretations[-6:]) or "- Nenhum ainda."
    prior_issues = "\n".join(
        f"- {item}"
        for item in unique(
            [
                *result.confusion,
                *result.excess_information,
                *result.elements_not_found,
                *(entry["reason"] for entry in result.hesitations),
            ]
        )[-12:]
    ) or "- Nenhum ainda."
    context = (
        f"TAREFA DE USABILIDADE\n{task.instruction}\n\n"
        f"CRITÉRIOS DE CONCLUSÃO\n{criteria}\n\n"
        f"HISTÓRICO DAS SUAS PRÓPRIAS AÇÕES VISÍVEIS\n{history}\n\n"
        f"MARCOS JÁ CONFIRMADOS\n{completed}\n\n"
        f"O QUE VOCÊ ENTENDEU NAS TELAS ANTERIORES\n{prior_findings}\n\n"
        f"DÚVIDAS, EXCESSOS, HESITAÇÕES E ITENS NÃO ENCONTRADOS\n{prior_issues}\n\n"
        f"Ações restantes: {remaining_actions}. Analise somente a screenshot atual. "
        "Não use URL, DOM, código, README, documentação interna ou conhecimento da implementação."
    )
    if remaining_actions == 0 or (task.no_actions_after and task.no_actions_after in result.completed_milestones):
        context += "\nNão execute outra interação. Use done e faça a avaliação final, mesmo se a tarefa falhou."
    if feedback:
        context += f"\n\nA resposta anterior foi rejeitada pela validação: {feedback}\nCorrija todos os pontos."
    return context


def ask_model(
    client: Any,
    model: str,
    system_prompt: str,
    task: TaskSpec,
    result: TestResult,
    image: Path,
    remaining_actions: int,
    feedback: str = "",
) -> dict[str, Any]:
    response = client.responses.create(
        model=model,
        input=[
            {"role": "system", "content": [{"type": "input_text", "text": system_prompt}]},
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": model_context(task, result, remaining_actions, feedback),
                    },
                    {"type": "input_image", "image_url": data_url(image)},
                ],
            },
        ],
        text={
            "format": {
                "type": "json_schema",
                "name": re.sub(r"[^a-zA-Z0-9_]", "_", task.id),
                "strict": True,
                "schema": turn_schema_for_task(task),
            }
        },
    )
    return clean_json(response.output_text)


def validate_observation_prerequisites(turn: dict[str, Any], result: TestResult) -> None:
    for observation in turn["observed_milestones"]:
        prerequisites = OBSERVATION_PREREQUISITES.get(observation["id"], ())
        missing = [item for item in prerequisites if item not in result.completed_milestones]
        if missing:
            raise ModelResponseValidationError(
                f"o marco observado {observation['id']!r} exige uma screenshot posterior a: "
                + ", ".join(missing)
            )


def validate_action_prerequisites(turn: dict[str, Any], result: TestResult) -> None:
    milestone = turn["action"]["milestone"]
    if milestone == "none":
        return
    current_observations = {item["id"] for item in turn["observed_milestones"]}
    available = set(result.completed_milestones) | current_observations
    missing = [item for item in ACTION_PREREQUISITES.get(milestone, ()) if item not in available]
    if missing:
        raise ModelResponseValidationError(
            f"a ação que marca {milestone!r} exige antes: " + ", ".join(missing)
        )


def request_validated_turn(
    client: Any,
    model: str,
    system_prompt: str,
    task: TaskSpec,
    result: TestResult,
    image: Path,
    remaining_actions: int,
) -> tuple[dict[str, Any], list[str]]:
    errors: list[str] = []
    feedback = ""
    force_done = remaining_actions == 0 or (
        task.no_actions_after is not None and task.no_actions_after in result.completed_milestones
    )
    for _ in range(MODEL_ATTEMPTS):
        try:
            raw = ask_model(
                client,
                model,
                system_prompt,
                task,
                result,
                image,
                remaining_actions,
                feedback,
            )
            validated = validate_model_turn(raw, task, force_done=force_done)
            validate_observation_prerequisites(validated, result)
            validate_action_prerequisites(validated, result)
            return validated, errors
        except Exception as exc:
            feedback = str(exc)
            errors.append(feedback)
    raise ModelResponseExhaustedError(errors)


def visible_candidates(scope: Any, target: str) -> list[Any]:
    target = target.strip()
    return [
        scope.get_by_role("button", name=target, exact=True),
        scope.get_by_role("button", name=target, exact=False),
        scope.get_by_role("link", name=target, exact=True),
        scope.get_by_role("link", name=target, exact=False),
        scope.get_by_role("tab", name=target, exact=False),
        scope.get_by_text(target, exact=True),
        scope.get_by_text(target, exact=False),
    ]


def first_visible(candidates: list[Any]) -> Any:
    for candidate in candidates:
        try:
            if candidate.count() and candidate.first.is_visible():
                return candidate.first
        except Exception:
            continue
    raise ElementNotFoundError("nenhum controle visível corresponde ao alvo informado")


def visible_scope(page: Page, near_text: str) -> Any:
    if not near_text.strip():
        return page
    for role in ("row", "listitem", "article", "group"):
        try:
            candidate = page.get_by_role(role).filter(has_text=near_text)
            if candidate.count() and candidate.first.is_visible():
                return candidate.first
        except Exception:
            continue
    anchor = first_visible(
        [page.get_by_text(near_text, exact=True), page.get_by_text(near_text, exact=False)]
    )
    ancestor = anchor.locator(
        "xpath=ancestor-or-self::*[self::tr or @role='row' or self::li or "
        "self::article or self::section or self::div][1]"
    )
    if ancestor.count() and ancestor.first.is_visible():
        return ancestor.first
    raise ElementNotFoundError(f"nenhuma região visível corresponde ao contexto '{near_text}'")


def _same_origin(url: str, allowed_origin: str) -> bool:
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}" == allowed_origin


def execute_action(page: Page, action: dict[str, Any], index: int, screen_before: str, allowed_origin: str) -> ActionRecord:
    action_type = str(action["type"]).lower()
    target = str(action["target"])
    near_text = str(action["near_text"])
    value = str(action["value"])
    record = ActionRecord(
        index=index,
        action=action_type,
        target=target,
        near_text=near_text,
        value=value,
        milestone=str(action["milestone"]),
        screen_before=screen_before,
    )
    started = time.monotonic()
    before_scroll: int | None = None
    try:
        scope = visible_scope(page, near_text)
        if action_type == "click":
            first_visible(visible_candidates(scope, target)).click()
        elif action_type == "fill":
            locator = scope.get_by_label(target, exact=False)
            if not locator.count() or not locator.first.is_visible():
                locator = scope.get_by_role("textbox", name=target, exact=False)
            if not locator.count() or not locator.first.is_visible():
                locator = scope.get_by_placeholder(target, exact=False)
            first_visible([locator]).fill(value)
        elif action_type == "select":
            locator = scope.get_by_label(target, exact=False)
            if not locator.count() or not locator.first.is_visible():
                locator = scope.get_by_role("combobox", name=target, exact=False)
            first_visible([locator]).select_option(label=value)
        elif action_type == "press":
            first_visible(visible_candidates(scope, target)).press(value or "Enter")
        elif action_type == "scroll":
            try:
                before_scroll = int(page.evaluate("() => window.scrollY"))
            except Exception:
                before_scroll = None
            amount = 720 if action["direction"] == "down" else -720
            page.mouse.wheel(0, amount)
        elif action_type == "wait":
            page.wait_for_timeout(min(max(int(value or "800"), 100), 2_000))
        else:
            raise ValueError(f"ação não executável: {action_type}")
        page.wait_for_timeout(450)
        if not _same_origin(page.url, allowed_origin):
            external_url = page.url
            page.go_back(wait_until="domcontentloaded")
            raise ValueError(f"navegação externa bloqueada: {urlparse(external_url).netloc}")
        if action_type == "scroll" and before_scroll is not None:
            try:
                record.scroll_delta = int(page.evaluate("() => window.scrollY")) - before_scroll
            except Exception:
                record.scroll_delta = None
        record.success = True
    except (PlaywrightTimeoutError, Exception) as exc:
        record.error = str(exc)
    finally:
        record.duration_ms = round((time.monotonic() - started) * 1000)
    return record


def merge_turn(result: TestResult, turn: dict[str, Any]) -> None:
    screen_name = str(turn["screen_name"]).strip()
    result.screen_sequence.append(screen_name)
    result.interpretations.append(str(turn["understanding"]).strip())
    result.next_actions.append(str(turn["next_action"]).strip())
    result.confusion.extend(turn["confusing"])
    result.important.extend(turn["important"])
    result.excess_information.extend(turn["excess_information"])
    result.elements_not_found.extend(turn["elements_not_found"])
    if turn["hesitation"]["occurred"]:
        result.hesitations.append(
            {
                "screen": screen_name,
                "reason": str(turn["hesitation"]["reason"]).strip(),
                "next_action": str(turn["next_action"]).strip(),
            }
        )
    for observation in turn["observed_milestones"]:
        record_milestone(result, observation["id"], observation["evidence"])


def merge_final_evaluation(result: TestResult, turn: dict[str, Any]) -> None:
    final = turn["final_evaluation"]
    result.interpretation_errors.extend(final["interpretation_errors"])
    result.confusing_fields.extend(final["confusing_fields"])
    result.hard_to_find_buttons.extend(final["hard_to_find_buttons"])
    result.missing_information.extend(final["missing_information"])
    result.summary = str(final["summary"]).strip()
    scores = turn["_normalized_scores"]
    result.clarity_score = scores["clarity_score"]
    result.ease_score = scores["ease_score"]
    result.confidence_score = scores["confidence_score"]
    result.ux_scores_valid = True
    result.score_normalization_warnings.extend(turn["_score_warnings"])
    result.recommendations.extend(
        {
            "severity": recommendation["severity"],
            "title": recommendation["title"].strip(),
            "description": recommendation["description"].strip(),
            "evidence": recommendation["evidence"].strip(),
        }
        for recommendation in final["recommendations"]
    )


def finalize_result(result: TestResult, task: TaskSpec, dry_run: bool = False) -> TestResult:
    result.required_milestones = list(task.required_milestones)
    result.completed_milestones = [
        milestone for milestone in task.required_milestones if milestone in result.completed_milestones
    ]
    result.missing_milestones = [
        milestone for milestone in task.required_milestones if milestone not in result.completed_milestones
    ]
    result.completion_rate = round(
        len(result.completed_milestones) / len(result.required_milestones), 3
    ) if result.required_milestones else 1.0
    result.action_count = len(result.actions)
    result.necessary_action_count = sum(
        record.action in {"click", "fill", "select", "press"} for record in result.actions
    )
    result.scroll_count = sum(record.action == "scroll" for record in result.actions)
    result.wait_count = sum(record.action == "wait" for record in result.actions)
    result.failed_action_count = sum(not record.success for record in result.actions)
    result.hesitation_count = len(result.hesitations)
    result.screens_visited = unique(result.screen_sequence)
    result.elements_not_found = unique(result.elements_not_found)
    result.confusion = unique(result.confusion)
    result.important = unique(result.important)
    result.excess_information = unique(result.excess_information)
    result.interpretation_errors = unique(result.interpretation_errors)
    result.confusing_fields = unique(result.confusing_fields)
    result.hard_to_find_buttons = unique(result.hard_to_find_buttons)
    result.missing_information = unique(result.missing_information)
    result.action_errors = unique(result.action_errors)
    result.infrastructure_errors = unique(result.infrastructure_errors)
    result.score_normalization_warnings = unique(result.score_normalization_warnings)

    if dry_run and result.infrastructure_errors:
        result.task_status = "infrastructure_error"
        result.task_success = False
    elif dry_run:
        result.task_status = "not_evaluated"
        result.task_success = False
    elif result.infrastructure_errors and not result.done_requested:
        result.task_status = "infrastructure_error"
        result.task_success = False
    elif result.done_requested and not result.missing_milestones:
        result.task_status = "success"
        result.task_success = True
    elif result.done_requested:
        result.task_status = "failure"
        result.task_success = False
    else:
        result.task_status = "incomplete"
        result.task_success = False
    return result


def run_one(
    page: Page,
    client: Any,
    model: str,
    system_prompt: str,
    task: TaskSpec,
    base_url: str,
    max_actions: int,
    dry_run: bool,
) -> TestResult:
    result = TestResult(id=task.id, name=task.name, task=task.instruction)
    started = time.monotonic()
    try:
        page.goto(base_url, wait_until="domcontentloaded", timeout=15_000)
        page.wait_for_timeout(500)
    except Exception as exc:
        result.infrastructure_errors.append(f"não foi possível abrir o frontend: {exc}")
        result.stopped_reason = "falha ao abrir o frontend"
        result.duration_seconds = round(time.monotonic() - started, 2)
        return finalize_result(result, task, dry_run=dry_run)

    try:
        if dry_run:
            image = screenshot(page, result.id, 0)
            result.screenshots.append(str(image.relative_to(ROOT)).replace("\\", "/"))
            result.screen_sequence.append("captura inicial para validação da infraestrutura")
            result.stopped_reason = "dry-run: navegador, frontend e screenshot validados sem chamar o modelo"
            return finalize_result(result, task, dry_run=True)

        while True:
            image = screenshot(page, result.id, len(result.screenshots))
            result.screenshots.append(str(image.relative_to(ROOT)).replace("\\", "/"))
            remaining = max_actions - len(result.actions)
            try:
                turn, validation_errors = request_validated_turn(
                    client,
                    model,
                    system_prompt,
                    task,
                    result,
                    image,
                    remaining,
                )
                result.model_validation_errors.extend(validation_errors)
            except Exception as exc:
                if isinstance(exc, ModelResponseExhaustedError):
                    result.model_validation_errors.extend(exc.errors)
                result.infrastructure_errors.append(str(exc))
                result.stopped_reason = "não foi possível obter uma resposta válida do modelo"
                break

            merge_turn(result, turn)
            action = turn["action"]
            if action["type"] == "done":
                result.done_requested = True
                result.stopped_reason = str(action["reason"]).strip()
                merge_final_evaluation(result, turn)
                break

            if remaining <= 0:  # defensive guard; semantic validation already rejects this
                result.infrastructure_errors.append("o modelo tentou exceder o limite de ações")
                result.stopped_reason = f"limite exato de {max_actions} ações atingido"
                break

            record = execute_action(
                page,
                action,
                index=len(result.actions) + 1,
                screen_before=str(turn["screen_name"]),
                allowed_origin=f"{urlparse(base_url).scheme}://{urlparse(base_url).netloc}",
            )
            result.actions.append(record)
            if record.success and record.milestone != "none":
                context_evidence = f" perto de '{record.near_text}'" if record.near_text else ""
                record_milestone(
                    result,
                    record.milestone,
                    f"{record.action} executado no controle visível '{record.target}'{context_evidence}",
                )
            if not record.success:
                result.action_errors.append(
                    f"{record.action} em '{record.target}' falhou: {record.error}"
                )
                result.confusion.append(
                    f"A ação '{record.action}' em '{record.target}' não pôde ser concluída."
                )
                if isinstance(record.error, str) and "nenhum controle visível" in record.error:
                    result.elements_not_found.append(record.target)
    finally:
        result.duration_seconds = round(time.monotonic() - started, 2)
    return finalize_result(result, task, dry_run=False)


def _validated_score_for_average(result: TestResult, name: str) -> float | None:
    if not result.ux_scores_valid:
        return None
    try:
        normalized = {
            score_name: validate_normalized_score(getattr(result, score_name))
            for score_name in ("clarity_score", "ease_score", "confidence_score")
        }
        return normalized[name]
    except ModelResponseValidationError:
        return None


def _score_average(results: list[TestResult], name: str) -> tuple[float | None, int]:
    values = [value for result in results if (value := _validated_score_for_average(result, name)) is not None]
    return (round(sum(values) / len(values), 1), len(values)) if values else (None, 0)


def _recommendation_key(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", title.casefold()).strip()


def aggregate_recommendations(results: list[TestResult]) -> list[dict[str, Any]]:
    candidates: list[tuple[str, str, str, str, str]] = []
    for result in results:
        for recommendation in result.recommendations:
            candidates.append(
                (
                    recommendation["severity"],
                    recommendation["title"],
                    recommendation["description"],
                    recommendation["evidence"],
                    result.id,
                )
            )
        if result.task_status in {"failure", "incomplete"} and result.missing_milestones:
            candidates.append(
                (
                    "crítico",
                    f"Desbloquear a tarefa {result.name}",
                    "Garantir que a ação principal e sua confirmação possam ser concluídas pela interface.",
                    "Marcos ausentes: "
                    + ", ".join(MILESTONE_DESCRIPTIONS[item] for item in result.missing_milestones),
                    result.id,
                )
            )
        for element in result.elements_not_found:
            candidates.append(
                (
                    "alto",
                    f"Tornar o controle '{element}' localizável",
                    "Rever rótulo, posição e destaque do controle esperado pelo usuário.",
                    f"O agente procurou o elemento visível e não o encontrou em {result.name}.",
                    result.id,
                )
            )
        for item in result.hard_to_find_buttons:
            candidates.append(("alto", item, "Dar mais visibilidade ao controle principal.", item, result.id))
        for item in result.missing_information:
            candidates.append(("alto", item, "Exibir a informação necessária no momento da decisão.", item, result.id))
        for item in result.interpretation_errors:
            candidates.append(("alto", item, "Reformular a interface para evitar esta interpretação.", item, result.id))
        for item in result.confusing_fields:
            candidates.append(("médio", item, "Rever rótulo e ajuda contextual do campo.", item, result.id))
        for item in result.confusion:
            candidates.append(("médio", item, "Reduzir a ambiguidade percebida neste ponto.", item, result.id))
        for hesitation in result.hesitations:
            candidates.append(
                (
                    "médio",
                    hesitation["reason"],
                    "Tornar o próximo passo mais evidente nesta tela.",
                    f"Hesitação em {hesitation['screen']}: {hesitation['reason']}",
                    result.id,
                )
            )
        for item in result.excess_information:
            candidates.append(("baixo", item, "Reduzir ou mover o conteúdo que compete com a tarefa.", item, result.id))

    merged: dict[str, dict[str, Any]] = {}
    for severity, title, description, evidence, test_id in candidates:
        key = _recommendation_key(title) or _recommendation_key(description)
        current = merged.get(key)
        if current is None:
            merged[key] = {
                "severity": severity,
                "title": title,
                "description": description,
                "evidence": [evidence],
                "affected_tests": [test_id],
                "occurrences": 1,
            }
            continue
        current["occurrences"] += 1
        if test_id not in current["affected_tests"]:
            current["affected_tests"].append(test_id)
        if evidence not in current["evidence"]:
            current["evidence"].append(evidence)
        if SEVERITY_RANK[severity] < SEVERITY_RANK[current["severity"]]:
            current["severity"] = severity
            current["description"] = description

    return sorted(
        merged.values(),
        key=lambda item: (
            SEVERITY_RANK[item["severity"]],
            -len(item["affected_tests"]),
            -item["occurrences"],
            item["title"].casefold(),
        ),
    )


def serializable_result(result: TestResult) -> dict[str, Any]:
    payload = asdict(result)
    if _validated_score_for_average(result, "clarity_score") is None:
        payload["clarity_score"] = None
        payload["ease_score"] = None
        payload["confidence_score"] = None
        payload["ux_scores_valid"] = False
    return payload


def build_report(
    results: list[TestResult],
    started_at: str,
    model: str,
    base_url: str,
    dry_run: bool,
    dry_run_checks: dict[str, Any] | None = None,
) -> dict[str, Any]:
    attempted = [] if dry_run else [result for result in results if result.task_status != "not_evaluated"]
    successful = sum(result.task_success for result in attempted)
    clarity, clarity_count = _score_average(results, "clarity_score")
    ease, ease_count = _score_average(results, "ease_score")
    confidence, confidence_count = _score_average(results, "confidence_score")
    valid_evaluations = sum(
        _validated_score_for_average(result, "clarity_score") is not None for result in results
    )
    recommendations = aggregate_recommendations(results)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "started_at": started_at,
        "base_url": base_url,
        "model": model,
        "execution_mode": "dry-run" if dry_run else "evaluation",
        "screen_only": True,
        "dry_run_checks": dry_run_checks or {},
        "summary": {
            "task_outcomes": {
                "success_rate": round(successful / len(attempted), 3) if attempted else None,
                "successful_tasks": successful,
                "attempted_tasks": len(attempted),
                "total_tasks": len(results),
            },
            "interaction_metrics": {
                "average_actions": round(sum(item.action_count for item in attempted) / len(attempted), 2)
                if attempted
                else None,
                "total_actions": sum(item.action_count for item in attempted),
                "necessary_actions": sum(item.necessary_action_count for item in attempted),
                "scrolls": sum(item.scroll_count for item in attempted),
                "failed_actions": sum(item.failed_action_count for item in attempted),
                "hesitations": sum(item.hesitation_count for item in attempted),
                "elements_not_found": sum(len(item.elements_not_found) for item in attempted),
            },
            "ux_quality": {
                "clarity_score": clarity,
                "ease_score": ease,
                "confidence_score": confidence,
                "valid_evaluations": valid_evaluations,
                "total_tasks": len(results),
                "score_sample_sizes": {
                    "clarity": clarity_count,
                    "ease": ease_count,
                    "confidence": confidence_count,
                },
            },
            "evaluation_reliability": {
                "infrastructure_error_tasks": sum(bool(item.infrastructure_errors) for item in results),
                "rejected_model_responses": sum(len(item.model_validation_errors) for item in results),
                "score_normalization_corrections": sum(
                    len(item.score_normalization_warnings) for item in results
                ),
            },
        },
        "recommendations": recommendations,
        "tests": [serializable_result(result) for result in results],
    }


def md_list(items: Iterable[str], empty: str = "Nenhum registro.") -> str:
    values = list(items)
    return "\n".join(f"- {item}" for item in values) if values else f"- {empty}"


def _score_label(value: float | None) -> str:
    return f"{value:.1f}/10" if value is not None else "não avaliada"


def _status_label(status: str) -> str:
    return {
        "success": "Sucesso",
        "failure": "Falha",
        "incomplete": "Incompleto",
        "not_evaluated": "Não avaliado",
        "infrastructure_error": "Erro de infraestrutura",
    }.get(status, status)


def markdown_report(report: dict[str, Any]) -> str:
    summary = report["summary"]
    outcomes = summary["task_outcomes"]
    interaction = summary["interaction_metrics"]
    quality = summary["ux_quality"]
    reliability = summary["evaluation_reliability"]
    rate = (
        f"{outcomes['success_rate']:.0%}"
        if outcomes["success_rate"] is not None
        else "não calculada no dry-run"
    )
    average_actions = (
        f"{interaction['average_actions']:.2f}"
        if interaction["average_actions"] is not None
        else "não calculada"
    )
    lines = [
        "# UX Report",
        "",
        "## Resumo executivo",
        "",
        (
            "A avaliação simulou um advogado externo sem treinamento usando somente a interface "
            f"renderizada. A taxa de sucesso das tarefas foi **{rate}** "
            f"({outcomes['successful_tasks']}/{outcomes['attempted_tasks']} tentadas), com média de "
            f"**{average_actions} ações** por tarefa."
        ),
        "",
        "O sucesso da tarefa e a qualidade percebida da UX são métricas independentes.",
        "",
        f"- Clareza: **{_score_label(quality['clarity_score'])}**",
        f"- Facilidade: **{_score_label(quality['ease_score'])}**",
        f"- Confiança para decidir: **{_score_label(quality['confidence_score'])}**",
        f"- Avaliações com notas válidas: **{quality['valid_evaluations']}/{quality['total_tasks']}**",
        f"- Scrolls: **{interaction['scrolls']}**",
        f"- Ações necessárias para os objetivos: **{interaction['necessary_actions']}**",
        f"- Erros de ação: **{interaction['failed_actions']}**",
        f"- Hesitações: **{interaction['hesitations']}**",
        f"- Elementos não encontrados: **{interaction['elements_not_found']}**",
        f"- Respostas do modelo rejeitadas e corrigidas: **{reliability['rejected_model_responses']}**",
        f"- Correções de escala das notas: **{reliability['score_normalization_corrections']}**",
        f"- Tarefas com erro de infraestrutura: **{reliability['infrastructure_error_tasks']}**",
        "",
        "## Resultado por tarefa",
        "",
        "| Teste | Tarefa | Conclusão | Interações | Ações necessárias | Scrolls | Erros | Hesitações | Clareza | Facilidade | Confiança |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for item in report["tests"]:
        lines.append(
            f"| {item['name']} | {_status_label(item['task_status'])} | "
            f"{item['completion_rate']:.0%} | {item['action_count']} | {item['necessary_action_count']} | "
            f"{item['scroll_count']} | "
            f"{item['failed_action_count']} | {item['hesitation_count']} | "
            f"{_score_label(item['clarity_score'])} | {_score_label(item['ease_score'])} | "
            f"{_score_label(item['confidence_score'])} |"
        )

    lines.extend(["", "## Recomendações priorizadas", ""])
    recommendations = report["recommendations"]
    if recommendations:
        for index, recommendation in enumerate(recommendations[:5], 1):
            affected = ", ".join(recommendation["affected_tests"])
            lines.extend(
                [
                    f"### {index}. [{recommendation['severity'].upper()}] {recommendation['title']}",
                    "",
                    recommendation["description"],
                    "",
                    f"**Testes afetados:** {affected}",
                    "",
                    "**Evidências**",
                    "",
                    md_list(recommendation["evidence"]),
                    "",
                ]
            )
    else:
        lines.extend(["Nenhuma recomendação foi registrada.", ""])

    lines.extend(["## Observações por tarefa", ""])
    for item in report["tests"]:
        completed = [MILESTONE_DESCRIPTIONS.get(value, value) for value in item["completed_milestones"]]
        missing = [MILESTONE_DESCRIPTIONS.get(value, value) for value in item["missing_milestones"]]
        action_lines = []
        for action in item["actions"]:
            status = "ok" if action["success"] else f"falhou: {action['error']}"
            milestone = f"; marco: {action['milestone']}" if action["milestone"] != "none" else ""
            near = f" perto de {action['near_text']!r}" if action["near_text"] else ""
            action_lines.append(
                f"#{action['index']} {action['action']} — {action['target'] or 'sem alvo'}"
                f"{near} "
                f"({status}; {action['duration_ms']} ms{milestone})"
            )
        lines.extend(
            [
                f"### {item['name']}",
                "",
                f"**Resultado da tarefa:** {_status_label(item['task_status'])} "
                f"({item['completion_rate']:.0%} dos marcos).",
                "",
                f"**Resumo da UX:** {item['summary'] or 'Sem avaliação final.'}",
                "",
                "**Marcos concluídos**",
                "",
                md_list(completed),
                "",
                "**Marcos ausentes**",
                "",
                md_list(missing),
                "",
                "**Ações executadas**",
                "",
                md_list(action_lines),
                "",
                "**Hesitações**",
                "",
                md_list(
                    f"{entry['screen']}: {entry['reason']}" for entry in item["hesitations"]
                ),
                "",
                "**Elementos não encontrados**",
                "",
                md_list(item["elements_not_found"]),
                "",
                "**Erros de interpretação, campos confusos e erros de ação**",
                "",
                md_list(
                    unique(
                        item["interpretation_errors"]
                        + item["confusing_fields"]
                        + item["action_errors"]
                    )
                ),
                "",
                "**Informação excessiva ou faltante**",
                "",
                md_list(unique(item["excess_information"] + item["missing_information"])),
                "",
                f"**Telas visitadas:** {', '.join(item['screens_visited']) or 'Nenhuma.'}",
                "",
                f"**Screenshots:** {', '.join(f'`{path}`' for path in item['screenshots']) or 'Nenhum.'}",
                "",
            ]
        )
    return "\n".join(lines)


def run_dry_run_checks() -> dict[str, Any]:
    expected_negotiation = {
        "agreement_case_found",
        "agreement_process_opened",
        "agreement_recommendation_confirmed",
        "agreement_recommendation_followed",
        "agreement_decision_submitted",
        "agreement_decision_confirmed",
        "negotiation_form_opened",
        "proposal_value_filled",
        "negotiation_result_selected",
        "proposal_and_result_submitted",
        "proposal_confirmation_seen",
        "negotiation_result_confirmation_seen",
    }
    probes = {
        "0.9": normalize_score(0.9),
        "0.95": normalize_score(0.95),
        "90%": normalize_score("90%"),
        "95_on_0_100": normalize_score(95, "0-100"),
    }
    if probes != {"0.9": 9.0, "0.95": 9.5, "90%": 9.0, "95_on_0_100": 9.5}:
        raise RuntimeError(f"preflight de normalização falhou: {probes}")
    if len(TASKS) != 6 or any(not task.required_milestones for task in TASKS):
        raise RuntimeError("contratos das seis tarefas estão incompletos")
    if not expected_negotiation.issubset(set(TASK_BY_ID["test-6-negociacao"].required_milestones)):
        raise RuntimeError("contrato de negociação está incompleto")
    for task in TASKS:
        unknown = set(task.required_milestones) - set(MILESTONE_DESCRIPTIONS)
        if unknown:
            raise RuntimeError(f"marcos desconhecidos em {task.id}: {unknown}")
        classified = set(task.observable_milestones) | set(task.executable_milestones)
        unclassified = set(task.required_milestones) - classified
        if unclassified:
            raise RuntimeError(f"marcos sem fonte de comprovação em {task.id}: {unclassified}")
        missing_action_contract = set(task.executable_milestones) - set(EXECUTABLE_ACTION_TYPES)
        if missing_action_contract:
            raise RuntimeError(
                f"marcos executáveis sem tipo de ação em {task.id}: {missing_action_contract}"
            )
        turn_schema_for_task(task)
    return {
        "status": "passed",
        "task_contracts": len(TASKS),
        "score_normalization_probes": probes,
        "negotiation_contract_milestones": len(expected_negotiation),
        "isolated_browser_context_per_task": True,
        "screen_only_context": "screenshot + tarefa + histórico de ações; sem URL, DOM, código ou README",
    }


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("deve ser pelo menos 1")
    return parsed


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Executa o agente visual de teste de usabilidade.")
    parser.add_argument("--base-url", default=os.getenv("USABILITY_BASE_URL", DEFAULT_BASE_URL))
    parser.add_argument("--model", default=os.getenv("OPENAI_MODEL", DEFAULT_MODEL))
    parser.add_argument("--max-actions", type=positive_int, default=18)
    parser.add_argument("--tests", nargs="*", help="IDs dos testes; por padrão executa os seis.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Valida contratos, navegador, frontend, isolamento, screenshots e relatórios sem usar a OpenAI.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    base_url = args.base_url.rstrip("/")
    selected = [task for task in TASKS if not args.tests or task.id in args.tests]
    unknown_ids = sorted(set(args.tests or []) - set(TASK_BY_ID))
    if unknown_ids:
        print(f"IDs de teste desconhecidos: {', '.join(unknown_ids)}", file=sys.stderr)
        return 2
    if not selected:
        print("Nenhum teste selecionado.", file=sys.stderr)
        return 2
    if sync_playwright is None:
        print("Dependência ausente: instale requirements.txt e execute playwright install chromium.", file=sys.stderr)
        return 2
    if not args.dry_run and (OpenAI is None or not os.getenv("OPENAI_API_KEY")):
        print("Defina OPENAI_API_KEY ou use --dry-run.", file=sys.stderr)
        return 2

    try:
        dry_run_checks = run_dry_run_checks()
    except Exception as exc:
        print(f"Preflight falhou: {exc}", file=sys.stderr)
        return 2

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    system_prompt = PROMPT_PATH.read_text(encoding="utf-8")
    client = None if args.dry_run else OpenAI()
    started_at = datetime.now(timezone.utc).isoformat()
    results: list[TestResult] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for task in selected:
                print(f"Executando {task.name}...")
                # Fresh storage/cookies for every task prevent cross-test state contamination.
                context = browser.new_context(viewport={"width": 1440, "height": 900}, locale="pt-BR")
                page = context.new_page()
                try:
                    results.append(
                        run_one(
                            page,
                            client,
                            args.model,
                            system_prompt,
                            task,
                            base_url,
                            args.max_actions,
                            args.dry_run,
                        )
                    )
                finally:
                    context.close()
        finally:
            browser.close()

    report = build_report(
        results,
        started_at,
        args.model,
        base_url,
        args.dry_run,
        dry_run_checks=dry_run_checks,
    )
    (REPORTS_DIR / "UX_REPORT.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8"
    )
    (REPORTS_DIR / "UX_REPORT.md").write_text(markdown_report(report), encoding="utf-8")
    print(f"Relatórios gerados em {REPORTS_DIR}")
    if args.dry_run:
        return 0 if not any(result.infrastructure_errors for result in results) else 1
    return 0 if all(result.task_success for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
