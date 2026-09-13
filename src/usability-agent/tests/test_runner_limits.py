import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from run_test import (
    TASK_BY_ID,
    TestResult,
    build_report,
    request_validated_turn,
    run_one,
)


def final_block():
    return {
        "interpretation_errors": [],
        "confusing_fields": [],
        "hard_to_find_buttons": [],
        "missing_information": [],
        "summary": "Não consegui concluir dentro do limite.",
        "score_scale": "0-10",
        "clarity_score": 6,
        "ease_score": 5,
        "confidence_score": 4,
        "recommendations": [
            {
                "severity": "alto",
                "title": "Reduzir bloqueios",
                "description": "Tornar a conclusão alcançável dentro do limite.",
                "evidence": "O limite foi alcançado.",
            }
        ],
    }


def turn(action_type="done"):
    return {
        "screen_name": "Tela visível",
        "understanding": "Ainda estou avaliando a tela.",
        "next_action": "Aguardar" if action_type == "wait" else "Encerrar",
        "confusing": [],
        "important": [],
        "excess_information": [],
        "hesitation": {"occurred": False, "reason": ""},
        "elements_not_found": [],
        "observed_milestones": [],
        "action": {
            "type": action_type,
            "target": "",
            "near_text": "",
            "value": "100" if action_type == "wait" else "",
            "direction": "",
            "milestone": "none",
            "reason": "Aguardar atualização." if action_type == "wait" else "Limite alcançado.",
        },
        "final_evaluation": final_block() if action_type == "done" else None,
    }


class FakeResponse:
    def __init__(self, output):
        self.output_text = output


class LimitResponses:
    def __init__(self):
        self.calls = 0

    def create(self, **kwargs):
        self.calls += 1
        context = kwargs["input"][1]["content"][0]["text"]
        payload = turn("done" if "Ações restantes: 0." in context else "wait")
        return FakeResponse(json.dumps(payload, ensure_ascii=False))


class SequenceResponses:
    def __init__(self, outputs):
        self.outputs = list(outputs)

    def create(self, **kwargs):
        return FakeResponse(self.outputs.pop(0))


class FakeClient:
    def __init__(self, responses):
        self.responses = responses


class FakeMouse:
    def wheel(self, x, y):
        pass


class FakePage:
    def __init__(self):
        self.url = "http://127.0.0.1:5173/"
        self.mouse = FakeMouse()

    def goto(self, url, **kwargs):
        self.url = url

    def wait_for_timeout(self, milliseconds):
        pass

    def screenshot(self, path, **kwargs):
        Path(path).write_bytes(b"fake-png")


class RunnerLimitTests(unittest.TestCase):
    def test_runner_executes_exactly_max_actions_then_forces_final_evaluation(self):
        task = TASK_BY_ID["test-2-entender-recomendacao"]
        client = FakeClient(LimitResponses())
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            screenshots = root / "screenshots"
            with patch("run_test.ROOT", root), patch("run_test.SCREENSHOTS_DIR", screenshots):
                result = run_one(
                    FakePage(),
                    client,
                    "model",
                    "system",
                    task,
                    "http://127.0.0.1:5173",
                    max_actions=3,
                    dry_run=False,
                )
        self.assertEqual(result.action_count, 3)
        self.assertEqual(result.wait_count, 3)
        self.assertTrue(result.done_requested)
        self.assertEqual(client.responses.calls, 4)
        self.assertEqual(result.task_status, "failure")
        self.assertTrue(result.ux_scores_valid)

    def test_invalid_response_is_retried_before_use(self):
        task = TASK_BY_ID["test-2-entender-recomendacao"]
        responses = SequenceResponses(["{}", json.dumps(turn("done"), ensure_ascii=False)])
        client = FakeClient(responses)
        result = TestResult(id=task.id, name=task.name, task=task.instruction)
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "screen.png"
            image.write_bytes(b"fake-png")
            validated, errors = request_validated_turn(
                client,
                "model",
                "system",
                task,
                result,
                image,
                remaining_actions=0,
            )
        self.assertEqual(validated["action"]["type"], "done")
        self.assertEqual(len(errors), 1)

    def test_exhausted_retries_are_counted_in_reliability_metrics(self):
        task = TASK_BY_ID["test-2-entender-recomendacao"]
        client = FakeClient(SequenceResponses(["{}", "{}", "{}"]))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch("run_test.ROOT", root), patch("run_test.SCREENSHOTS_DIR", root / "screenshots"):
                result = run_one(
                    FakePage(),
                    client,
                    "model",
                    "system",
                    task,
                    "http://127.0.0.1:5173",
                    max_actions=1,
                    dry_run=False,
                )
        report = build_report([result], "now", "model", "base", False)
        self.assertEqual(len(result.model_validation_errors), 3)
        self.assertEqual(
            report["summary"]["evaluation_reliability"]["rejected_model_responses"],
            3,
        )


if __name__ == "__main__":
    unittest.main()
