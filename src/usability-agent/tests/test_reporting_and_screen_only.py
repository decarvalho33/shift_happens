import json
import tempfile
import unittest
from pathlib import Path

from run_test import (
    TASK_BY_ID,
    TestResult,
    aggregate_recommendations,
    ask_model,
    build_report,
    finalize_result,
    markdown_report,
    model_context,
)


def evaluated_result(task_id, *, success=True, scores=(8, 8, 8), valid=True):
    task = TASK_BY_ID[task_id]
    completed = list(task.required_milestones) if success else list(task.required_milestones[:-1])
    result = TestResult(
        id=task.id,
        name=task.name,
        task=task.instruction,
        done_requested=True,
        completed_milestones=completed,
        clarity_score=scores[0],
        ease_score=scores[1],
        confidence_score=scores[2],
        ux_scores_valid=valid,
        summary="Resumo válido.",
    )
    return finalize_result(result, task)


class ReportingTests(unittest.TestCase):
    def test_averages_normalized_scores_and_excludes_invalid(self):
        first = evaluated_result("test-1-compreensao-imediata", scores=(9, 9.5, 8))
        second = evaluated_result("test-2-entender-recomendacao", scores=(8, 8, 8))
        invalid = evaluated_result(
            "test-3-rastreabilidade",
            scores=(float("nan"), float("nan"), float("nan")),
            valid=True,
        )
        report = build_report([first, second, invalid], "now", "model", "base", False)
        quality = report["summary"]["ux_quality"]
        self.assertEqual(quality["clarity_score"], 8.5)
        self.assertEqual(quality["ease_score"], 8.8)
        self.assertEqual(quality["confidence_score"], 8.0)
        self.assertEqual(quality["score_sample_sizes"]["clarity"], 2)
        self.assertEqual(quality["valid_evaluations"], 2)
        serialized = json.dumps(report, allow_nan=False)
        self.assertIn('"clarity_score": null', serialized)

    def test_already_normalized_low_score_is_not_normalized_twice(self):
        result = evaluated_result("test-1-compreensao-imediata", scores=(0.5, 0.7, 0.9))
        report = build_report([result], "now", "model", "base", False)
        quality = report["summary"]["ux_quality"]
        self.assertEqual(quality["clarity_score"], 0.5)
        self.assertEqual(quality["ease_score"], 0.7)
        self.assertEqual(quality["confidence_score"], 0.9)

    def test_task_success_and_ux_quality_are_independent(self):
        failed_good_ux = evaluated_result(
            "test-4-seguir-recomendacao", success=False, scores=(8, 8, 8)
        )
        success_bad_ux = evaluated_result(
            "test-5-divergir", success=True, scores=(2, 2, 2)
        )
        failed_report = build_report([failed_good_ux], "now", "model", "base", False)
        success_report = build_report([success_bad_ux], "now", "model", "base", False)
        self.assertEqual(failed_report["summary"]["task_outcomes"]["success_rate"], 0.0)
        self.assertEqual(failed_report["summary"]["ux_quality"]["clarity_score"], 8.0)
        self.assertEqual(success_report["summary"]["task_outcomes"]["success_rate"], 1.0)
        self.assertEqual(success_report["summary"]["ux_quality"]["clarity_score"], 2.0)

    def test_dry_run_has_no_fake_zero_success_rate_or_scores(self):
        task = TASK_BY_ID["test-1-compreensao-imediata"]
        result = finalize_result(TestResult(id=task.id, name=task.name, task=task.instruction), task, dry_run=True)
        report = build_report([result], "now", "model", "base", True)
        self.assertIsNone(report["summary"]["task_outcomes"]["success_rate"])
        self.assertIsNone(report["summary"]["interaction_metrics"]["average_actions"])
        self.assertIsNone(report["summary"]["ux_quality"]["clarity_score"])

    def test_recommendations_are_deduplicated_and_sorted_by_severity(self):
        first = evaluated_result("test-1-compreensao-imediata")
        second = evaluated_result("test-2-entender-recomendacao")
        first.recommendations = [
            {"severity": "médio", "title": "CTA confuso", "description": "Rever CTA", "evidence": "Hesitação"},
            {"severity": "baixo", "title": "Ruído", "description": "Reduzir texto", "evidence": "Texto longo"},
        ]
        second.recommendations = [
            {"severity": "crítico", "title": "CTA confuso", "description": "Desbloquear CTA", "evidence": "Bloqueou tarefa"},
            {"severity": "alto", "title": "Confirmação", "description": "Mostrar confirmação", "evidence": "Final incerto"},
        ]
        recommendations = aggregate_recommendations([first, second])
        self.assertEqual([item["severity"] for item in recommendations], ["crítico", "alto", "baixo"])
        self.assertEqual(recommendations[0]["occurrences"], 2)
        self.assertEqual(len(recommendations[0]["affected_tests"]), 2)

    def test_markdown_and_json_include_outcome_quality_and_priority(self):
        result = evaluated_result("test-1-compreensao-imediata")
        result.recommendations = [
            {"severity": "alto", "title": "Ação principal", "description": "Destacar", "evidence": "Difícil"}
        ]
        report = build_report([result], "now", "model", "base", False)
        rendered = markdown_report(report)
        self.assertIn("sucesso da tarefa e a qualidade percebida", rendered.lower())
        self.assertIn("[ALTO]", rendered)
        self.assertTrue(json.loads(json.dumps(report))["tests"][0]["task_success"])


class FakeResponse:
    output_text = "{}"


class FakeResponses:
    def __init__(self):
        self.kwargs = None

    def create(self, **kwargs):
        self.kwargs = kwargs
        return FakeResponse()


class FakeClient:
    def __init__(self):
        self.responses = FakeResponses()


class ScreenOnlyTests(unittest.TestCase):
    def test_context_does_not_expose_url_route_or_page_text(self):
        task = TASK_BY_ID["test-2-entender-recomendacao"]
        result = TestResult(id=task.id, name=task.name, task=task.instruction)
        context = model_context(task, result, 5)
        self.assertNotIn("http://127.0.0.1", context)
        self.assertNotIn("/processos/", context)
        self.assertNotIn("texto atualmente visível", context.lower())

    def test_api_request_contains_task_history_and_image_without_browser_metadata(self):
        task = TASK_BY_ID["test-1-compreensao-imediata"]
        result = TestResult(id=task.id, name=task.name, task=task.instruction)
        client = FakeClient()
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "screen.png"
            image.write_bytes(b"fake-png")
            ask_model(client, "model", "system", task, result, image, 3)
        request = client.responses.kwargs
        user_content = request["input"][1]["content"]
        text = user_content[0]["text"]
        self.assertIn(task.instruction, text)
        self.assertNotIn("http://127.0.0.1", text)
        self.assertNotIn("/processos/", text)
        self.assertTrue(user_content[1]["image_url"].startswith("data:image/png;base64,"))


if __name__ == "__main__":
    unittest.main()
