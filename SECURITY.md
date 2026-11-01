# Security policy

## Reporting a vulnerability

Please open a GitHub security advisory for vulnerabilities. Do not include real resumes, OAuth files, cookies, access tokens, application records, or other personal data in public issues.

## Local secrets

JobHunter stores sensitive runtime files under `data/`, which is excluded from version control. Treat that directory as confidential. Revoke affected credentials immediately if it is copied to an untrusted location.

Use the minimum OAuth permissions required. The Gmail integration requests only `https://www.googleapis.com/auth/gmail.readonly` and does not send or modify mail.

## Automation boundary

The application assistant is designed for supervised form completion. CAPTCHA bypass, stealth/evasion behavior, and unattended bulk submission are outside the project's supported security boundary.
