import json
import unittest
from unittest.mock import patch

import app as application
from jh import apply as applier


class ApplyFlowTests(unittest.TestCase):
    def test_extension_manual_start_is_guarded_and_starts_known_job(self):
        client = application.app.test_client()
        self.assertEqual(client.post("/api/ext/manual-start", json={"url": "https://example.com/job"}).status_code, 403)
        self.assertEqual(client.post("/api/ext/manual-start", headers={"X-JH": "1"}, json={"url": "chrome://extensions"}).status_code, 400)
        row = {"id": 321, "title": "Sample Engineer", "company": "Example Co"}
        old = applier.STATE["session"]
        applier.STATE["session"] = None
        try:
            with patch.object(application, "_manual_job", return_value=row), patch.object(applier, "start", return_value={"ok": True, "session": "s-test"}):
                response = client.post("/api/ext/manual-start", headers={"X-JH": "1"}, json={"url": "https://example.com/job"})
        finally:
            applier.STATE["session"] = old
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json["ok"])
        self.assertEqual(response.json["job_id"], 321)

    def test_stop_is_acknowledged_before_worker_exits(self):
        written = []
        fake_stdin = type("FakeStdin", (), {"write": lambda _, value: written.append(value), "flush": lambda _: None})()
        fake_proc = type("FakeProc", (), {"stdin": fake_stdin, "poll": lambda _: None})()
        old = applier.STATE["session"]
        session = {"id": "s-test", "job": {"id": 1}, "status": "needs_input", "need": {"reason": "review"},
                   "events": [], "alive": True, "proc": fake_proc}
        applier.STATE["session"] = session
        try:
            self.assertTrue(applier.send({"cmd": "stop"}))
        finally:
            applier.STATE["session"] = old
        self.assertEqual(session["status"], "stopping")
        self.assertEqual(session["events"][-1]["type"], "stop_requested")
        self.assertEqual(json.loads(written[-1])["cmd"], "stop")

    def test_detected_submission_marks_job_applied(self):
        session = {"job": {"id": 321}, "status": "running", "events": [], "need": None}
        with patch.object(applier.db, "exe") as execute:
            applier._event(session, {"type": "done", "via": "manual submit button", "t": 1})
        self.assertEqual(session["status"], "done")
        self.assertTrue(any("status='applied'" in call.args[0] and call.args[1][-1] == 321 for call in execute.call_args_list))
        self.assertTrue(any(call.args[0].startswith("INSERT INTO events") and "manual submit button" in call.args[1][-1] for call in execute.call_args_list))


if __name__ == "__main__":
    unittest.main()
