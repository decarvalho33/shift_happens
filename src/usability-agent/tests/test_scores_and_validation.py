import math
import unittest

from run_test import (
    ModelResponseValidationError,
    TASK_BY_ID,
    TestResult,
    clean_json,
    normalize_score,
    validate_action_prerequisites,
    validate_observation_prerequisites,
    validate_model_turn,
)


def final_evaluation(**overrides):
    value = {
        "interpretation_errors": [],
        "confusing_fields": [],
        "hard_to_find_buttons": [],
        "missing_information": [],
        "summary": "Avaliação concluída.",
        "score_scale": "0-10",
        "clarity_score": 8,
        "ease_score": 7,
        "confidence_score": 9,
        "recommendations": [
            {
                "severity": "médio",
                "title": "Clarificar o próximo passo",
                "description": "Destacar a ação esperada na tela.",
                "evidence": "Houve dúvida sobre a próxima ação.",
            }
        ],
    }
    value.update(overrides)
    return value


def valid_turn(task_id="test-1-compreensao-imediata", *, action_type="done", milestone="none"):
    task = TASK_BY_ID[task_id]
    return {
        "screen_name": "Tela do processo",
        "understanding": "Entendi a recomendação e o risco.",
        "next_action": "Concluir a tarefa.",
        "confusing": [],
        "important": ["Recomendação"],
        "excess_information": [],
        "hesitation": {"occurred": False, "reason": ""},
        "elements_not_found": [],
        "observed_milestones": [],
        "action": {
            "type": action_type,
            "target": "" if action_type == "done" else "Controle visível",
            "near_text": "José Carlos Oliveira" if milestone == "agreement_process_opened" else "",
            "value": "",
            "direction": "",
            "milestone": milestone,
            "reason": "A tela permite concluir." if action_type == "done" else "Próxima ação visível.",
        },
        "final_evaluation": final_evaluation() if action_type == "done" else None,
    }


class ScoreNormalizationTests(unittest.TestCase):
    def test_normalizes_fractions_percentages_and_common_scales(self):
        cases = [
            (0.9, None, 9.0),
            (0.95, None, 9.5),
            ("90%", None, 9.0),
            (90, None, 9.0),
            (9, None, 9.0),
            (0, None, 0.0),
            (10, None, 10.0),
            (0.95, "0-1", 9.5),
            (95, "0-100", 9.5),
            (0.95, "0-10", 9.5),
        ]
        for raw, scale, expected in cases:
            with self.subTest(raw=raw, scale=scale):
                self.assertEqual(normalize_score(raw, scale), expected)

    def test_rejects_invalid_scores(self):
        invalid = [None, True, False, float("nan"), float("inf"), -1, 101, "abc"]
        for value in invalid:
            with self.subTest(value=value):
                with self.assertRaises(ModelResponseValidationError):
                    normalize_score(value)

    def test_declared_scale_is_validated(self):
        with self.assertRaises(ModelResponseValidationError):
            normalize_score(2, "0-1")
        with self.assertRaises(ModelResponseValidationError):
            normalize_score(101, "0-100")
        with self.assertRaises(ModelResponseValidationError):
            normalize_score(8, "desconhecida")


class ModelResponseValidationTests(unittest.TestCase):
    def test_done_requires_complete_final_evaluation(self):
        turn = valid_turn()
        del turn["final_evaluation"]["confidence_score"]
        with self.assertRaises(ModelResponseValidationError):
            validate_model_turn(turn, TASK_BY_ID["test-1-compreensao-imediata"])

    def test_done_requires_at_least_one_actionable_recommendation(self):
        turn = valid_turn()
        turn["final_evaluation"]["recommendations"] = []
        with self.assertRaises(ModelResponseValidationError):
            validate_model_turn(turn, TASK_BY_ID["test-1-compreensao-imediata"])

    def test_fractional_scores_are_normalized_and_warned(self):
        turn = valid_turn()
        turn["final_evaluation"].update(
            clarity_score=0.9,
            ease_score=0.95,
            confidence_score=0.8,
            score_scale="0-10",
        )
        validated = validate_model_turn(turn, TASK_BY_ID["test-1-compreensao-imediata"])
        self.assertEqual(
            validated["_normalized_scores"],
            {"clarity_score": 9.0, "ease_score": 9.5, "confidence_score": 8.0},
        )
        self.assertEqual(len(validated["_score_warnings"]), 3)

    def test_small_percentage_score_stays_small_after_ingestion(self):
        turn = valid_turn()
        turn["final_evaluation"].update(
            clarity_score=5,
            ease_score=7,
            confidence_score=9,
            score_scale="0-100",
        )
        validated = validate_model_turn(turn, TASK_BY_ID["test-1-compreensao-imediata"])
        self.assertEqual(
            validated["_normalized_scores"],
            {"clarity_score": 0.5, "ease_score": 0.7, "confidence_score": 0.9},
        )

    def test_intermediate_action_cannot_include_final_scores(self):
        turn = valid_turn(action_type="click", milestone="opened_process")
        turn["final_evaluation"] = final_evaluation()
        with self.assertRaises(ModelResponseValidationError):
            validate_model_turn(turn, TASK_BY_ID["test-1-compreensao-imediata"])

    def test_fill_requires_target_and_value(self):
        turn = valid_turn("test-5-divergir", action_type="fill", milestone="divergence_justification_filled")
        turn["action"]["value"] = ""
        with self.assertRaises(ModelResponseValidationError):
            validate_model_turn(turn, TASK_BY_ID["test-5-divergir"])

    def test_scroll_requires_direction_and_cannot_claim_milestone(self):
        turn = valid_turn(action_type="scroll")
        with self.assertRaises(ModelResponseValidationError):
            validate_model_turn(turn, TASK_BY_ID["test-1-compreensao-imediata"])
        turn["action"]["direction"] = "down"
        turn["action"]["milestone"] = "opened_process"
        with self.assertRaises(ModelResponseValidationError):
            validate_model_turn(turn, TASK_BY_ID["test-1-compreensao-imediata"])

    def test_observation_cannot_fake_executed_action(self):
        turn = valid_turn("test-4-seguir-recomendacao")
        turn["observed_milestones"] = [
            {"id": "decision_submitted", "evidence": "Acho que foi enviado."}
        ]
        with self.assertRaises(ModelResponseValidationError):
            validate_model_turn(turn, TASK_BY_ID["test-4-seguir-recomendacao"])

    def test_observation_requires_the_prior_screen_changing_action(self):
        task = TASK_BY_ID["test-1-compreensao-imediata"]
        turn = valid_turn()
        turn["observed_milestones"] = [
            {"id": "recommendation_identified", "evidence": "DEFESA visível."}
        ]
        validated = validate_model_turn(turn, task)
        result = TestResult(id=task.id, name=task.name, task=task.instruction)
        with self.assertRaises(ModelResponseValidationError):
            validate_observation_prerequisites(validated, result)
        result.completed_milestones.append("opened_process")
        validate_observation_prerequisites(validated, result)

    def test_confirmation_requires_submission_on_previous_turn(self):
        task = TASK_BY_ID["test-6-negociacao"]
        turn = valid_turn(task.id)
        turn["observed_milestones"] = [
            {"id": "proposal_confirmation_seen", "evidence": "Proposta registrada."}
        ]
        validated = validate_model_turn(turn, task)
        result = TestResult(id=task.id, name=task.name, task=task.instruction)
        with self.assertRaises(ModelResponseValidationError):
            validate_observation_prerequisites(validated, result)
        result.completed_milestones.append("proposal_and_result_submitted")
        validate_observation_prerequisites(validated, result)

    def test_executable_milestones_must_follow_task_sequence(self):
        task = TASK_BY_ID["test-6-negociacao"]
        turn = valid_turn(task.id, action_type="click", milestone="agreement_decision_submitted")
        validated = validate_model_turn(turn, task)
        result = TestResult(id=task.id, name=task.name, task=task.instruction)
        with self.assertRaises(ModelResponseValidationError):
            validate_action_prerequisites(validated, result)
        result.completed_milestones.append("agreement_recommendation_followed")
        validate_action_prerequisites(validated, result)

    def test_action_can_use_observation_from_same_screenshot_as_prerequisite(self):
        task = TASK_BY_ID["test-6-negociacao"]
        turn = valid_turn(task.id, action_type="click", milestone="agreement_process_opened")
        turn["observed_milestones"] = [
            {"id": "agreement_case_found", "evidence": "Caso com ACORDO na fila."}
        ]
        validated = validate_model_turn(turn, task)
        result = TestResult(id=task.id, name=task.name, task=task.instruction)
        validate_action_prerequisites(validated, result)

    def test_negotiation_result_must_not_remain_pending(self):
        task = TASK_BY_ID["test-6-negociacao"]
        turn = valid_turn(task.id, action_type="select", milestone="negotiation_result_selected")
        turn["action"]["target"] = "Resultado da negociação"
        turn["action"]["value"] = "Pendente — aguardando resposta"
        with self.assertRaises(ModelResponseValidationError):
            validate_model_turn(turn, task)

    def test_force_done_blocks_extra_action(self):
        turn = valid_turn(action_type="click", milestone="opened_process")
        with self.assertRaises(ModelResponseValidationError):
            validate_model_turn(
                turn,
                TASK_BY_ID["test-1-compreensao-imediata"],
                force_done=True,
            )

    def test_clean_json_rejects_non_finite_constants(self):
        for constant in ("NaN", "Infinity", "-Infinity"):
            with self.subTest(constant=constant):
                with self.assertRaises(ModelResponseValidationError):
                    clean_json('{"score": ' + constant + "}")

    def test_boolean_score_is_rejected(self):
        turn = valid_turn()
        turn["final_evaluation"]["clarity_score"] = True
        with self.assertRaises(ModelResponseValidationError):
            validate_model_turn(turn, TASK_BY_ID["test-1-compreensao-imediata"])


if __name__ == "__main__":
    unittest.main()
