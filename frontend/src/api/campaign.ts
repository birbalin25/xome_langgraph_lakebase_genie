import type {
  FilterOptions,
  GeneratedEmail,
  GenieQueryResponse,
  PastEmail,
  Property,
  UserProfile,
} from "../types";

const BASE = "/api/campaign";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json();
}

export async function fetchFilters(): Promise<FilterOptions> {
  const res = await fetch(`${BASE}/filters`);
  return json(res);
}

export async function queryGenie(
  query: string,
  conversationId?: string | null
): Promise<GenieQueryResponse> {
  const body: Record<string, string> = { query };
  if (conversationId) body.conversation_id = conversationId;
  const res = await fetch(`${BASE}/genie-query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return json(res);
}

export async function fetchProperty(propertyId: string): Promise<Property> {
  const res = await fetch(`${BASE}/properties/${propertyId}`);
  return json(res);
}

export async function fetchUserProfile(
  userId: string
): Promise<UserProfile> {
  const res = await fetch(`${BASE}/users/${userId}/profile`);
  return json(res);
}

export async function fetchListings(
  userId: string,
  filters?: { city?: string; state?: string; listing_count?: number; model?: string }
): Promise<Property[]> {
  const res = await fetch(`${BASE}/users/${userId}/listings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(filters ?? {}),
  });
  const data = await json<{ properties: Property[] }>(res);
  return data.properties;
}

export async function generateEmail(
  userId: string,
  properties: Property[],
  userProfile: UserProfile,
  previousEmail?: { subject: string; plain_text: string; saved_at?: string } | null
): Promise<GeneratedEmail> {
  const payload: Record<string, unknown> = {
    user_id: userId,
    properties,
    user_profile: userProfile,
  };
  if (previousEmail) {
    payload.previous_email = previousEmail;
  }
  const res = await fetch(`${BASE}/generate-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return json(res);
}

export async function fetchPastEmails(
  userId: string,
  propertyIds: string[]
): Promise<PastEmail[]> {
  const res = await fetch(`${BASE}/users/${userId}/past-emails`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ property_ids: propertyIds }),
  });
  const data = await json<{ emails: PastEmail[] }>(res);
  return data.emails;
}

export async function refineEmail(
  subject: string,
  plainText: string,
  prompt: string,
  previousEmail?: { subject: string; plain_text: string; saved_at?: string } | null
): Promise<{ subject: string; plain_text: string }> {
  const payload: Record<string, unknown> = { subject, plain_text: plainText, prompt };
  if (previousEmail) {
    payload.previous_email = previousEmail;
  }
  const res = await fetch(`${BASE}/refine-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return json(res);
}

export async function saveEmail(payload: {
  user_id: string;
  subject: string;
  plain_text: string;
  properties: Array<{ property_id: string; recommendation_id?: string }>;
  saved_email_id?: number;
}): Promise<{ message: string }> {
  const res = await fetch(`${BASE}/save-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return json(res);
}

export async function saveDraft(payload: {
  user_id: string;
  subject: string;
  plain_text: string;
  properties: Array<{ property_id: string; recommendation_id?: string }>;
}): Promise<{ message: string }> {
  const res = await fetch(`${BASE}/save-draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return json(res);
}

export async function deleteSavedEmail(
  userId: string,
  emailId: number
): Promise<{ success: boolean }> {
  const res = await fetch(`${BASE}/delete-saved-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, email_id: emailId }),
  });
  return json(res);
}
