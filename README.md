# JobHunter

JobHunter is a local-first Windows application for finding jobs, tailoring resumes, assisting with repetitive application fields, tracking submitted applications, and updating application stages from Gmail with deterministic keyword rules.

The apply assistant is intentionally supervised: it fills known fields and pauses for review, consent, unusual questions, and CAPTCHA challenges. It does not bypass CAPTCHAs or guarantee compatibility with every hiring platform.

## Features

- Aggregates and filters job listings in a local dashboard.
- Hides submitted jobs from the active job list and tracks them in the Applications panel.
- Opens the application flow in the same browser tab through the included extension.
- Recognizes common job-description-page actions such as **Apply**, **Apply now**, and **Apply for this job** before continuing to the form.
- Reuses a local profile and learned question/answer bank for repetitive fields.
- Creates a tailored DOCX and, when Word or LibreOffice is available, a PDF.
- Stops after a detected submission and records the application.
- Optionally reads Gmail using the `gmail.readonly` scope and applies rule-based statuses such as waiting, action required, interview, rejected, offer, and accepted.
- Makes no AI call for Gmail classification. Optional AI-assisted tailoring is separate.

## Privacy model

JobHunter runs on your computer. Runtime state is stored in `data/`, including your profile, application database, Gmail OAuth client and token, browser state, learned answers, generated resumes, and logs. The entire directory is ignored by Git.

Do not commit any file from `data/`, `.env`, generated resumes, OAuth client JSON, access/refresh tokens, cookies, or browser profiles. The resume templates in this repository contain fictional sample content and must be replaced with your own locally.

## Requirements

- Windows 10 or 11
- Python 3.11 or newer
- Node.js 18 or newer
- Google Chrome or Microsoft Edge
- Microsoft Word or LibreOffice for automatic PDF conversion (optional)

## Quick setup

1. Clone the repository and enter it:

   ```powershell
   git clone https://github.com/zakriacomputerengineer/jobhunter.git
   cd jobhunter
   ```

2. Run `setup.bat`. It creates `.venv`, installs Python packages, installs the scraper package, and offers to create a desktop shortcut.

3. Start JobHunter with `start.bat`, or use `start_console.bat` to keep diagnostic output visible.

4. Open the local address printed by the application (normally `http://127.0.0.1:8765`). Complete the Application Profile before using the apply assistant.

5. Replace `templates/auto.docx` and `templates/ml.docx` with your own resume designs. Keep at least two non-empty lines before the first dark-blue section heading so the template extractor can identify the name and headline. Use `scripts/build_sample_templates.py` to restore the fictional examples.

## Browser extension and same-tab apply flow

The extension connects the dashboard to the active Chrome/Edge tab. Without it, JobHunter deliberately refuses to open a separate automation browser.

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select the repository's `extension` directory.
4. Keep JobHunter running, refresh the dashboard, and retry **Apply for me**.

If the UI reports **Apply Helper is not connected**, confirm that the extension is enabled, the local JobHunter page is open, and both are using the same browser profile. Reload the extension and the dashboard after updating the source.

## Gmail status sync (no AI required)

Gmail integration is optional and read-only. Status classification uses regular expressions and company/title matching in `jh/gmail_sync.py`; it does not consume model tokens.

1. Create or select a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **Gmail API**.
3. Configure the OAuth consent screen. For a personal app in testing, add your Gmail address as a test user.
4. Create an OAuth 2.0 Client ID for a **Desktop app** and download its JSON file.
5. In JobHunter, open Gmail settings, upload that JSON, choose **Connect Gmail**, and approve read-only access.
6. Run a sync. JobHunter will also check periodically while it is running.

The OAuth client and tokens are saved only under `data/`. Google may expire refresh tokens for consent screens left in Testing mode; reconnect if that happens. Email matching is best-effort, so review inferred stages and correct ambiguous matches manually.

## Job discovery configuration

The current discovery rules are oriented toward Pakistan and remote software/AI roles. Edit `jh/domains.py` and the scraper settings to adapt location aliases, domains, and search terms for another market. Respect each source's robots rules, terms, and rate limits.

## Optional AI-assisted tailoring

The core tracker, apply-field reuse, and Gmail status sync work without an AI provider. If you enable an optional provider in the application, enter its key through the local settings UI. Keys must remain in ignored local storage; never place them in source files or commit them.

## Development

Create a virtual environment, install dependencies, and run the checks:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Push-Location scraper
npm ci
Pop-Location
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe -m compileall app.py jh
node --check scraper/apply.mjs
node --check scraper/run.mjs
```

Run the web app with:

```powershell
.\.venv\Scripts\python.exe app.py
```

## Troubleshooting

- **Apply Helper is not connected:** load and enable the unpacked extension in the browser profile you are currently using, then refresh both the extension and dashboard.
- **PDF was not created:** install Microsoft Word or LibreOffice, or use the generated DOCX.
- **Gmail reconnects repeatedly:** confirm the OAuth client is a Desktop client, your address is an allowed test user, and the Gmail API is enabled.
- **A legitimate page is marked as CAPTCHA:** collect the visible text and selector details without submitting secrets, then refine the evidence-based detection rules. JobHunter should pause when a real challenge is present.
- **An application is not matched to an email:** ensure company and title are accurate in Applications, then update the stage manually.

## Responsible use

Review every generated resume and application before submission. You are responsible for the accuracy of submitted information and for following the hiring platform's terms, applicable law, and employer instructions. Do not use the project to evade anti-bot controls, bypass CAPTCHAs, or submit misleading information.

## License

MIT. See [LICENSE](LICENSE).
