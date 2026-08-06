---
name: ARCC deployment split
description: The production deployment boundary between the dashboard/API and live Telegram worker.
---

The dashboard/API and the Telegram listener are separate runtime services. Telegram and Gemini credentials are intentionally configured through the authenticated dashboard, encrypted in PostgreSQL, and loaded by the worker; they should not be required as source-controlled environment variables.

**Why:** The operator explicitly wants personal provider credentials entered in the dashboard, while Render needs a web service that actually serves the dashboard and a separate long-running worker for Telegram monitoring.

**How to apply:** Keep the Render web service on the Node Dockerfile and the worker on `Dockerfile.worker`. Preserve dashboard-only credential storage and do not add provider integrations or hard-coded keys unless the operator changes this decision.