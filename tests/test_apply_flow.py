import json
import os
import tempfile
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
            with patch.object(applier.threading, "Thread"):
                self.assertTrue(applier.send({"cmd": "stop"}))
        finally:
            applier.STATE["session"] = old
        self.assertEqual(session["status"], "stopping")
        self.assertEqual(session["events"][-1]["type"], "stop_requested")
        self.assertEqual(json.loads(written[-1])["cmd"], "stop")

    def test_skip_is_immediate_and_advances_queue_after_finalization(self):
        written = []
        fake_stdin = type("FakeStdin", (), {"write": lambda _, value: written.append(value), "flush": lambda _: None})()
        fake_proc = type("FakeProc", (), {"stdin": fake_stdin, "poll": lambda _: None})()
        old_session = applier.STATE["session"]
        old_queue = list(applier.STATE["queue"])
        old_history = list(applier.STATE["history"])
        session = {"id": "s-skip", "job": {"id": 1}, "status": "needs_input", "need": {"reason": "review"},
                   "events": [], "alive": True, "proc": fake_proc, "started": "now"}
        applier.STATE["session"] = session
        try:
            with patch.object(applier.threading, "Thread"):
                self.assertTrue(applier.send({"cmd": "skip"}))
            self.assertEqual(session["status"], "skipping")
            self.assertEqual(session["events"][-1]["type"], "skip_requested")
            self.assertEqual(json.loads(written[-1])["cmd"], "skip")
            session.update(status="skipped", alive=False, finished="now")
            applier.STATE["queue"] = [2]
            with patch.object(applier, "close_current") as close, patch.object(applier, "start_next") as next_job:
                applier._after_finish(session)
                close.assert_called_once_with(session)
                next_job.assert_called_once_with()
        finally:
            applier.STATE["session"] = old_session
            applier.STATE["queue"] = old_queue
            applier.STATE["history"] = old_history

    def test_worker_exit_finalizes_interrupted_skip(self):
        proc = type("FinishedProc", (), {"stdout": [], "wait": lambda _: 0})()
        session = {"id": "s-reader", "job": {"id": 1}, "status": "skipping", "events": [], "alive": True}
        with patch.object(applier, "_finish") as finish:
            applier._reader(session, proc)
        self.assertFalse(session["alive"])
        self.assertEqual(session["status"], "skipped")
        finish.assert_called_once_with(session)

    def test_queue_is_persisted_for_restart(self):
        old_queue = list(applier.STATE["queue"])
        old_path = applier.QUEUE_PATH
        try:
            with tempfile.TemporaryDirectory() as folder:
                applier.QUEUE_PATH = os.path.join(folder, "queue.json")
                applier.STATE["queue"] = [7, 8, 9]
                applier._save_queue()
                self.assertEqual(applier._load_queue(), [7, 8, 9])
        finally:
            applier.QUEUE_PATH = old_path
            applier.STATE["queue"] = old_queue

    def test_detected_submission_marks_job_applied(self):
        session = {"job": {"id": 321}, "status": "running", "events": [], "need": None}
        with patch.object(applier.db, "exe") as execute:
            applier._event(session, {"type": "done", "via": "manual submit button", "t": 1})
        self.assertEqual(session["status"], "done")
        self.assertTrue(any("status='applied'" in call.args[0] and call.args[1][-1] == 321 for call in execute.call_args_list))
        self.assertTrue(any(call.args[0].startswith("INSERT INTO events") and "manual submit button" in call.args[1][-1] for call in execute.call_args_list))

    def test_already_applied_indicator_marks_job_and_records_source(self):
        session = {"job": {"id": 654}, "status": "running", "events": [], "need": None}
        event = {"type": "done", "via": "already applied indicator", "button": "Applied", "alreadyApplied": True, "t": 1}
        with patch.object(applier.db, "exe") as execute:
            applier._event(session, event)
        self.assertEqual(session["status"], "done")
        self.assertTrue(any("status='applied'" in call.args[0] and call.args[1][-1] == 654 for call in execute.call_args_list))
        self.assertTrue(any(call.args[0].startswith("INSERT INTO events") and "already applied indicator" in call.args[1][-1] for call in execute.call_args_list))


if __name__ == "__main__":
    unittest.main()
