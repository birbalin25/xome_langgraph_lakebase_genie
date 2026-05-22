import { ArrowLeft, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  FilterState,
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
  const [loadingEmail, setLoadingEmail] = useState(false);
  const [loadEmailMessage, setLoadEmailMessage] = useState("");
  const [emailInitialTab, setEmailInitialTab] = useState<"html" | "plain" | undefined>(undefined);
  const [emailIsGenerated, setEmailIsGenerated] = useState(false);
  const [guardrailResult, setGuardrailResult] = useState<GuardrailValidationResult | null>(null);
  const [guardrailValidating, setGuardrailValidating] = useState(false);
  const [guardrailContentHash, setGuardrailContentHash] = useState("");
  const [guardrailCached, setGuardrailCached] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [loadedEmailType, setLoadedEmailType] = useState<string | null>(null);
  const [loadedEmailOriginal, setLoadedEmailOriginal] = useState<{ subject: string; plain_text: string } | null>(null);

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
    setEmailIsGenerated(true);
    setGuardrailResult(null);
    setGuardrailContentHash("");
    setGuardrailCached(false);
    setLoadedEmailType(null);
    setLoadedEmailOriginal(null);
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

      setProperties((prev) =>
        prev.map((p) =>
          selectedPropertyIds.has(p.property_id)
            ? { ...p, campaign_saved_date: new Date().toISOString() }
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
    // Optimistically clear "Email saved on" banner on selected properties
    setProperties((prev) =>
      prev.map((p) =>
        selectedPropertyIds.has(p.property_id)
          ? { ...p, campaign_saved_date: undefined }
          : p
      )
    );
    try {
      await api.deleteSavedEmail(userId, emailId);
      // Re-fetch listings + past emails in background for canonical state
      api
        .fetchListings(userId, {
          city: filters.city || undefined,
          state: filters.state || undefined,
          listing_count: filters.listing_count,
        })
        .then((listings) => setProperties(listings))
        .catch(() => {});
      api
        .fetchPastEmails(userId, selectedProperties.map((p) => p.property_id))
        .then((emails) => setPastEmails(emails))
        .catch(() => {});
    } catch (err) {
      console.error("Failed to delete saved email", err);
    }
  }, [userId, selectedProperties, selectedPropertyIds, filters]);

  const handleValidateEmail = useCallback(async (force?: boolean) => {
    if (!email) return;
    const subject = email.subject;
    const plainText = email.plain_text;
    const str = subject + "\x00" + plainText;
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    }
    const hash = String(h >>> 0);
    if (!force && hash === guardrailContentHash && guardrailResult) {
      setGuardrailCached(true);
      return;
    }
    setGuardrailValidating(true);
    setGuardrailCached(false);
    try {
      const result = await api.validateEmail(subject, plainText);
      setGuardrailResult(result);
      setGuardrailContentHash(hash);
      setGuardrailCached(false);
    } catch (err) {
      console.error("Failed to validate email", err);
    } finally {
      setGuardrailValidating(false);
    }
  }, [email, guardrailContentHash, guardrailResult]);

  const handleConfirmSend = useCallback(async () => {
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

      if (selectedSavedEmailId) {
        setPastEmails((prev) => prev.filter((pe) => pe.email_id !== selectedSavedEmailId));
      }
      setSelectedSavedEmailId(null);
      setGuardrailResult(null);
      setGuardrailContentHash("");
      setGuardrailCached(false);

      const today = new Date().toISOString().split("T")[0];
      setProperties((prev) =>
        prev.map((p) =>
          selectedPropertyIds.has(p.property_id)
            ? { ...p, campaign_sent_date: p.campaign_sent_date ?? today }
            : p
        )
      );

      api
        .fetchPastEmails(userId, selectedProperties.map((p) => p.property_id))
        .then((emails) => setPastEmails(emails))
        .catch(() => {});
    } catch (err) {
      console.error("Failed to send email", err);
    } finally {
      setSaving(false);
    }
  }, [email, userId, selectedProperties, selectedPropertyIds, selectedSavedEmailId]);

  const handleAutoFix = useCallback(async () => {
    if (!email || !guardrailResult) return;
    const failedCategories = guardrailResult.categories
      .filter((c) => !c.passed && c.remediation)
      .map((c) => ({
        name: c.name,
        label: c.label,
        explanation: c.explanation,
        remediation: c.remediation!,
      }));
    if (failedCategories.length === 0) return;
    setFixing(true);
    try {
      const result = await api.fixEmail(
        email.subject,
        email.plain_text,
        failedCategories
      );
      setEmail({ ...email, subject: result.subject, plain_text: result.plain_text });
      setGuardrailResult(null);
      setGuardrailContentHash("");
      setGuardrailCached(false);
    } catch (err) {
      console.error("Failed to auto-fix email", err);
    } finally {
      setFixing(false);
    }
  }, [email, guardrailResult]);

  const handleLoadEmail = useCallback(async () => {
    if (!userId || selectedProperties.length === 0) return;
    setLoadingEmail(true);
    setLoadEmailMessage("");
    try {
      const emails = await api.fetchPastEmails(
        userId,
        selectedProperties.map((p) => p.property_id)
      );
      setPastEmails(emails);
      if (emails.length === 0) {
        setLoadEmailMessage("No saved emails found");
        setTimeout(() => setLoadEmailMessage(""), 3000);
      } else {
        const latest = emails[0];
        setEmail({
          subject: latest.subject,
          html: "",
          plain_text: latest.plain_text,
          raw: "",
        });
        setEmailInitialTab("plain");
        setEmailIsGenerated(false);
        setSelectedSavedEmailId(null);
        setSavedMessage("");
        setSavedDraftMessage("");
        setGuardrailResult(null);
        setGuardrailContentHash("");
        setGuardrailCached(false);
        setLoadedEmailType(latest.email_type || null);
        setLoadedEmailOriginal({ subject: latest.subject, plain_text: latest.plain_text });
      }
    } catch (err) {
      console.error("Failed to load emails", err);
      setLoadEmailMessage("Failed to load emails");
      setTimeout(() => setLoadEmailMessage(""), 3000);
    } finally {
      setLoadingEmail(false);
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
          onSave={() => handleValidateEmail()}
          onSaveDraft={handleSaveDraft}
          onLoadEmail={handleLoadEmail}
          generating={generating}
          saving={saving || guardrailValidating}
          savedMessage={savedMessage}
          savingDraft={savingDraft}
          savedDraftMessage={savedDraftMessage}
          loadingEmail={loadingEmail}
          loadEmailMessage={loadEmailMessage}
          viewingSentEmail={pastEmails.find((pe) => pe.email_id === selectedSavedEmailId)?.email_type === 'sent'}
          saveEmailDisabled={(() => {
            // Dropdown-selected sent email
            if (pastEmails.find((pe) => pe.email_id === selectedSavedEmailId)?.email_type === 'sent') return true;
            // Loaded email tracking
            if (loadedEmailType && loadedEmailOriginal && email) {
              if (loadedEmailType === 'sent') return true;
              // Draft: disabled until content is modified
              return email.subject === loadedEmailOriginal.subject &&
                     email.plain_text === loadedEmailOriginal.plain_text;
            }
            return false;
          })()}
        />
        <GuardrailValidation
          result={guardrailResult}
          validating={guardrailValidating}
          cached={guardrailCached}
          contentChanged={(() => {
            if (!guardrailResult || !email) return false;
            const str = email.subject + "\x00" + email.plain_text;
            let h = 5381;
            for (let i = 0; i < str.length; i++) {
              h = ((h << 5) + h + str.charCodeAt(i)) | 0;
            }
            return String(h >>> 0) !== guardrailContentHash;
          })()}
          onConfirmSend={handleConfirmSend}
          onRetry={() => handleValidateEmail(true)}
          onAutoFix={handleAutoFix}
          fixing={fixing}
        />
        <EmailPreview
          email={email}
          properties={properties}
          onPropertyClick={(p) => setModalProperty(p)}
          pastEmails={pastEmails}
          initialTab={emailInitialTab}
          showCurrentEmailOption={emailIsGenerated}
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
