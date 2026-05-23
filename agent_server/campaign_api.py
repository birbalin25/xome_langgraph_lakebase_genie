"""REST API router for the campaign dashboard UI."""

import asyncio
import json
import logging
import re
from typing import Optional

from fastapi import APIRouter, HTTPException
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel

from agent_server.config import GUARDRAIL_MODELS, LLM_ENDPOINT
from agent_server.guardrail_prompts import (
    GUARDRAIL_CATEGORY_ORDER,
    GUARDRAIL_CATEGORY_PROMPTS,
    GUARDRAIL_HUMAN_TEMPLATE,
)
from agent_server.refine_email_prompts import REFINE_EMAIL_SYSTEM_PROMPT
from agent_server.tools import _execute_sql

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/campaign", tags=["campaign"])


# ── Pydantic request/response models ──────────────────────────────────────────


class GenieQueryRequest(BaseModel):
    query: str
    conversation_id: Optional[str] = None


class ListingsRequest(BaseModel):
    city: Optional[str] = None
    state: Optional[str] = None
    listing_count: int = 10
    model: str = "Model A"


class PreviousEmail(BaseModel):
    subject: str
    plain_text: str
    saved_at: Optional[str] = None


class GenerateEmailRequest(BaseModel):
    user_id: str
    properties: list[dict]
    user_profile: Optional[dict] = None
    previous_email: Optional[PreviousEmail] = None


class PastEmailsRequest(BaseModel):
    property_ids: list[str] = []


class SaveEmailRequest(BaseModel):
    user_id: str
    subject: str
    html: Optional[str] = None
    plain_text: str
    properties: list[dict] = []
    saved_email_id: Optional[int] = None


class DeleteSavedEmailRequest(BaseModel):
    user_id: str
    email_id: int


class BatchPropertiesRequest(BaseModel):
    property_ids: list[str]


class RefineEmailRequest(BaseModel):
    subject: str
    plain_text: str
    prompt: str
    previous_email: Optional[PreviousEmail] = None


class ValidateEmailRequest(BaseModel):
    subject: str
    plain_text: str


class FailedCategory(BaseModel):
    name: str
    label: str
    explanation: str
    remediation: str


class FixEmailRequest(BaseModel):
    subject: str
    plain_text: str
    failed_categories: list[FailedCategory]


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("/filters")
async def get_filters():
    """Return distinct filter values from the database."""
    try:
        cities = _execute_sql("SELECT DISTINCT city FROM properties ORDER BY city")
        states = _execute_sql("SELECT DISTINCT state FROM properties ORDER BY state")
        property_types = _execute_sql(
            "SELECT DISTINCT property_type FROM properties ORDER BY property_type"
        )
        segments = _execute_sql(
            "SELECT DISTINCT user_segment FROM users ORDER BY user_segment"
        )
        prices = _execute_sql(
            "SELECT MIN(price) as min_price, MAX(price) as max_price FROM properties"
        )

        return {
            "cities": [r["city"] for r in cities if r.get("city")],
            "states": [r["state"] for r in states if r.get("state")],
            "property_types": [r["property_type"] for r in property_types if r.get("property_type")],
            "segments": [r["user_segment"] for r in segments if r.get("user_segment")],
            "price_range": {
                "min": float(prices[0]["min_price"]) if prices else 0,
                "max": float(prices[0]["max_price"]) if prices else 5000000,
            },
        }
    except Exception as e:
        logger.exception("Failed to fetch filters")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/genie-query")
async def genie_query(req: GenieQueryRequest):
    """Query Genie Spaces for user discovery via natural language."""
    from agent_server.graph import campaign_graph

    try:
        invoke_input: dict = {
            "source": "genie",
            "genie_query": req.query,
        }
        if req.conversation_id:
            invoke_input["genie_conversation_id"] = req.conversation_id

        result = await campaign_graph.ainvoke(invoke_input)

        raw = result.get("genie_raw_result") or {}

        if result.get("error"):
            return {
                "columns": raw.get("columns", []),
                "rows": raw.get("rows", []),
                "description": raw.get("description", ""),
                "sql": raw.get("sql", ""),
                "conversation_id": result.get("genie_conversation_id_out"),
                "message_id": result.get("genie_message_id"),
                "error": result["error"],
            }

        return {
            "columns": raw.get("columns", []),
            "rows": raw.get("rows", []),
            "description": raw.get("description", ""),
            "sql": raw.get("sql", ""),
            "conversation_id": result.get("genie_conversation_id_out"),
            "message_id": result.get("genie_message_id"),
        }
    except Exception as e:
        logger.exception("Genie query failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/properties/{property_id}")
async def get_property(property_id: str):
    """Return full details for a single property."""
    query = f"""
    SELECT property_id, address, city, state, zip_code,
           price, beds, baths, sqft, property_type,
           year_built, school_rating, neighborhood,
           listing_status, days_on_market,
           auction_date, auction_start_price,
           hoa_fee, description, image_url
    FROM properties
    WHERE property_id = '{property_id}'
    LIMIT 1
    """
    try:
        rows = _execute_sql(query)
        if not rows:
            raise HTTPException(status_code=404, detail="Property not found")
        return rows[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to fetch property")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/properties/batch")
async def get_properties_batch(req: BatchPropertiesRequest):
    """Return full details for multiple properties by ID."""
    if not req.property_ids:
        return {"properties": []}
    # Limit to 100 IDs to prevent overly large queries
    ids = req.property_ids[:100]
    escaped_ids = ", ".join(f"'{pid}'" for pid in ids)
    query = f"""
    SELECT property_id, address, city, state, zip_code,
           price, beds, baths, sqft, property_type,
           year_built, school_rating, neighborhood,
           listing_status, days_on_market,
           auction_date, auction_start_price,
           hoa_fee, description, image_url
    FROM properties
    WHERE property_id IN ({escaped_ids})
    """
    try:
        rows = _execute_sql(query)
        return {"properties": rows}
    except Exception as e:
        logger.exception("Failed to fetch properties batch")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/users/{user_id}/profile")
async def get_user_profile(user_id: str):
    """Return full profile for a single user."""
    query = f"""
    SELECT user_id, first_name, last_name, email, phone,
           preferred_city, preferred_state, budget_min, budget_max,
           preferred_property_type, preferred_beds_min,
           signup_date, is_active, user_segment
    FROM users
    WHERE user_id = '{user_id}'
    LIMIT 1
    """
    try:
        rows = _execute_sql(query)
        if not rows:
            raise HTTPException(status_code=404, detail="User not found")
        return rows[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to fetch user profile")
        raise HTTPException(status_code=500, detail=str(e))


def _fetch_listings(
    user_id: str, city: Optional[str], state: Optional[str], listing_count: int
) -> list[dict]:
    """Fetch recommended listings ranked by score with campaign tracking status."""
    where = [f"r.user_id = '{user_id}'", "r.is_active = true"]
    if city:
        where.append(f"p.city = '{city}'")
    if state:
        where.append(f"p.state = '{state}'")
    where_str = " AND ".join(where)

    query = f"""
    SELECT r.recommendation_id, r.recommendation_score, r.recommendation_reason,
           r.generated_at,
           p.property_id, p.address, p.city, p.state, p.zip_code,
           p.price, p.beds, p.baths, p.sqft, p.property_type,
           p.year_built, p.school_rating, p.neighborhood,
           p.listing_status, p.days_on_market,
           p.auction_date, p.auction_start_price,
           p.hoa_fee, p.description, p.image_url,
           ct.campaign_sent_date,
           ct_saved.campaign_saved_date
    FROM recommendations r
    JOIN properties p ON r.property_id = p.property_id
    LEFT JOIN (
        SELECT user_id, property_id, MAX(campaign_timestamp) AS campaign_sent_date
        FROM campaign_tracking
        WHERE campaign_status = true
        GROUP BY user_id, property_id
    ) ct
        ON ct.user_id = r.user_id
        AND ct.property_id = p.property_id
    LEFT JOIN (
        SELECT user_id, property_id, MAX(campaign_timestamp) AS campaign_saved_date
        FROM campaign_tracking
        WHERE campaign_status = false
        GROUP BY user_id, property_id
    ) ct_saved
        ON ct_saved.user_id = r.user_id
        AND ct_saved.property_id = p.property_id
    WHERE {where_str}
    ORDER BY r.recommendation_score DESC
    LIMIT {min(max(listing_count, 1), 30)}
    """
    return _execute_sql(query)


@router.post("/users/{user_id}/listings")
async def get_user_listings(user_id: str, req: ListingsRequest):
    """Return top recommended properties for a user."""
    logger.info("Fetching listings for user=%s model=%s", user_id, req.model)
    try:
        rows = _fetch_listings(user_id, req.city, req.state, req.listing_count)
        return {"properties": rows}
    except Exception as e:
        logger.exception("Failed to fetch listings")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/users/{user_id}/past-emails")
async def get_past_emails(user_id: str, req: PastEmailsRequest):
    """Return recent saved emails for a user+properties combo."""
    try:
        if not req.property_ids:
            return {"emails": []}

        escaped_ids = ", ".join(f"'{pid}'" for pid in req.property_ids)
        query = f"""
        SELECT DISTINCT
            ce.id AS email_id,
            COALESCE(ce.email_sent_date, ce.email_saved_date) AS ts,
            ce.subject, ce.plain_text, ce.email_type
        FROM campaign_emails ce
        JOIN campaign_tracking ct
            ON ct.user_id = ce.user_id
            AND ct.campaign_timestamp::date = COALESCE(ce.email_sent_date, ce.email_saved_date)::date
        WHERE ce.user_id = '{user_id}'
            AND ct.property_id IN ({escaped_ids})
            AND (ce.email_type = 'sent' OR (ce.email_type = 'saved' AND ce.draft_sent_date IS NULL))
            AND ce.saved_email_delete_date IS NULL
        ORDER BY COALESCE(ce.email_sent_date, ce.email_saved_date) DESC
        LIMIT 5
        """
        rows = _execute_sql(query)
        emails = [
            {
                "email_id": r.get("email_id"),
                "saved_at": str(r["ts"]),
                "subject": r["subject"],
                "plain_text": r["plain_text"],
                "email_type": r.get("email_type", "sent"),
            }
            for r in rows
        ]
        return {"emails": emails}
    except Exception as e:
        logger.exception("Failed to fetch past emails")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/generate-email")
async def generate_email_endpoint(req: GenerateEmailRequest):
    """Generate a campaign email for the given user + properties via LangGraph."""
    from agent_server.graph import campaign_graph

    try:
        invoke_input: dict = {
            "user_id": req.user_id,
            "properties_input": req.properties,
            "source": "dashboard",
        }
        if req.user_profile:
            invoke_input["user_profile"] = req.user_profile
        if req.previous_email:
            invoke_input["previous_email"] = req.previous_email.model_dump()
        result = await campaign_graph.ainvoke(invoke_input)

        if result.get("error"):
            raise HTTPException(status_code=400, detail=result["error"])

        return result.get("generated_email", {})
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to generate email")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/save-email")
async def save_email(req: SaveEmailRequest):
    """Save the generated email to Lakebase and track campaign sends."""
    try:
        # Mark the specific saved draft as sent if provided
        if req.saved_email_id:
            _execute_sql(f"""
                UPDATE campaign_emails SET draft_sent_date = NOW()
                WHERE id = {req.saved_email_id} AND email_type = 'saved'
                  AND user_id = '{req.user_id}' AND draft_sent_date IS NULL
            """)

        # Save email content to Lakebase
        escaped_subject = req.subject.replace("'", "''")
        escaped_plain = req.plain_text.replace("'", "''")
        _execute_sql(f"""
            INSERT INTO campaign_emails (user_id, subject, plain_text, email_sent_date, email_type)
            VALUES ('{req.user_id}', '{escaped_subject}',
                    '{escaped_plain}', NOW(), 'sent')
        """)

        # Insert campaign tracking rows for each property
        if req.properties:
            value_rows = []
            for prop in req.properties:
                pid = prop.get("property_id", "")
                rid = prop.get("recommendation_id", "")
                value_rows.append(
                    f"('{req.user_id}', '{pid}', '{rid}', NOW(), true, 'email_sent')"
                )
            insert_sql = (
                f"INSERT INTO campaign_tracking "
                f"(user_id, property_id, recommendation_id, campaign_timestamp, campaign_status, user_activity) "
                f"VALUES {', '.join(value_rows)}"
            )
            _execute_sql(insert_sql)

        return {"message": "Email sent successfully"}
    except Exception as e:
        logger.exception("Failed to save email")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/save-draft")
async def save_draft(req: SaveEmailRequest):
    """Save the generated email as a draft to Lakebase without marking as sent."""
    try:
        escaped_subject = req.subject.replace("'", "''")
        escaped_plain = req.plain_text.replace("'", "''")
        _execute_sql(f"""
            INSERT INTO campaign_emails (user_id, subject, plain_text, email_type, email_saved_date, email_sent_date)
            VALUES ('{req.user_id}', '{escaped_subject}',
                    '{escaped_plain}', 'saved', NOW(), NULL)
        """)

        # Insert campaign tracking rows for each property
        if req.properties:
            value_rows = []
            for prop in req.properties:
                pid = prop.get("property_id", "")
                rid = prop.get("recommendation_id", "")
                value_rows.append(
                    f"('{req.user_id}', '{pid}', '{rid}', NOW(), false, 'email_saved')"
                )
            insert_sql = (
                f"INSERT INTO campaign_tracking "
                f"(user_id, property_id, recommendation_id, campaign_timestamp, campaign_status, user_activity) "
                f"VALUES {', '.join(value_rows)}"
            )
            _execute_sql(insert_sql)

        return {"message": "Draft saved successfully"}
    except Exception as e:
        logger.exception("Failed to save draft")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/delete-saved-email")
async def delete_saved_email(req: DeleteSavedEmailRequest):
    """Soft-delete a saved email by setting saved_email_delete_date."""
    try:
        _execute_sql(f"""
            UPDATE campaign_emails SET saved_email_delete_date = NOW()
            WHERE id = {req.email_id} AND user_id = '{req.user_id}'
        """)
        # Delete matching campaign_tracking rows so "Email saved on" banner clears
        _execute_sql(f"""
            DELETE FROM campaign_tracking
            WHERE user_id = '{req.user_id}' AND campaign_status = false
              AND campaign_timestamp::date IN (
                  SELECT email_saved_date::date FROM campaign_emails
                  WHERE id = {req.email_id}
              )
        """)
        return {"success": True}
    except Exception as e:
        logger.exception("Failed to delete saved email")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/refine-email")
async def refine_email(req: RefineEmailRequest):
    """Refine an email subject + plain text using LLM based on a user prompt."""
    from agent_server.agent import get_llm

    previous_context = ""
    if req.previous_email:
        sent_date = req.previous_email.saved_at or "unknown"
        previous_context = (
            f"Here is the most recently sent email to this user for context:\n\n"
            f"PREVIOUS EMAIL SENT DATE: {sent_date}\n"
            f"PREVIOUS SUBJECT:\n{req.previous_email.subject}\n\n"
            f"PREVIOUS PLAIN TEXT:\n{req.previous_email.plain_text}\n\n"
            f"---\n\n"
        )

    human = (
        f"{previous_context}"
        f"Here is the current email to refine:\n\n"
        f"SUBJECT:\n{req.subject}\n\n"
        f"PLAIN TEXT:\n{req.plain_text}\n\n"
        f"---\n"
        f"Please refine this email according to these instructions: {req.prompt}"
    )

    try:
        llm = get_llm()
        response = await llm.ainvoke([
            SystemMessage(content=REFINE_EMAIL_SYSTEM_PROMPT),
            HumanMessage(content=human),
        ])
        raw = response.content

        # Parse subject
        subject = req.subject
        subject_match = re.search(r"SUBJECT:\s*\n?(.+?)(?:\n|$)", raw)
        if subject_match:
            subject = subject_match.group(1).strip()

        # Parse plain text
        plain_text = req.plain_text
        plain_match = re.search(r"PLAIN TEXT:\s*\n(.*)", raw, re.DOTALL)
        if plain_match:
            plain_text = plain_match.group(1).strip()

        return {"subject": subject, "plain_text": plain_text}
    except Exception as e:
        logger.exception("Failed to refine email")
        raise HTTPException(status_code=500, detail=str(e))


_CATEGORY_LABELS: dict[str, str] = {
    "professional_tone": "Professional Tone",
    "toxicity": "Toxicity & Offensive Content",
    "pii": "PII & Sensitive Data",
    "bias": "Bias & Fairness",
}

_CATEGORY_FAILSAFE: dict[str, dict] = {
    cat: {
        "name": cat,
        "label": _CATEGORY_LABELS[cat],
        "passed": False,
        "severity_score": 0,
        "explanation": "Validation could not be completed.",
        "remediation": "Please retry.",
    }
    for cat in GUARDRAIL_CATEGORY_ORDER
}


async def _validate_single_category(category: str, human_message: str) -> dict:
    """Run guardrail validation for a single category using its configured model."""
    from agent_server.agent import get_llm

    prompt = GUARDRAIL_CATEGORY_PROMPTS[category]
    endpoint = GUARDRAIL_MODELS.get(category, LLM_ENDPOINT)

    try:
        llm = get_llm(endpoint=endpoint)
        response = await llm.ainvoke([
            SystemMessage(content=prompt),
            HumanMessage(content=human_message),
        ])
        raw = response.content

        # Strip markdown code fences if present
        cleaned = re.sub(r"^```(?:json)?\s*", "", raw.strip())
        cleaned = re.sub(r"\s*```$", "", cleaned.strip())

        result = json.loads(cleaned)

        # Defensive unwrap: if the LLM returned a wrapper like {"categories": [...]}
        if "categories" in result and isinstance(result["categories"], list):
            result = result["categories"][0] if result["categories"] else {}

        # Normalize required fields
        result.setdefault("name", category)
        result.setdefault("label", _CATEGORY_LABELS[category])
        result.setdefault("severity_score", 0)
        result.setdefault("passed", result["severity_score"] <= 50)
        result.setdefault("explanation", "")
        result.setdefault("remediation", None)
        # Force correct name/label in case the LLM hallucinated different values
        result["name"] = category
        result["label"] = _CATEGORY_LABELS[category]

        return result
    except json.JSONDecodeError:
        logger.warning(
            "Guardrail LLM (%s, %s) returned non-JSON: %s",
            category, endpoint, raw[:300],
        )
        return {**_CATEGORY_FAILSAFE[category], "_parse_error": True}
    except Exception:
        logger.exception("Guardrail validation failed for %s (%s)", category, endpoint)
        return {**_CATEGORY_FAILSAFE[category], "_parse_error": True}


@router.post("/validate-email")
async def validate_email(req: ValidateEmailRequest):
    """Validate an email against guardrail categories using per-category LLM calls."""
    human = GUARDRAIL_HUMAN_TEMPLATE.format(
        subject=req.subject, plain_text=req.plain_text
    )

    try:
        # Launch all 4 category validations concurrently
        tasks = [
            _validate_single_category(cat, human)
            for cat in GUARDRAIL_CATEGORY_ORDER
        ]
        results = await asyncio.gather(*tasks)

        # Check if any category had a parse error
        has_parse_error = any(r.pop("_parse_error", False) for r in results)

        # Compute aggregate score and overall pass/fail
        scores = [r["severity_score"] for r in results]
        aggregate_score = round(sum(scores) / len(scores)) if scores else 0
        overall_passed = all(r["passed"] for r in results) and aggregate_score <= 50

        # Generate summary
        failed = [r["label"] for r in results if not r["passed"]]
        if not failed:
            summary = "All guardrail checks passed — email is compliant."
        else:
            summary = f"Issues found in: {', '.join(failed)}."

        response = {
            "categories": results,
            "aggregate_score": aggregate_score,
            "overall_passed": overall_passed,
            "summary": summary,
        }
        if has_parse_error:
            response["parse_error"] = True

        return response
    except Exception as e:
        logger.exception("Failed to validate email")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/fix-email")
async def fix_email(req: FixEmailRequest):
    """Auto-fix an email to address failed guardrail categories using LLM."""
    from agent_server.agent import get_llm

    # Build numbered fix instructions from failed categories
    fix_instructions = []
    for i, cat in enumerate(req.failed_categories, 1):
        fix_instructions.append(
            f"{i}. **{cat.label}** — {cat.explanation}\n"
            f"   Fix: {cat.remediation}"
        )

    human = (
        f"Here is the current email that FAILED guardrail validation:\n\n"
        f"SUBJECT:\n{req.subject}\n\n"
        f"PLAIN TEXT:\n{req.plain_text}\n\n"
        f"---\n"
        f"The email failed the following guardrail checks. "
        f"Rewrite the email to fix ALL of the issues below while preserving "
        f"the original intent, properties, and key information:\n\n"
        + "\n\n".join(fix_instructions)
    )

    try:
        llm = get_llm()
        response = await llm.ainvoke([
            SystemMessage(content=REFINE_EMAIL_SYSTEM_PROMPT),
            HumanMessage(content=human),
        ])
        raw = response.content

        # Parse subject
        subject = req.subject
        subject_match = re.search(r"SUBJECT:\s*\n?(.+?)(?:\n|$)", raw)
        if subject_match:
            subject = subject_match.group(1).strip()

        # Parse plain text
        plain_text = req.plain_text
        plain_match = re.search(r"PLAIN TEXT:\s*\n(.*)", raw, re.DOTALL)
        if plain_match:
            plain_text = plain_match.group(1).strip()

        return {"subject": subject, "plain_text": plain_text}
    except Exception as e:
        logger.exception("Failed to fix email")
        raise HTTPException(status_code=500, detail=str(e))
