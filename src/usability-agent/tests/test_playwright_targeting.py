import unittest

from run_test import execute_action, sync_playwright


@unittest.skipIf(sync_playwright is None, "Playwright não instalado")
class PlaywrightTargetingTests(unittest.TestCase):
    def test_near_text_selects_the_correct_repeated_control(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page()
            try:
                page.set_content(
                    """
                    <table>
                      <tr><td>Maria Aparecida Santos</td><td>DEFESA</td>
                          <td><button onclick="window.chosen='defesa'">Analisar agora</button></td></tr>
                      <tr><td>José Carlos Oliveira</td><td>ACORDO</td>
                          <td><button onclick="window.chosen='acordo'">Analisar agora</button></td></tr>
                    </table>
                    """
                )
                record = execute_action(
                    page,
                    {
                        "type": "click",
                        "target": "Analisar agora",
                        "near_text": "José Carlos Oliveira",
                        "value": "",
                        "direction": "",
                        "milestone": "agreement_process_opened",
                        "reason": "Abrir o caso ACORDO desta linha.",
                    },
                    index=1,
                    screen_before="Minha fila",
                    allowed_origin="about://",
                )
                self.assertTrue(record.success, record.error)
                self.assertEqual(page.evaluate("() => window.chosen"), "acordo")
            finally:
                browser.close()


if __name__ == "__main__":
    unittest.main()
