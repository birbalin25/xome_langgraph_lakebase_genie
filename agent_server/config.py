CATALOG = "serverless_stable_14ey07_catalog"
SCHEMA = "xome"
SQL_WAREHOUSE_ID = "1f01d0f9de5b5108"
LLM_ENDPOINT = "databricks-claude-sonnet-4-6"
VOLUME_NAME = "campaign_emails"

# Lakebase (managed PostgreSQL) connection settings
LAKEBASE_INSTANCE = "xome-campaign"
LAKEBASE_DNS = "ep-blue-shape-d2evoduc.database.us-east-1.cloud.databricks.com"
LAKEBASE_DB = "xome-campaign"
LAKEBASE_SCHEMA = "xome"

GENIE_SPACE_ID = "01f1484fd22e1d558c5ed706de7b522d"

# Per-category model endpoints for guardrail validation.
# Change any value to route that category to a different LLM.
# The endpoint must support the Chat Completions API (used by ChatDatabricks).
# Missing keys fall back to LLM_ENDPOINT.
GUARDRAIL_MODELS: dict[str, str] = {
    "professional_tone": LLM_ENDPOINT,
    "toxicity": LLM_ENDPOINT,
    "pii": LLM_ENDPOINT,
    "bias": LLM_ENDPOINT,
}

METROS = {
    "Austin": {"state": "TX", "base_price": 450000},
    "Boston": {"state": "MA", "base_price": 650000},
    "Chicago": {"state": "IL", "base_price": 350000},
    "Denver": {"state": "CO", "base_price": 550000},
    "Miami": {"state": "FL", "base_price": 500000},
    "Nashville": {"state": "TN", "base_price": 400000},
    "New York": {"state": "NY", "base_price": 850000},
    "Portland": {"state": "OR", "base_price": 500000},
    "San Francisco": {"state": "CA", "base_price": 1100000},
    "Seattle": {"state": "WA", "base_price": 700000},
}
