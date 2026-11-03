import unittest
from unittest.mock import patch

from jh import ats, tailor


class RuleBasedTailorTests(unittest.TestCase):
    def test_verified_jd_skills_are_added_to_skills_and_summary(self):
        base = {
            "headline": "AI Engineer | ML Engineer",
            "sections": [
                {"heading": "SUMMARY", "blocks": [{"t": "para", "proto": 1, "text": "AI Engineer with production experience."}]},
                {"heading": "TECHNICAL SKILLS", "blocks": [{"t": "bullet", "proto": 2, "text": "**Languages:** Python."}]},
            ],
        }
        job = {"title": "Machine Learning Engineer", "description": "Build Python services with FastAPI and AWS."}
        truth = "Python FastAPI AWS machine learning"
        truth_skills = ats.jd_skills(truth)
        with patch("jh.tailor.profile.truth_text", return_value=truth):
            content, meta = tailor.rule_based(base, job, truth_skills)
        skill_text = " ".join(b.get("text", "") for b in content["sections"][1]["blocks"])
        summary = content["sections"][0]["blocks"][0]["text"]
        self.assertIn("Key Skills for Machine Learning Engineer", skill_text)
        self.assertIn("JD-matched strengths", summary)
        self.assertIn("skills section and summary", meta["notes"])


if __name__ == "__main__":
    unittest.main()
