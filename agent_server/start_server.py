import logging
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

# Load env vars from .env before importing other modules for proper auth
load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env", override=True)

import mlflow  # noqa: E402

mlflow.set_tracking_uri("databricks")
mlflow.set_experiment("/Shared/xome-lakebase-campaign-tracing")
mlflow.langchain.autolog()

from agent_server.campaign_api import router as campaign_router  # noqa: E402
from agent_server.tools import _execute_sql  # noqa: E402

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create campaign_tracking table on startup if it doesn't exist."""
    try:
        _execute_sql("""
            CREATE TABLE IF NOT EXISTS campaign_tracking (
                user_id TEXT,
                property_id TEXT,
                recommendation_id TEXT,
                campaign_timestamp TIMESTAMP,
                campaign_status BOOLEAN,
                user_activity TEXT
            )
        """)
        _execute_sql("""
            CREATE TABLE IF NOT EXISTS campaign_emails (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                subject TEXT,
                plain_text TEXT,
                saved_at TIMESTAMP DEFAULT NOW()
            )
        """)
        # Schema migration: rename saved_at → email_sent_date, add email_type + email_saved_date
        try:
            _execute_sql("ALTER TABLE campaign_emails RENAME COLUMN saved_at TO email_sent_date")
        except Exception:
            pass  # Column already renamed
        try:
            _execute_sql("ALTER TABLE campaign_emails ALTER COLUMN email_sent_date DROP DEFAULT")
        except Exception:
            pass  # Default already dropped
        try:
            _execute_sql("ALTER TABLE campaign_emails ADD COLUMN IF NOT EXISTS email_type TEXT DEFAULT 'sent'")
        except Exception:
            pass
        try:
            _execute_sql("ALTER TABLE campaign_emails ADD COLUMN IF NOT EXISTS email_saved_date TIMESTAMP")
        except Exception:
            pass
        try:
            _execute_sql("ALTER TABLE campaign_emails ADD COLUMN IF NOT EXISTS draft_sent_date TIMESTAMP")
        except Exception:
            pass
        try:
            _execute_sql("ALTER TABLE campaign_emails ADD COLUMN IF NOT EXISTS saved_email_delete_date TIMESTAMP")
        except Exception:
            pass
        try:
            _execute_sql("ALTER TABLE campaign_emails DROP COLUMN IF EXISTS filename")
        except Exception:
            pass
        try:
            _execute_sql("ALTER TABLE campaign_emails DROP COLUMN IF EXISTS html_body")
        except Exception:
            pass
        logger.info("campaign_tracking and campaign_emails tables ready")
    except Exception:
        logger.exception("Failed to create campaign tables")
    yield


app = FastAPI(title="Xome Campaign Platform", lifespan=lifespan)
app.include_router(campaign_router)


# ── Serve the built frontend static files from frontend/dist/ ────────────────

FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"

if FRONTEND_DIST.is_dir():
    # Mount static assets (JS, CSS, images) under /assets
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="static-assets")

    # SPA fallback: serve index.html for any non-API, non-file route
    @app.get("/{full_path:path}")
    async def serve_spa(request: Request, full_path: str):
        # Try to serve the exact file from dist/ first (e.g. favicon.ico)
        file_path = FRONTEND_DIST / full_path
        if full_path and file_path.is_file():
            return FileResponse(str(file_path))
        # Otherwise serve index.html for SPA client-side routing
        index_file = FRONTEND_DIST / "index.html"
        if index_file.is_file():
            return HTMLResponse(index_file.read_text())
        return HTMLResponse("<h1>Frontend not built</h1><p>Run: cd frontend && npm run build</p>", status_code=500)


def main():
    uvicorn.run("agent_server.start_server:app", host="0.0.0.0", port=8000)
