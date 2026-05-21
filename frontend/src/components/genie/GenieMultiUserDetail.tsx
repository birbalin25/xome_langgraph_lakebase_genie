import { ArrowLeft, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  FilterState,
  GenieColumn,
  GeneratedEmail,
  GuardrailValidationResult,
  PastEmail,
  Property,
  UserProfile,
} from "../../types";
import * as api from "../../api/campaign";
import UserProfileCard from "../users/UserProfileCard";
import PropertyGrid from "../properties/PropertyGrid";
import EmailActions from "../email/EmailActions";
import EmailPreview from "../email/EmailPreview";
import GuardrailValidation from "../email/GuardrailValidation";
import PropertyDetailModal from "../properties/PropertyDetailModal";

interface GenieMultiUserDetailProps {
  userIds: string[];
  models: string[];
  filters: FilterState;
  onBack: () => void;
  otfGenieData?: { columns: GenieColumn[]; rows: (string | null)[][] };
  otfUserIds?: string[];
}

/** Per-user state bundle. */
interface UserState {
  userId: string;
  profile: UserProfile | null;
  properties: Property[];
  selectedPropertyIds: Set<string>;
  email: GeneratedEmail | null;
  originalPlainText: string;
  pastEmails: PastEmail[];
  generating: boolean;
  saving: boolean;
  savedMessage: string;
  savingDraft: boolean;
  savedDraftMessage: string;
  selectedSavedEmailId: number | null;
  collapsed: boolean;
  loading: boolean;
  error: string;
  guardrailResult: GuardrailValidationResult | null;
  guardrailValidating: boolean;
  guardrailContentHash: string;
  guardrailCached: boolean;
  loadingEmail: boolean;
  loadEmailMessage: string;
  emailInitialTab?: "html" | "plain";
  emailIsGenerated: boolean;
}

function makeInitialUserState(userId: string): UserState {
  return {
    userId,
    profile: null,
    properties: [],
    selectedPropertyIds: new Set(),
    email: null,
    originalPlainText: "",
    pastEmails: [],
    generating: false,
    saving: false,
    savedMessage: "",
    savingDraft: false,
    savedDraftMessage: "",
    selectedSavedEmailId: null,
    collapsed: false,
    loading: true,
    error: "",
    guardrailResult: null,
    guardrailValidating: false,
    guardrailContentHash: "",
    guardrailCached: false,
    loadingEmail: false,
    loadEmailMessage: "",
    emailInitialTab: undefined,
    emailIsGenerated: false,
  };
}

/**
 * Extract a Map<userId, propertyId[]> from Genie query result.
 * Returns null if either user_id or property_id column is missing.
 */
function extractUserPropertyMap(
  columns: { name: string }[],
  rows: (string | null)[][]
): Map<string, string[]> | null {
  const userIdIdx = columns.findIndex(
    (c) => c.name.toLowerCase() === "user_id" || c.name.toLowerCase() === "userid"
  );
  const propIdIdx = columns.findIndex(
    (c) => c.name.toLowerCase() === "property_id" || c.name.toLowerCase() === "propertyid"
  );
  if (userIdIdx < 0 || propIdIdx < 0) return null;

  const map = new Map<string, string[]>();
  for (const row of rows) {
    const uid = row[userIdIdx];
    const pid = row[propIdIdx];
    if (!uid || !pid) continue;
    const existing = map.get(uid);
    if (existing) {
      if (!existing.includes(pid)) existing.push(pid);
    } else {
      map.set(uid, [pid]);
    }
  }
  return map;
}

/**
 * Merge recommendation-sourced properties with Genie-sourced properties.
 * Deduplicates by property_id and accumulates source_labels.
 */
function mergeProperties(
  recProps: Property[],
  genieProps: Property[],
  recModelLabels: string[]
): Property[] {
  const merged = new Map<string, Property>();

  // Add recommendation properties with model labels
  for (const p of recProps) {
    merged.set(p.property_id, { ...p, source_labels: [...recModelLabels] });
  }

  // Add/merge Genie properties
  for (const p of genieProps) {
    const existing = merged.get(p.property_id);
    if (existing) {
      // Property exists from recommendations — add "On-the-Fly Logic" label
      const labels = existing.source_labels || [];
      if (!labels.includes("On-the-Fly Logic")) {
        labels.push("On-the-Fly Logic");
      }
      merged.set(p.property_id, { ...existing, source_labels: labels });
    } else {
      // New property from Genie only
      merged.set(p.property_id, { ...p, source_labels: ["On-the-Fly Logic"] });
    }
  }

  return Array.from(merged.values());
}

/**
 * Return the subject + plain text that the user currently sees,
 * based on the Plain Text dropdown selection.
 */
function getEffectiveContent(u: UserState): { subject: string; plainText: string } | null {
  if (!u.email) return null;
  if (u.selectedSavedEmailId != null) {
    const past = u.pastEmails.find((pe) => pe.email_id === u.selectedSavedEmailId);
    if (past) return { subject: past.subject, plainText: past.plain_text };
  }
  return { subject: u.email.subject, plainText: u.email.plain_text };
}

/** Simple DJB2 hash for content equality comparison (not crypto). */
function contentHash(subject: string, plainText: string): string {
  const str = subject + "\x00" + plainText;
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return String(hash >>> 0);
}

export default function GenieMultiUserDetail({
  userIds,
  models,
  filters,
  onBack,
  otfGenieData,
  otfUserIds = [],
}: GenieMultiUserDetailProps) {
  const otfUserIdSet = new Set(otfUserIds);
  const [users, setUsers] = useState<UserState[]>(() =>
    userIds.map(makeInitialUserState)
  );
  const [globalLoading, setGlobalLoading] = useState(true);
  const [modalProperty, setModalProperty] = useState<Property | null>(null);

  // Helper to update a single user's state by index
  const updateUser = useCallback(
    (idx: number, patch: Partial<UserState> | ((prev: UserState) => Partial<UserState>)) => {
      setUsers((prev) =>
        prev.map((u, i) => {
          if (i !== idx) return u;
          const resolved = typeof patch === "function" ? patch(u) : patch;
          return { ...u, ...resolved };
        })
      );
    },
    []
  );

  // Fetch all user data in parallel, with optional Genie On-the-Fly merge
  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      setGlobalLoading(true);

      const hasOtf = models.includes("On-the-fly-logic");
      const recModels = models.filter((m) => m !== "On-the-fly-logic");
      // Labels for recommendation-sourced properties (e.g. ["Model A", "Model B"])
      const recModelLabels = recModels.length > 0 ? recModels : [];

      // ── Phase 1: Use pre-fetched OTF Genie data (no re-query) ──
      let genieUserPropMap: Map<string, string[]> | null = null;
      let geniePropsById: Map<string, Property> = new Map();

      if (hasOtf && otfGenieData && otfGenieData.columns.length > 0) {
        try {
          genieUserPropMap = extractUserPropertyMap(
            otfGenieData.columns,
            otfGenieData.rows
          );
          if (genieUserPropMap) {
            // Collect all unique property IDs from OTF results
            const allPropIds = new Set<string>();
            for (const pids of genieUserPropMap.values()) {
              for (const pid of pids) allPropIds.add(pid);
            }
            if (allPropIds.size > 0) {
              const batchProps = await api.fetchPropertiesBatch(
                Array.from(allPropIds)
              );
              for (const p of batchProps) {
                geniePropsById.set(p.property_id, p);
              }
            }
          }
        } catch (err) {
          console.error("OTF property batch fetch failed, continuing with model results only", err);
        }
      }
      if (cancelled) return;

      // ── Phase 2: Per-user data fetch + merge ──
      const otfSet = new Set(otfUserIds);
      await Promise.all(
        userIds.map(async (userId, idx) => {
          try {
            const isOtfUser = otfSet.has(userId);

            // Fetch profile always
            const profilePromise = api.fetchUserProfile(userId);

            // Model A/B: fetch from recommendations table (skip for OTF-only users)
            let recListings: Property[] = [];
            if (recModels.length > 0 && !isOtfUser) {
              recListings = await api.fetchListings(userId, {
                city: filters.city || undefined,
                state: filters.state || undefined,
                listing_count: filters.listing_count,
                models: recModels,
              });
            }

            const profile = await profilePromise;
            if (cancelled) return;

            // OTF: get properties from OTF data → properties table (only for OTF users)
            let userGenieProps: Property[] = [];
            if (isOtfUser && genieUserPropMap) {
              const geniePropIds = genieUserPropMap.get(userId) || [];
              userGenieProps = geniePropIds
                .map((pid) => geniePropsById.get(pid))
                .filter((p): p is Property => p != null);
            }

            // Build final properties with source labels
            let finalProperties: Property[];
            if (isOtfUser) {
              // OTF user: properties from properties table, tagged "On-the-fly-logic"
              finalProperties = userGenieProps.map((p) => ({
                ...p,
                source_labels: ["On-the-fly-logic"],
              }));
            } else if (recListings.length > 0) {
              // Model A/B user: properties from recommendations table
              finalProperties = recListings.map((p) => ({
                ...p,
                source_labels: recModelLabels.length > 0 ? [...recModelLabels] : undefined,
              }));
            } else {
              finalProperties = [];
            }

            updateUser(idx, {
              profile,
              properties: finalProperties,
              selectedPropertyIds: new Set(finalProperties.map((p) => p.property_id)),
              loading: false,
            });
          } catch (err) {
            if (cancelled) return;
            updateUser(idx, {
              loading: false,
              error: err instanceof Error ? err.message : "Failed to load",
            });
          }
        })
      );
      if (!cancelled) setGlobalLoading(false);
    }
    loadAll();
    return () => {
      cancelled = true;
    };
  }, [userIds, filters.city, filters.state, filters.listing_count, models, otfGenieData, otfUserIds, updateUser]);

  const handleToggleProperty = useCallback(
    (idx: number, propertyId: string) => {
      updateUser(idx, (prev) => {
        const next = new Set(prev.selectedPropertyIds);
        if (next.has(propertyId)) next.delete(propertyId);
        else next.add(propertyId);
        return { selectedPropertyIds: next };
      });
    },
    [updateUser]
  );

  const handleGenerateEmail = useCallback(
    async (idx: number) => {
      const u = users[idx];
      if (!u || !u.profile || u.selectedPropertyIds.size === 0) return;
      const selectedProps = u.properties.filter((p) =>
        u.selectedPropertyIds.has(p.property_id)
      );
      updateUser(idx, { generating: true, savedMessage: "", savedDraftMessage: "" });
      try {
        const recentPast = u.pastEmails.length > 0
          ? { subject: u.pastEmails[0].subject, plain_text: u.pastEmails[0].plain_text, saved_at: u.pastEmails[0].saved_at }
          : null;
        const result = await api.generateEmail(
          u.userId,
          selectedProps,
          u.profile,
          recentPast
        );
        updateUser(idx, {
          email: result,
          originalPlainText: result.plain_text,
          generating: false,
          emailIsGenerated: true,
          guardrailResult: null,
          guardrailContentHash: "",
          guardrailCached: false,
        });
        // Fetch past emails in the background
        api
          .fetchPastEmails(
            u.userId,
            selectedProps.map((p) => p.property_id)
          )
          .then((pastEmails) => updateUser(idx, { pastEmails }))
          .catch(() => {});
      } catch (err) {
        console.error("Failed to generate email", err);
        updateUser(idx, { generating: false });
      }
    },
    [users, updateUser]
  );

  const handleSaveEmail = useCallback(
    async (idx: number) => {
      const u = users[idx];
      if (!u || !u.email) return;
      const selectedProps = u.properties.filter((p) =>
        u.selectedPropertyIds.has(p.property_id)
      );
      updateUser(idx, { saving: true });
      try {
        const result = await api.saveEmail({
          user_id: u.userId,
          subject: u.email.subject,
          plain_text: u.email.plain_text,
          properties: selectedProps.map((p) => ({
            property_id: p.property_id,
            recommendation_id: p.recommendation_id,
          })),
          saved_email_id: u.selectedSavedEmailId || undefined,
        });
        const today = new Date().toISOString().split("T")[0];
        const sentDraftId = u.selectedSavedEmailId;
        updateUser(idx, (prev) => ({
          saving: false,
          savedMessage: result.message,
          selectedSavedEmailId: null,
          // Optimistically remove the sent draft from the dropdown immediately
          pastEmails: sentDraftId
            ? prev.pastEmails.filter((pe) => pe.email_id !== sentDraftId)
            : prev.pastEmails,
          properties: prev.properties.map((p) =>
            prev.selectedPropertyIds.has(p.property_id)
              ? { ...p, campaign_sent_date: p.campaign_sent_date ?? today }
              : p
          ),
        }));
        // Re-fetch in background for canonical state
        api
          .fetchPastEmails(
            u.userId,
            selectedProps.map((p) => p.property_id)
          )
          .then((pastEmails) => updateUser(idx, { pastEmails }))
          .catch(() => {});
      } catch (err) {
        console.error("Failed to save email", err);
        updateUser(idx, { saving: false });
      }
    },
    [users, updateUser]
  );

  const handleValidateEmail = useCallback(
    async (idx: number, force?: boolean) => {
      const u = users[idx];
      const effective = getEffectiveContent(u);
      if (!effective) return;
      const hash = contentHash(effective.subject, effective.plainText);
      // If hash matches cached result and not forced, show cached
      if (!force && hash === u.guardrailContentHash && u.guardrailResult) {
        updateUser(idx, { guardrailCached: true });
        return;
      }
      updateUser(idx, { guardrailValidating: true, guardrailCached: false });
      try {
        const result = await api.validateEmail(effective.subject, effective.plainText);
        updateUser(idx, {
          guardrailResult: result,
          guardrailValidating: false,
          guardrailContentHash: hash,
          guardrailCached: false,
        });
      } catch (err) {
        console.error("Failed to validate email", err);
        updateUser(idx, { guardrailValidating: false });
      }
    },
    [users, updateUser]
  );

  const handleConfirmSend = useCallback(
    async (idx: number) => {
      const u = users[idx];
      const effective = getEffectiveContent(u);
      if (!effective) return;
      const selectedProps = u.properties.filter((p) =>
        u.selectedPropertyIds.has(p.property_id)
      );
      updateUser(idx, { saving: true });
      try {
        const result = await api.saveEmail({
          user_id: u.userId,
          subject: effective.subject,
          plain_text: effective.plainText,
          properties: selectedProps.map((p) => ({
            property_id: p.property_id,
            recommendation_id: p.recommendation_id,
          })),
          saved_email_id: u.selectedSavedEmailId || undefined,
        });
        const today = new Date().toISOString().split("T")[0];
        const sentDraftId = u.selectedSavedEmailId;
        updateUser(idx, (prev) => ({
          saving: false,
          savedMessage: result.message,
          selectedSavedEmailId: null,
          guardrailResult: null,
          guardrailContentHash: "",
          guardrailCached: false,
          pastEmails: sentDraftId
            ? prev.pastEmails.filter((pe) => pe.email_id !== sentDraftId)
            : prev.pastEmails,
          properties: prev.properties.map((p) =>
            prev.selectedPropertyIds.has(p.property_id)
              ? { ...p, campaign_sent_date: p.campaign_sent_date ?? today }
              : p
          ),
        }));
        api
          .fetchPastEmails(
            u.userId,
            selectedProps.map((p) => p.property_id)
          )
          .then((pastEmails) => updateUser(idx, { pastEmails }))
          .catch(() => {});
      } catch (err) {
        console.error("Failed to send email", err);
        updateUser(idx, { saving: false });
      }
    },
    [users, updateUser]
  );

  const handleSaveDraft = useCallback(
    async (idx: number) => {
      const u = users[idx];
      if (!u || !u.email) return;
      const selectedProps = u.properties.filter((p) =>
        u.selectedPropertyIds.has(p.property_id)
      );
      updateUser(idx, { savingDraft: true });
      try {
        const result = await api.saveDraft({
          user_id: u.userId,
          subject: u.email.subject,
          plain_text: u.email.plain_text,
          properties: selectedProps.map((p) => ({
            property_id: p.property_id,
            recommendation_id: p.recommendation_id,
          })),
        });
        updateUser(idx, (prev) => ({
          savingDraft: false,
          savedDraftMessage: result.message,
          properties: prev.properties.map((p) =>
            prev.selectedPropertyIds.has(p.property_id)
              ? { ...p, campaign_saved_date: new Date().toISOString() }
              : p
          ),
        }));
        // Re-fetch past emails so dropdown updates in real time
        api
          .fetchPastEmails(
            u.userId,
            selectedProps.map((p) => p.property_id)
          )
          .then((pastEmails) => updateUser(idx, { pastEmails }))
          .catch(() => {});
      } catch (err) {
        console.error("Failed to save draft", err);
        updateUser(idx, { savingDraft: false });
      }
    },
    [users, updateUser]
  );

  const handleUpdatePlainText = useCallback(
    (idx: number, text: string) => {
      updateUser(idx, (prev) => {
        if (!prev.email) return {};
        const patch: Partial<UserState> = { email: { ...prev.email, plain_text: text } };
        // Keep pastEmails in sync when editing a saved email
        if (prev.selectedSavedEmailId != null) {
          patch.pastEmails = prev.pastEmails.map((pe) =>
            pe.email_id === prev.selectedSavedEmailId
              ? { ...pe, plain_text: text }
              : pe
          );
        }
        return patch;
      });
    },
    [updateUser]
  );

  const handleRefineWithAI = useCallback(
    async (
      idx: number,
      subject: string,
      plainText: string,
      prompt: string,
      previousEmail?: { subject: string; plain_text: string; saved_at?: string } | null
    ) => {
      return api.refineEmail(subject, plainText, prompt, previousEmail);
    },
    []
  );

  const handleUpdateSubject = useCallback(
    (idx: number, subject: string) => {
      updateUser(idx, (prev) => {
        if (!prev.email) return {};
        const patch: Partial<UserState> = { email: { ...prev.email, subject } };
        // Keep pastEmails in sync when editing a saved email
        if (prev.selectedSavedEmailId != null) {
          patch.pastEmails = prev.pastEmails.map((pe) =>
            pe.email_id === prev.selectedSavedEmailId
              ? { ...pe, subject }
              : pe
          );
        }
        return patch;
      });
    },
    [updateUser]
  );

  const handleSelectPastEmail = useCallback(
    (idx: number, emailId: number | null) => {
      updateUser(idx, { selectedSavedEmailId: emailId });
    },
    [updateUser]
  );

  const handleDeleteSavedEmail = useCallback(
    async (idx: number, emailId: number) => {
      const u = users[idx];
      if (!u) return;
      // Optimistically remove from dropdown and clear "Email saved on" banner
      updateUser(idx, (prev) => ({
        pastEmails: prev.pastEmails.filter((pe) => pe.email_id !== emailId),
        properties: prev.properties.map((p) =>
          prev.selectedPropertyIds.has(p.property_id)
            ? { ...p, campaign_saved_date: undefined }
            : p
        ),
      }));
      try {
        await api.deleteSavedEmail(u.userId, emailId);
        const selectedProps = u.properties.filter((p) =>
          u.selectedPropertyIds.has(p.property_id)
        );
        // Re-fetch listings + past emails in background for canonical state
        api
          .fetchListings(u.userId, {
            city: filters.city || undefined,
            state: filters.state || undefined,
            listing_count: filters.listing_count,
            models,
          })
          .then((listings) => updateUser(idx, { properties: listings }))
          .catch(() => {});
        api
          .fetchPastEmails(
            u.userId,
            selectedProps.map((p) => p.property_id)
          )
          .then((pastEmails) => updateUser(idx, { pastEmails }))
          .catch(() => {});
      } catch (err) {
        console.error("Failed to delete saved email", err);
      }
    },
    [users, updateUser, filters, models]
  );

  const handleLoadEmail = useCallback(
    async (idx: number) => {
      const u = users[idx];
      if (!u) return;
      const selectedProps = u.properties.filter((p) =>
        u.selectedPropertyIds.has(p.property_id)
      );
      if (selectedProps.length === 0) return;
      updateUser(idx, { loadingEmail: true, loadEmailMessage: "" });
      try {
        const emails = await api.fetchPastEmails(
          u.userId,
          selectedProps.map((p) => p.property_id)
        );
        if (emails.length === 0) {
          updateUser(idx, { loadingEmail: false, loadEmailMessage: "No saved emails found", pastEmails: emails });
          setTimeout(() => updateUser(idx, { loadEmailMessage: "" }), 3000);
        } else {
          const latest = emails[0];
          updateUser(idx, {
            loadingEmail: false,
            loadEmailMessage: "",
            pastEmails: emails,
            email: {
              subject: latest.subject,
              html: "",
              plain_text: latest.plain_text,
              raw: "",
            },
            emailInitialTab: "plain",
            emailIsGenerated: false,
            selectedSavedEmailId: null,
            savedMessage: "",
            savedDraftMessage: "",
            guardrailResult: null,
            guardrailContentHash: "",
            guardrailCached: false,
          });
        }
      } catch (err) {
        console.error("Failed to load emails", err);
        updateUser(idx, { loadingEmail: false, loadEmailMessage: "Failed to load emails" });
        setTimeout(() => updateUser(idx, { loadEmailMessage: "" }), 3000);
      }
    },
    [users, updateUser]
  );

  const toggleCollapse = useCallback(
    (idx: number) => {
      updateUser(idx, (prev) => ({ collapsed: !prev.collapsed }));
    },
    [updateUser]
  );

  const allCollapsed = users.length > 0 && users.every((u) => u.collapsed);

  const toggleCollapseAll = useCallback(() => {
    const newCollapsed = !allCollapsed;
    setUsers((prev) => prev.map((u) => ({ ...u, collapsed: newCollapsed })));
  }, [allCollapsed]);

  if (globalLoading && users.every((u) => u.loading)) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-xome-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back button + summary + collapse all */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm font-medium text-gray-600 transition hover:text-xome-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to results
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={toggleCollapseAll}
            className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm transition hover:bg-gray-50"
          >
            {allCollapsed ? (
              <ChevronsUpDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronsDownUp className="h-3.5 w-3.5" />
            )}
            {allCollapsed ? "Expand All" : "Collapse All"}
          </button>
          <span className="text-sm text-gray-500">
            {userIds.length} user{userIds.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Per-user sections */}
      {users.map((u, idx) => {
        const selectedProps = u.properties.filter((p) =>
          u.selectedPropertyIds.has(p.property_id)
        );

        return (
          <div
            key={u.userId}
            className="rounded-xl border border-gray-200 bg-white shadow-sm"
          >
            {/* Collapsible header */}
            <button
              onClick={() => toggleCollapse(idx)}
              className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-gray-50"
            >
              {u.collapsed ? (
                <ChevronRight className="h-4 w-4 text-gray-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-gray-400" />
              )}
              <span className="font-semibold text-gray-800">
                {u.profile
                  ? `${u.profile.first_name} ${u.profile.last_name}`
                  : u.userId}
              </span>
              <span className="text-xs text-gray-500">({u.userId})</span>
              {/* Per-user source label */}
              {otfUserIdSet.has(u.userId) ? (
                <span className="ml-2 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                  On-the-fly-logic
                </span>
              ) : (
                models.filter((m) => m !== "On-the-fly-logic").length > 0 && (
                  <div className="flex flex-wrap gap-1 ml-2">
                    {models.filter((m) => m !== "On-the-fly-logic").map((label) => {
                      const cls =
                        label === "Model A"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-green-100 text-green-700";
                      return (
                        <span
                          key={label}
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
                        >
                          {label}
                        </span>
                      );
                    })}
                  </div>
                )
              )}
              {u.loading && (
                <Loader2 className="ml-auto h-4 w-4 animate-spin text-xome-600" />
              )}
            </button>

            {/* Collapsible body */}
            {!u.collapsed && (
              <div className="space-y-4 border-t border-gray-100 px-5 py-4">
                {u.loading ? (
                  <div className="flex h-32 items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-xome-600" />
                  </div>
                ) : u.error ? (
                  <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                    {u.error}
                  </div>
                ) : (
                  <>
                    {/* Profile card */}
                    {u.profile && <UserProfileCard profile={u.profile} />}

                    {/* Properties header + select all */}
                    <div>
                      <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-base font-semibold text-gray-800">
                          Top Recommended Listings
                        </h3>
                        {u.properties.length > 0 && (
                          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
                            <input
                              type="checkbox"
                              checked={
                                u.properties.length > 0 &&
                                u.selectedPropertyIds.size === u.properties.length
                              }
                              ref={(el) => {
                                if (el)
                                  el.indeterminate =
                                    u.selectedPropertyIds.size > 0 &&
                                    u.selectedPropertyIds.size < u.properties.length;
                              }}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  updateUser(idx, {
                                    selectedPropertyIds: new Set(
                                      u.properties.map((p) => p.property_id)
                                    ),
                                  });
                                } else {
                                  updateUser(idx, {
                                    selectedPropertyIds: new Set(),
                                  });
                                }
                              }}
                              className="h-4 w-4 rounded border-gray-300 text-xome-600 accent-xome-600"
                            />
                            Select All ({u.selectedPropertyIds.size}/
                            {u.properties.length})
                          </label>
                        )}
                      </div>
                      <PropertyGrid
                        properties={u.properties}
                        loading={false}
                        selectedIds={u.selectedPropertyIds}
                        onToggle={(pid) => handleToggleProperty(idx, pid)}
                      />
                    </div>

                    {/* Email actions + preview */}
                    <div className="space-y-4">
                      <EmailActions
                        selectedUserId={u.userId}
                        properties={selectedProps}
                        email={u.email}
                        onGenerate={() => handleGenerateEmail(idx)}
                        onSave={() => handleValidateEmail(idx)}
                        onSaveDraft={() => handleSaveDraft(idx)}
                        onLoadEmail={() => handleLoadEmail(idx)}
                        generating={u.generating}
                        saving={u.saving || u.guardrailValidating}
                        savedMessage={u.savedMessage}
                        savingDraft={u.savingDraft}
                        savedDraftMessage={u.savedDraftMessage}
                        loadingEmail={u.loadingEmail}
                        loadEmailMessage={u.loadEmailMessage}
                        viewingSentEmail={u.pastEmails.find((pe) => pe.email_id === u.selectedSavedEmailId)?.email_type === 'sent'}
                      />
                      <GuardrailValidation
                        result={u.guardrailResult}
                        validating={u.guardrailValidating}
                        cached={u.guardrailCached}
                        contentChanged={(() => {
                          if (!u.guardrailResult) return false;
                          const eff = getEffectiveContent(u);
                          if (!eff) return false;
                          return contentHash(eff.subject, eff.plainText) !== u.guardrailContentHash;
                        })()}
                        onConfirmSend={() => handleConfirmSend(idx)}
                        onRetry={() => handleValidateEmail(idx, true)}
                      />
                      <EmailPreview
                        email={u.email}
                        properties={u.properties}
                        onPropertyClick={(p) => setModalProperty(p)}
                        pastEmails={u.pastEmails}
                        initialTab={u.emailInitialTab}
                        showCurrentEmailOption={u.emailIsGenerated}
                        onUpdatePlainText={(text) =>
                          handleUpdatePlainText(idx, text)
                        }
                        onRefineWithAI={(subject, plainText, prompt, previousEmail) =>
                          handleRefineWithAI(idx, subject, plainText, prompt, previousEmail)
                        }
                        onUpdateSubject={(subject) =>
                          handleUpdateSubject(idx, subject)
                        }
                        onSelectPastEmail={(emailId) =>
                          handleSelectPastEmail(idx, emailId)
                        }
                        onDeleteSavedEmail={(emailId) =>
                          handleDeleteSavedEmail(idx, emailId)
                        }
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Property detail modal */}
      {modalProperty && (
        <PropertyDetailModal
          property={modalProperty}
          onClose={() => setModalProperty(null)}
        />
      )}
    </div>
  );
}
