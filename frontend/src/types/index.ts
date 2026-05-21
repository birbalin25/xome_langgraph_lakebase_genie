export interface UserProfile {
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  preferred_city: string;
  preferred_state: string;
  budget_min: string;
  budget_max: string;
  preferred_property_type: string;
  preferred_beds_min: string;
  signup_date?: string;
  is_active?: string;
  user_segment: string;
}

export interface Property {
  property_id: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  price: string;
  beds: string;
  baths: string;
  sqft: string;
  property_type: string;
  year_built: string;
  school_rating: string;
  neighborhood: string;
  listing_status: string;
  days_on_market: string;
  auction_date?: string;
  auction_start_price?: string;
  hoa_fee?: string;
  description?: string;
  image_url?: string;
  recommendation_id?: string;
  recommendation_score?: string;
  recommendation_reason?: string;
  generated_at?: string;
  campaign_sent_date?: string | null;
  campaign_saved_date?: string | null;
  source_labels?: string[];
}

export interface FilterOptions {
  cities: string[];
  states: string[];
  property_types: string[];
  segments: string[];
  price_range: { min: number; max: number };
}

export interface FilterState {
  city: string;
  state: string;
  property_type: string;
  segment: string;
  price_min: number;
  price_max: number;
  listing_count: number;
}

export interface GeneratedEmail {
  subject: string;
  html: string;
  plain_text: string;
  raw: string;
}

export interface PastEmail {
  email_id?: number;
  saved_at: string;
  subject: string;
  plain_text: string;
  email_type: 'sent' | 'saved';
}

export interface GuardrailCategory {
  name: string;
  label: string;
  passed: boolean;
  severity_score: number;
  explanation: string;
  remediation: string | null;
}

export interface GuardrailValidationResult {
  categories: GuardrailCategory[];
  aggregate_score: number;
  overall_passed: boolean;
  summary: string;
  parse_error?: boolean;
}

export interface GenieColumn {
  name: string;
  type: string;
}

export interface GenieQueryResponse {
  columns: GenieColumn[];
  rows: (string | null)[][];
  description: string;
  sql: string;
  conversation_id: string | null;
  message_id: string | null;
  error?: string;
}