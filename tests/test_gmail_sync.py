import unittest

from jh.gmail_sync import classify


class GmailClassificationTests(unittest.TestCase):
    def test_waiting_confirmation(self):
        self.assertEqual(classify("Application received", "Thank you for applying."), "waiting")

    def test_interview_invitation(self):
        self.assertEqual(classify("Interview invitation", "Please schedule your interview."), "interview")

    def test_rejection(self):
        self.assertEqual(classify("Your application", "We decided not to move forward."), "rejected")

    def test_offer(self):
        self.assertEqual(classify("Offer of employment", "We are delighted to offer you the role."), "offer")

    def test_irrelevant_email(self):
        self.assertIsNone(classify("Weekly newsletter", "Here are this week's articles."))


if __name__ == "__main__":
    unittest.main()
