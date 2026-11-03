import unittest

from jh import discovery


class DiscoverySettingsTests(unittest.TestCase):
    def test_invalid_choices_are_removed_and_numbers_are_sanitized(self):
        result = discovery.normalize({
            "regions": ["pakistan", "moon"],
            "domains": ["genai_llm", "fake"],
            "experience_max": "4",
            "salary_min": -100,
            "salary_currency": "USD",
        })
        self.assertEqual(result["regions"], ["pakistan"])
        self.assertEqual(result["domains"], ["genai_llm"])
        self.assertEqual(result["experience_max"], 4)
        self.assertEqual(result["salary_min"], 0)
        self.assertEqual(result["salary_currency"], "usd")

    def test_options_expose_every_scraper_platform(self):
        option_ids = {x["id"] for x in discovery.options()["platforms"]}
        self.assertEqual(option_ids, {x[0] for x in discovery.PLATFORMS})


if __name__ == "__main__":
    unittest.main()
