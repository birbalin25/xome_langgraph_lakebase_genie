import { ArrowLeft, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  FilterState,
  GeneratedEmail,
  PastEmail,
  Property,
  UserProfile,
} from "../../types";
import * as api from "../../api/campaign";
import UserProfileCard from "../users/UserProfileCard";
import PropertyGrid from "../properties/PropertyGrid";
import EmailActions from "../email/EmailActions";
import EmailPreview from "../email/EmailPreview";
import PropertyDetailModal from "../properties/PropertyDetailModal";

interface GenieMultiUserDetailProps {
  userIds: string[];
  model: string;
  filters: FilterState;
  onBack: () => void;
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
  };
}

export default function GenieMultiUserDetail({
  userIds,
  model,
  filters,
  onBack,
}: GenieMultiUserDetailProps) {
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

  // Fetch all user data in parallel
  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      setGlobalLoading(true);
      await Promise.all(
        userIds.map(async (userId, idx) => {
          try {
            const [profile, listings] = await Promise.all([
              api.fetchUserProfile(userId),
              api.fetchListings(userId, {
                city: filters.city || undefined,
                state: filters.state || undefined,
                listing_count: filters.listing_count,
                model,
              }),
            ]);
            if (cancelled) return;
            updateUser(idx, {
              profile,
              properties: listings,
              selectedPropertyIds: new Set(listings.map((p) => p.property_id)),
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
  }, [userIds, filters.city, filters.state, filters.listing_count, model, updateUser]);

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
        return { email: { ...prev.email, plain_text: text } };
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
        return { email: { ...prev.email, subject } };
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
            model,
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
    [users, updateUser, filters, model]
  );

  const toggleCollapse = useCallback(
    (idx: number) => {
      updateUser(idx, (prev) => ({ collapsed: !prev.collapsed }));
    },
    [updateUser]
  );

  if (globalLoading && users.every((u) => u.loading)) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-xome-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back button + summary */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm font-medium text-gray-600 transition hover:text-xome-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to results
        </button>
        <span className="text-sm text-gray-500">
          {userIds.length} user{userIds.length !== 1 ? "s" : ""} &middot; {model}
        </span>
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
                        onSave={() => handleSaveEmail(idx)}
                        onSaveDraft={() => handleSaveDraft(idx)}
                        generating={u.generating}
                        saving={u.saving}
                        savedMessage={u.savedMessage}
                        savingDraft={u.savingDraft}
                        savedDraftMessage={u.savedDraftMessage}
                        viewingSentEmail={u.pastEmails.find((pe) => pe.email_id === u.selectedSavedEmailId)?.email_type === 'sent'}
                      />
                      <EmailPreview
                        email={u.email}
                        properties={u.properties}
                        onPropertyClick={(p) => setModalProperty(p)}
                        pastEmails={u.pastEmails}
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
