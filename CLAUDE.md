# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Xome Campaign Platform — an AI-powered real estate campaign tool that generates personalized emails promoting recommended properties to high-intent buyers. Built with FastAPI backend, React + TailwindCSS frontend, LangGraph orchestration, deployed as a single-process Databricks App.

## Common Commands

```bash
# Local dev (runs backend on :8000 + frontend dev server on :3000 concurrently)
uv run start-app

# Build frontend for production
cd frontend && npm run build && cd ..

# Deploy (two-step: bundle then app)
databricks bundle deploy --target prod
databricks apps deploy xome-lakebase-campaign-genie --profile fevm --source-code-path /Workspace/Users/birbal.das@databricks.com/.bundle/xome_lakebase_campaign_genie/prod/files

# Run data pipeline (generate Delta tables)
databricks bundle run xome_setup_pipeline --target prod

# Run Lakebase migration (copy Delta → Lakebase)
databricks bundle run xome_migrate_to_lakebase --target prod

# Check app status / logs
databricks apps get xome-lakebase-campaign-genie --profile fevm
databricks apps logs xome-lakebase-campaign-genie --profile fevm
```

**Requirements:** Python 3.11+, `uv` for Python package management, Node.js/npm for frontend.

**No tests or linting** — There is no test suite, eslint, prettier, or ruff configured in this repo.

## Architecture

```
Browser → FastAPI (port 8000) → serves frontend/dist/ (static) + REST API (/api/campaign/*)
                                     │
                          ┌──────────┼──────────┐
                          ▼          ▼          ▼
                   LangGraph     Lakebase     Genie Spaces
                   StateGraph   (PostgreSQL)  (NL queries)
                      │
                      ▼
                  Claude LLM
```

**Single-process deployment:** FastAPI on port 8000 serves both the pre-built React frontend (from `frontend/dist/`) and all API endpoints. Databricks Apps only exposes port 8000.

**Dev mode:** `uv run start-app` launches backend (port 8000) and Vite dev server (port 3000) concurrently. Vite proxies `/api` requests to `localhost:8000` (configured in `vite.config.ts`).

**Two LangGraph paths (4 nodes total), routed by the `source` field in `CampaignState`:**

- **Dashboard** (`source=dashboard`): `route_entry → enrich_context → generate_email → END`. The frontend provides user profile and properties via the API request; `enrich_context` fetches browsing history from Lakebase; `generate_email` validates inputs, builds the prompt, and calls Claude.

- **Genie** (`source=genie`): `route_entry → query_genie → END`. Calls Genie Spaces API with natural language. Returns raw `columns` + `rows` directly to the frontend as a table.

## Key Paths

- Backend: `agent_server/`
- REST API router: `agent_server/campaign_api.py`
- Genie Spaces client: `agent_server/genie_client.py`
- LangGraph state: `agent_server/graph_state.py`
- LangGraph nodes: `agent_server/graph_nodes.py`
- LangGraph graph: `agent_server/graph.py`
- Email generation logic: `agent_server/email_generator.py`
- LLM setup: `agent_server/agent.py`
- Lakebase helper (psycopg2): `agent_server/tools.py`
- Config constants: `agent_server/config.py`
- Prompts: `agent_server/prompts.py`
- Refine email prompts: `agent_server/refine_email_prompts.py`
- Guardrail prompts: `agent_server/guardrail_prompts.py`
- Server entry point: `agent_server/start_server.py`
- Frontend (React): `frontend/`
- Frontend components: `frontend/src/components/`
- Dashboard API client: `frontend/src/api/campaign.ts`
- Data generation: `notebooks/01_generate_data.py`
- Lakebase migration: `notebooks/02_migrate_to_lakebase.py`
- Lakebase data exports (CSV): `data/` (users, properties, browsing_activity, recommendations, campaign_tracking, campaign_emails)
- Deployment: `databricks.yml`, `databricks-genie.yml`, `app.yaml`

## Key Patterns

**`source` field routing** — The `source` field in `CampaignState` (`"dashboard"` or `"genie"`) routes the graph via `_route_source` in `graph.py`. Dashboard uses the email generation pipeline; Genie uses the user discovery pipeline.

**`CampaignState`** — TypedDict in `graph_state.py` with field groups:
- *Input:* `user_id`, `city`, `state`, `source`, `properties_input` (dashboard), `user_profile` (dashboard), `genie_query`, `genie_conversation_id` (genie)
- *Intermediate:* `browsing_context`
- *Genie output:* `genie_raw_result` (`{columns, rows, description, sql}`), `genie_conversation_id_out`, `genie_message_id`
- *Output:* `generated_email` (`{subject, html, plain_text, raw}`), `error`

**`_SanitizedChatDatabricks`** — Subclass in `agent.py` that strips `id` keys from tool message content blocks before sending to the Foundation Model API. Some LLM endpoints reject the extra `id` field that LangChain adds to content blocks.

**Email parsing** — `email_generator.py` uses regex (not JSON) to extract `SUBJECT:`, `HTML:`, and `PLAIN TEXT:` sections from raw LLM output. The prompt instructs the LLM to output in this delimited format.

**Connection pooling** — `tools.py` uses a thread-safe singleton psycopg2 connection (`_lock` + `_conn`) with auto-reconnect: on `OperationalError` (token expiry or connection drop), it refreshes the Databricks-issued Lakebase token and retries once.

**MLflow tracing** — `start_server.py` calls `mlflow.langchain.autolog()` on experiment `/Shared/xome-lakebase-campaign-tracing`. All LangGraph invocations are traced automatically. Additionally, `@mlflow.trace` decorators on `enrich_context` (span_type=tool), `generate_email` (span_type=chain), and `query_genie_node` (span_type=tool) in `graph_nodes.py` capture per-node input/output as child spans within each trace.

**Startup table creation & migrations** — FastAPI lifespan hook in `start_server.py` auto-creates `campaign_tracking` and `campaign_emails` tables via `CREATE TABLE IF NOT EXISTS`, then runs incremental schema migrations (add columns, rename columns, drop columns) wrapped in individual try/except blocks so each migration is idempotent.

**Draft accumulation** — Each "Save Email" creates a new row in `campaign_emails` with `email_type='saved'`. Drafts are never overwritten; multiple drafts for the same user/properties can coexist. Users manually delete old drafts via the Delete button.

**Soft-delete + banner clearing** — Deleted saved emails set `saved_email_delete_date = NOW()` on the `campaign_emails` row and also DELETE the corresponding `campaign_tracking` rows (where `campaign_status = false`), so the "Email saved on" banner disappears from property cards. The `/past-emails` query filters out rows where `saved_email_delete_date IS NOT NULL`.

**Draft-to-sent tracking** — When a user sends a specific saved draft (selected via the dropdown), the backend sets `draft_sent_date = NOW()` on that draft row. The `/past-emails` query excludes saved emails where `draft_sent_date IS NOT NULL`, so sent drafts disappear from the dropdown.

**Optimistic UI updates** — After sending a selected draft or deleting a saved email, the frontend immediately removes it from the local `pastEmails` state before the background re-fetch completes, ensuring the dropdown updates instantly. Deleting also optimistically clears `campaign_saved_date` on selected properties so the banner disappears immediately.

**Timestamp overwrite on save** — Re-saving a draft always overwrites `campaign_saved_date` with the current full ISO timestamp (`new Date().toISOString()`), not a keep-first (`??`) pattern. The "Email saved on" banner displays the full timestamp (date + time) via `formatTimestamp()` in `frontend/src/lib/utils.ts`.

**Frontend state management** — React hooks only (useState, useCallback, useEffect). No Redux/Zustand. `AppShell.tsx` is the main orchestrator holding Genie results, filter state, and view state.

**Genie raw table rendering** — The `/api/campaign/genie-query` endpoint returns raw `columns` and `rows` from Genie. The frontend `GenieResultTable` component renders these as a generic table. If a `user_id` column exists, those cells are clickable links that navigate to the user detail view. If a `property_id` column exists, those cells are clickable links that open a `PropertyDetailModal` with full property details and image.

**Genie search bar query retention** — After a Genie query completes, the submitted query text is displayed as placeholder text in the search input (replacing the default placeholder), so the user can see what they last searched for.

**Multi-user detail view** — `GenieMultiUserDetail.tsx` renders multiple users in collapsible sections, each with their own profile, property grid, email generation, and save/send controls. All users' data loads in parallel.

**Refine with AI** — In the plain text editor, users can click "Refine with AI" to open a prompt bar. The prompt + current email text are sent to the LLM via `/refine-email`, which returns an updated subject and plain text. Previous email context is included for continuity.

**Guardrail validation** — Before sending an email, the "Validate & Send" flow calls `/api/campaign/validate-email`, which sends the subject + plain text to the LLM with a compliance prompt (`guardrail_prompts.py`). The LLM scores four categories (professional tone, toxicity, PII, bias) as JSON. The frontend `GuardrailValidation.tsx` renders a 2x2 card grid with severity scores. If all categories pass (severity ≤ 50) and aggregate score ≤ 50, a "Confirm & Send" button appears. Content changes after validation show a re-validate warning. Parse failures from the LLM return a failsafe response with `parse_error: true`.

**Auto-Fix with AI** — When guardrail validation fails, an "Auto-Fix with AI" button appears. It calls `/api/campaign/fix-email` with the current email and the failed categories (name, label, explanation, remediation). The backend feeds these into the refine prompt, and the LLM rewrites the email to address all flagged issues. The fixed email replaces the editor content for re-validation.

## Critical Rules

- Campaign email properties come ONLY from the `recommendations` table. Browsing data is for personalization context only.
- Frontend must be built (`cd frontend && npm run build`) before deploying — `frontend/dist/` is served as static files.
- `.gitignore` has `!frontend/dist/` exception to include the built frontend in bundle deploy.
- `.databricksignore` excludes `notebooks/`, `frontend/src/`, `node_modules/` etc. from the deploy bundle — only `frontend/dist/` and backend code are deployed.
- Only `plain_text` and `subject` are persisted to `campaign_emails`. HTML content is not stored in the database.
- Lakebase table ownership may differ from the app's service principal. Schema migrations that require owner privileges (e.g., `ALTER TABLE ADD COLUMN` on tables created by a different user) will fail silently. INSERT statements must only reference columns that exist in the original `CREATE TABLE` schema.

## Data Model

Six tables in Lakebase (PostgreSQL). First four seeded by notebooks, last two auto-created at startup:

- `users` (500 rows) — buyer profiles with preferences (city, state, budget, property type, segment)
- `properties` (1,000 rows) — listings with details (price, beds, baths, sqft, neighborhood, school rating, auction info)
- `browsing_activity` (10,000 rows) — user browsing events linked to properties
- `recommendations` (5,000 rows) — ML-scored property recommendations per user (`recommendation_score` 0.0–1.0)
- `campaign_tracking` — records which emails were sent/saved for which user+property+recommendation (`campaign_timestamp` TIMESTAMP, `campaign_status`: true=sent, false=saved, `user_activity`: 'email_sent'/'email_saved')
- `campaign_emails` — saved email content (subject, plain_text) with lifecycle columns: `email_type` ('sent'/'saved'), `email_sent_date`, `email_saved_date`, `draft_sent_date`, `saved_email_delete_date`

## REST API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/campaign/filters` | Distinct cities, states, types, segments, price ranges |
| `POST` | `/api/campaign/genie-query` | Natural language query → raw columns + rows from Genie Spaces |
| `GET` | `/api/campaign/properties/{id}` | Full property details by ID |
| `GET` | `/api/campaign/users/{id}/profile` | Full user profile |
| `POST` | `/api/campaign/users/{id}/listings` | Top recommended properties for a user |
| `POST` | `/api/campaign/users/{id}/past-emails` | Recent sent/saved emails for user+properties |
| `POST` | `/api/campaign/generate-email` | Generate email via LangGraph (source=dashboard) |
| `POST` | `/api/campaign/save-email` | Send email — persists to Lakebase, tracks campaign |
| `POST` | `/api/campaign/save-draft` | Save draft — persists without marking as sent |
| `POST` | `/api/campaign/delete-saved-email` | Soft-delete a saved email |
| `POST` | `/api/campaign/refine-email` | Refine email subject + plain text via LLM |
| `POST` | `/api/campaign/validate-email` | Guardrail validation — scores tone, toxicity, PII, bias |
| `POST` | `/api/campaign/fix-email` | Auto-fix email to address failed guardrail categories via LLM |
| `POST` | `/api/campaign/properties/batch` | Full details for multiple properties by ID (max 100) |

## Configuration

- Workspace: fevm (`https://fevm-serverless-stable-14ey07.cloud.databricks.com`)
- App URL: `https://xome-lakebase-campaign-genie-7474645414452466.aws.databricksapps.com`
- Genie Space ID: `01f1484fd22e1d558c5ed706de7b522d`
- All other config values (catalog, schema, Lakebase DNS, LLM endpoint, etc.) are in `agent_server/config.py`.
