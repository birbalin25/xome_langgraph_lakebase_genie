import { ArrowLeft, Loader2 } from "lucide-react";
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

interface GenieUserDetailProps {
  userId: string;
  filters: FilterState;
  onBack: () => void;
}

export default function GenieUserDetail({
  userId,
  filters,
  onBack,
}: GenieUserDetailProps) {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<Set<string>>(
    new Set()
  );

  const [email, setEmail] = useState<GeneratedEmail | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [savingDraft, setSavingDraft] = useState(false);
  const [savedDraftMessage, setSavedDraftMessage] = useState("");
  const [modalProperty, setModalProperty] = useState<Property | null>(null);
  const [pastEmails, setPastEmails] = useState<PastEmail[]>([]);
  const [selectedSavedEmailId, setSelectedSavedEmailId] = useState<number | null>(null);

  // Fetch profile + listings
  const loadData = useCallback(async () => {
    setLoading(true);
    setEmail(null);
    setSavedMessage("");
    setSavedDraftMessage("");
    try {
      const [profile, listings] = await Promise.all([
        api.fetchUserProfile(userId),
        api.fetchListings(userId, {
          city: filters.city || undefined,
          state: filters.state || undefined,
          listing_count: filters.listing_count,
        }),
      ]);
      setUserProfile(profile);
      setProperties(listings);
      setSelectedPropertyIds(new Set(listings.map((p) => p.property_id)));
    } catch (err) {
      console.error("Failed to load user data", err);
    } finally {
      setLoading(false);
    }
  }, [userId, filters.city, filters.state, filters.listing_count]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleToggleProperty = useCallback((propertyId: string) => {
    setSelectedPropertyIds((prev) => {
      const next = new Set(prev);
      if (next.has(propertyId)) next.delete(propertyId);
      else next.add(propertyId);
      return next;
    });
  }, []);

  const selectedProperties = properties.filter((p) =>
    selectedPropertyIds.has(p.property_id)
  );

  const handleGenerateEmail = useCallback(async () => {
    if (!userId || selectedProperties.length === 0 || !userProfile) return;
    setGenerating(true);
    setSavedMessage("");
    setSavedDraftMessage("");
    setSelectedSavedEmailId(null);
    try {
      const recentPast = pastEmails.length > 0
        ? { subject: pastEmails[0].subject, plain_text: pastEmails[0].plain_text, saved_at: pastEmails[0].saved_at }
        : null;
      const result = await api.generateEmail(
        userId,
        selectedProperties,
        userProfile,
        recentPast
      );
      setEmail(result);
      // Fetch past emails in the background
      api
        .fetchPastEmails(userId, selectedProperties.map((p) => p.property_id))
        .then((emails) => setPastEmails(emails))
        .catch(() => {});
    } catch (err) {
      console.error("Failed to generate email", err);
    } finally {
      setGenerating(false);
    }
  }, [userId, selectedProperties, userProfile, pastEmails]);

  const handleSaveEmail = useCallback(async () => {
    if (!email || !userId) return;
    setSaving(true);
    try {
      const result = await api.saveEmail({
        user_id: userId,
        subject: email.subject,
        plain_text: email.plain_text,
        properties: selectedProperties.map((p) => ({
          property_id: p.property_id,
          recommendation_id: p.recommendation_id,
        })),
        saved_email_id: selectedSavedEmailId || undefined,
      });
      setSavedMessage(result.message);

      // Optimistically remove the sent draft from the dropdown immediately
      if (selectedSavedEmailId) {
        setPastEmails((prev) => prev.filter((pe) => pe.email_id !== selectedSavedEmailId));
      }
      setSelectedSavedEmailId(null);

      const today = new Date().toISOString().split("T")[0];
      setProperties((prev) =>
        prev.map((p) =>
          selectedPropertyIds.has(p.property_id)
            ? { ...p, campaign_sent_date: p.campaign_sent_date ?? today }
            : p
        )
      );

      // Re-fetch past emails in the background for canonical state
      api
        .fetchPastEmails(userId, selectedProperties.map((p) => p.property_id))
        .then((emails) => setPastEmails(emails))
        .catch(() => {});
    } catch (err) {
      console.error("Failed to save email", err);
    } finally {
      setSaving(false);
    }
  }, [email, userId, selectedProperties, selectedPropertyIds, selectedSavedEmailId]);

  const handleSaveDraft = useCallback(async () => {
    if (!email || !userId) return;
    setSavingDraft(true);
    try {
      const result = await api.saveDraft({
        user_id: userId,
        subject: email.subject,
        plain_text: email.plain_text,
        properties: selectedProperties.map((p) => ({
          property_id: p.property_id,
          recommendation_id: p.recommendation_id,
        })),
      });
      setSavedDraftMessage(result.message);

      const today = new Date().toISOString().split("T")[0];
      setProperties((prev) =>
        prev.map((p) =>
          selectedPropertyIds.has(p.property_id)
            ? { ...p, campaign_saved_date: p.campaign_saved_date ?? today }
            : p
        )
      );

      // Re-fetch past emails so dropdown updates in real time
      api
        .fetchPastEmails(userId, selectedProperties.map((p) => p.property_id))
        .then((emails) => setPastEmails(emails))
        .catch(() => {});
    } catch (err) {
      console.error("Failed to save draft", err);
    } finally {
      setSavingDraft(false);
    }
  }, [email, userId, selectedProperties, selectedPropertyIds]);

  const handleDeleteSavedEmail = useCallback(async (emailId: number) => {
    // Optimistically remove from dropdown immediately
    setPastEmails((prev) => prev.filter((pe) => pe.email_id !== emailId));
    try {
      await api.deleteSavedEmail(userId, emailId);
      // Re-fetch in background for canonical state
      api
        .fetchPastEmails(userId, selectedProperties.map((p) => p.property_id))
        .then((emails) => setPastEmails(emails))
        .catch(() => {});
    } catch (err) {
      console.error("Failed to delete saved email", err);
    }
  }, [userId, selectedProperties]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-xome-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm font-medium text-gray-600 transition hover:text-xome-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to user list
      </button>

      {/* User profile */}
      {userProfile && <UserProfileCard profile={userProfile} />}

      {/* Property grid */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-800">
            Top Recommended Listings
          </h2>
          {properties.length > 0 && (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={
                  properties.length > 0 &&
                  selectedPropertyIds.size === properties.length
                }
                ref={(el) => {
                  if (el)
                    el.indeterminate =
                      selectedPropertyIds.size > 0 &&
                      selectedPropertyIds.size < properties.length;
                }}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedPropertyIds(
                      new Set(properties.map((p) => p.property_id))
                    );
                  } else {
                    setSelectedPropertyIds(new Set());
                  }
                }}
                className="h-4 w-4 rounded border-gray-300 text-xome-600 accent-xome-600"
              />
              Select All ({selectedPropertyIds.size}/{properties.length})
            </label>
          )}
        </div>
        <PropertyGrid
          properties={properties}
          loading={false}
          selectedIds={selectedPropertyIds}
          onToggle={handleToggleProperty}
        />
      </div>

      {/* Email actions + preview */}
      <div className="space-y-4">
        <EmailActions
          selectedUserId={userId}
          properties={selectedProperties}
          email={email}
          onGenerate={handleGenerateEmail}
          onSave={handleSaveEmail}
          onSaveDraft={handleSaveDraft}
          generating={generating}
          saving={saving}
          savedMessage={savedMessage}
          savingDraft={savingDraft}
          savedDraftMessage={savedDraftMessage}
        />
        <EmailPreview
          email={email}
          properties={properties}
          onPropertyClick={(p) => setModalProperty(p)}
          pastEmails={pastEmails}
          onUpdatePlainText={(text) => {
            if (email) setEmail({ ...email, plain_text: text });
          }}
          onRefineWithAI={(subject, plainText, prompt, previousEmail) =>
            api.refineEmail(subject, plainText, prompt, previousEmail)
          }
          onUpdateSubject={(subject) => {
            if (email) setEmail({ ...email, subject });
          }}
          onSelectPastEmail={(emailId) => setSelectedSavedEmailId(emailId)}
          onDeleteSavedEmail={handleDeleteSavedEmail}
        />
      </div>

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
