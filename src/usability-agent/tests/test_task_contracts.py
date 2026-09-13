import unittest

from run_test import ActionRecord, TASKS, TASK_BY_ID, TestResult, finalize_result


def result_for(task_id, *, missing=(), done=True, dry_run=False):
    task = TASK_BY_ID[task_id]
    completed = [item for item in task.required_milestones if item not in set(missing)]
    result = TestResult(
        id=task.id,
        name=task.name,
        task=task.instruction,
        done_requested=done,
        completed_milestones=completed,
    )
    return finalize_result(result, task, dry_run=dry_run)


class TaskContractTests(unittest.TestCase):
    def test_all_six_contracts_require_every_milestone(self):
        self.assertEqual(len(TASKS), 6)
        for task in TASKS:
            with self.subTest(task=task.id):
                complete = result_for(task.id)
                self.assertTrue(complete.task_success)
                self.assertEqual(complete.task_status, "success")
                for missing in task.required_milestones:
                    incomplete = result_for(task.id, missing=(missing,))
                    self.assertFalse(incomplete.task_success)
                    self.assertEqual(incomplete.task_status, "failure")

    def test_success_requires_done_after_main_action(self):
        task = TASK_BY_ID["test-4-seguir-recomendacao"]
        result = TestResult(
            id=task.id,
            name=task.name,
            task=task.instruction,
            completed_milestones=list(task.required_milestones),
            done_requested=False,
        )
        finalized = finalize_result(result, task)
        self.assertFalse(finalized.task_success)
        self.assertEqual(finalized.task_status, "incomplete")

    def test_clicking_follow_without_submit_and_confirmation_fails(self):
        result = result_for(
            "test-4-seguir-recomendacao",
            missing=("decision_submitted", "decision_confirmation_seen"),
        )
        self.assertFalse(result.task_success)
        self.assertIn("decision_submitted", result.missing_milestones)
        self.assertIn("decision_confirmation_seen", result.missing_milestones)

    def test_divergence_requires_different_choice_justification_submit_and_confirmation(self):
        required = {
            "different_decision_confirmed",
            "divergence_reason_selected",
            "divergence_justification_filled",
            "divergence_submitted",
            "divergence_confirmation_seen",
        }
        task = TASK_BY_ID["test-5-divergir"]
        self.assertTrue(required.issubset(task.required_milestones))
        for missing in required:
            with self.subTest(missing=missing):
                self.assertFalse(result_for(task.id, missing=(missing,)).task_success)

    def test_negotiation_cannot_succeed_on_defense_or_review(self):
        result = result_for(
            "test-6-negociacao",
            missing=(
                "agreement_case_found",
                "agreement_process_opened",
                "agreement_recommendation_confirmed",
            ),
        )
        self.assertFalse(result.task_success)

    def test_negotiation_requires_follow_proposal_result_and_confirmations(self):
        required = {
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
        task = TASK_BY_ID["test-6-negociacao"]
        self.assertTrue(required.issubset(task.required_milestones))
        for missing in required:
            with self.subTest(missing=missing):
                self.assertFalse(result_for(task.id, missing=(missing,)).task_success)

    def test_telemetry_counts_actions_scrolls_waits_errors_and_hesitations(self):
        task = TASK_BY_ID["test-2-entender-recomendacao"]
        result = TestResult(
            id=task.id,
            name=task.name,
            task=task.instruction,
            actions=[
                ActionRecord(index=1, action="click", target="Entrar", success=True),
                ActionRecord(index=2, action="scroll", target="", success=True, scroll_delta=720),
                ActionRecord(index=3, action="fill", target="Busca", value="caso", success=False, error="não encontrado"),
                ActionRecord(index=4, action="wait", target="", value="500", success=True),
            ],
            hesitations=[{"screen": "Fila", "reason": "Não achei o caso", "next_action": "Procurar"}],
            elements_not_found=["Busca", "Busca"],
        )
        finalized = finalize_result(result, task)
        self.assertEqual(finalized.action_count, 4)
        self.assertEqual(finalized.necessary_action_count, 2)
        self.assertEqual(finalized.scroll_count, 1)
        self.assertEqual(finalized.wait_count, 1)
        self.assertEqual(finalized.failed_action_count, 1)
        self.assertEqual(finalized.hesitation_count, 1)
        self.assertEqual(finalized.elements_not_found, ["Busca"])

    def test_dry_run_is_not_reported_as_failed_evaluation(self):
        result = result_for("test-1-compreensao-imediata", missing=TASK_BY_ID["test-1-compreensao-imediata"].required_milestones, dry_run=True)
        self.assertEqual(result.task_status, "not_evaluated")
        self.assertFalse(result.task_success)

    def test_dry_run_preserves_infrastructure_failure(self):
        task = TASK_BY_ID["test-1-compreensao-imediata"]
        raw = TestResult(
            id=task.id,
            name=task.name,
            task=task.instruction,
            infrastructure_errors=["frontend indisponível"],
        )
        result = finalize_result(raw, task, dry_run=True)
        self.assertEqual(result.task_status, "infrastructure_error")


if __name__ == "__main__":
    unittest.main()
