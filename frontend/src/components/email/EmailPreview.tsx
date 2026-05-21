import { useState, useRef, useEffect } from "react";
import { Loader2, Sparkles, Trash2, X } from "lucide-react";
import type { GeneratedEmail, PastEmail, Property } from "../../types";

interface EmailPreviewProps {
  email: GeneratedEmail | null;
  properties: Property[];
  onPropertyClick: (property: Property) => void;
  pastEmails?: PastEmail[];
  onUpdatePlainText?: (text: string) => void;
  onRefineWithAI?: (
    subject: string,
    plainText: string,
    prompt: string,
    previousEmail?: { subject: string; plain_text: string; saved_at?: string } | null
  ) => Promise<{ subject: string; plain_text: string }>;
  onUpdateSubject?: (subject: string) => void;
  onSelectPastEmail?: (emailId: number | null) => void;
  onDeleteSavedEmail?: (emailId: number) => void;
  initialTab?: "html" | "plain";
  showCurrentEmailOption?: boolean;
}

// Script injected into the iframe to intercept link clicks
const CLICK_INTERCEPTOR = `
<script>
document.addEventListener('click', function(e) {
  var link = e.target.closest('a');
  if (!link) return;
  e.preventDefault();
  e.stopPropagation();

  var href = link.getAttribute('href') || '';

  // Check for #property:{id} format first
  var match = href.match(/^#property:(.+)$/);
  if (match) {
    window.parent.postMessage({
      type: 'xome-property-click',
      propertyId: match[1]
    }, '*');
    return;
  }

  // Fallback: walk up the DOM for context text
  var linkText = link.innerText || '';
  var contextText = '';
  var node = link.parentElement;

  for (var i = 0; i < 8 && node && node !== document.body; i++) {
    var text = node.innerText || '';
    if (text.length > linkText.length + 30) {
      contextText = text;
      break;
    }
    node = node.parentElement;
  }

  if (!contextText && node) {
    contextText = node.innerText || '';
  }

  window.parent.postMessage({
    type: 'xome-property-click',
    context: contextText,
    linkText: linkText
  }, '*');
});
</script>
`;

export default function EmailPreview({
  email,
  properties,
  onPropertyClick,
  pastEmails = [],
  onUpdatePlainText,
  onRefineWithAI,
  onUpdateSubject,
  onSelectPastEmail,
  onDeleteSavedEmail,
  initialTab,
  showCurrentEmailOption = true,
}: EmailPreviewProps) {
  const [tab, setTab] = useState<"html" | "plain">("html");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [viewingPast, setViewingPast] = useState(false);
  const [viewingPastText, setViewingPastText] = useState("");
  const [viewingPastSubject, setViewingPastSubject] = useState("");
  const [viewingPastType, setViewingPastType] = useState<'sent' | 'saved' | null>(null);
  const [draftSubject, setDraftSubject] = useState("");
  const [showRefineBar, setShowRefineBar] = useState(false);
  const [refinePrompt, setRefinePrompt] = useState("");
  const [refining, setRefining] = useState(false);

  // Track which email_id we're currently viewing in the dropdown
  const [viewingPastEmailId, setViewingPastEmailId] = useState<number | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Reset editing/viewing state when email changes (new generation)
  useEffect(() => {
    setEditing(false);
    setViewingPast(false);
    setViewingPastText("");
    setViewingPastSubject("");
    setViewingPastType(null);
    setViewingPastEmailId(null);
    setShowDeleteConfirm(false);
    setDraftSubject("");
    setShowRefineBar(false);
    setRefinePrompt("");
    setRefining(false);
  }, [email]);

  // Switch tab when initialTab prop changes
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  // When pastEmails list changes (after send/save/draft), reset if viewed email is gone
  useEffect(() => {
    if (!viewingPast) return;
    if (viewingPastEmailId != null) {
      const stillExists = pastEmails.some((pe) => pe.email_id === viewingPastEmailId);
      if (!stillExists) {
        setViewingPast(false);
        setViewingPastText("");
        setViewingPastSubject("");
        setViewingPastType(null);
        setViewingPastEmailId(null);
        setEditing(false);
        onSelectPastEmail?.(null);
      }
    }
  }, [pastEmails]); // eslint-disable-line react-hooks/exhaustive-deps

  // Write HTML into the iframe with click interceptor
  useEffect(() => {
    if (tab === "html" && iframeRef.current && email?.html) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(email.html + CLICK_INTERCEPTOR);
        doc.close();
      }
    }
  }, [tab, email?.html]);

  // Listen for postMessage from iframe and match to a property
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.data?.type !== "xome-property-click") return;

      // Exact match by property_id from href="#property:{id}"
      if (e.data.propertyId) {
        const exact = properties.find((p) => p.property_id === e.data.propertyId);
        if (exact) {
          onPropertyClick(exact);
          return;
        }
      }

      // Fallback: match by address in context text
      const context: string = e.data.context || "";
      let bestMatch: Property | null = null;
      let bestPos = -1;
      for (const p of properties) {
        const pos = context.lastIndexOf(p.address);
        if (pos !== -1 && pos > bestPos) {
          bestPos = pos;
          bestMatch = p;
        }
      }

      if (bestMatch) {
        onPropertyClick(bestMatch);
      } else {
        const fallback = properties.find(
          (p) => context.includes(p.neighborhood) || context.includes(p.city)
        );
        if (fallback) onPropertyClick(fallback);
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [properties, onPropertyClick]);

  if (!email) return null;

  const handleDropdownChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === "") return; // "Load past email..." placeholder
    if (value === "__current__") {
      // Go back to current email view
      setViewingPast(false);
      setViewingPastText("");
      setViewingPastSubject("");
      setViewingPastType(null);
      setViewingPastEmailId(null);
      setEditing(false);
      setShowRefineBar(false);
      setRefinePrompt("");
      onSelectPastEmail?.(null);
    } else {
      const idx = parseInt(value, 10);
      const past = pastEmails[idx];
      if (past) {
        setViewingPast(true);
        setViewingPastText(past.plain_text);
        setViewingPastSubject(past.subject);
        setViewingPastType(past.email_type || 'sent');
        setViewingPastEmailId(past.email_id ?? null);
        setEditing(false);
        setShowRefineBar(false);
        setRefinePrompt("");
        onSelectPastEmail?.(past.email_id ?? null);
      }
    }
  };

  const handleEdit = () => {
    if (viewingPast && viewingPastType === 'saved') {
      setDraftText(viewingPastText);
      setDraftSubject(viewingPastSubject);
    } else {
      setDraftText(email.plain_text);
      setDraftSubject(email.subject);
    }
    setEditing(true);
  };

  const handleSave = () => {
    if (viewingPast && viewingPastType === 'saved') {
      // Update the viewed saved email text in place
      setViewingPastText(draftText);
      setViewingPastSubject(draftSubject);
      // Also push changes to the parent so they persist
      if (onUpdatePlainText) onUpdatePlainText(draftText);
      if (onUpdateSubject) onUpdateSubject(draftSubject);
    } else {
      if (onUpdatePlainText) onUpdatePlainText(draftText);
      if (onUpdateSubject && draftSubject !== email.subject) onUpdateSubject(draftSubject);
    }
    setEditing(false);
    setShowRefineBar(false);
    setRefinePrompt("");
  };

  const handleCancel = () => {
    setEditing(false);
    if (viewingPast && viewingPastType === 'saved') {
      // Restore draft to saved email values
      setDraftSubject(viewingPastSubject);
    } else {
      setDraftSubject("");
    }
    setShowRefineBar(false);
    setRefinePrompt("");
  };

  const handleApplyRefine = async () => {
    if (!onRefineWithAI || !email || !refinePrompt.trim()) return;
    setRefining(true);
    try {
      const recentPast = pastEmails.length > 0
        ? { subject: pastEmails[0].subject, plain_text: pastEmails[0].plain_text, saved_at: pastEmails[0].saved_at }
        : null;
      const result = await onRefineWithAI(
        draftSubject,
        draftText,
        refinePrompt.trim(),
        recentPast
      );
      setDraftText(result.plain_text);
      setDraftSubject(result.subject);
      setRefinePrompt("");
      setShowRefineBar(false);
    } catch (err) {
      console.error("Failed to refine email", err);
    } finally {
      setRefining(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* Subject */}
      <div className="border-b border-gray-200 px-5 py-3">
        <span className="text-xs font-medium text-gray-500">Subject:</span>{" "}
        {editing ? (
          <input
            type="text"
            value={draftSubject}
            onChange={(e) => setDraftSubject(e.target.value)}
            className="ml-1 inline-block w-[calc(100%-60px)] rounded border border-gray-300 px-2 py-0.5 text-sm font-medium text-gray-900 focus:border-xome-500 focus:outline-none focus:ring-1 focus:ring-xome-500"
          />
        ) : (
          <span className="font-medium text-gray-900">
            {viewingPast ? viewingPastSubject : email.subject}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setTab("html")}
          className={`px-5 py-2.5 text-sm font-medium transition ${
            tab === "html"
              ? "border-b-2 border-xome-600 text-xome-700"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          HTML Preview
        </button>
        <button
          onClick={() => setTab("plain")}
          className={`px-5 py-2.5 text-sm font-medium transition ${
            tab === "plain"
              ? "border-b-2 border-xome-600 text-xome-700"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Plain Text
        </button>
      </div>

      {/* Content */}
      <div className="p-1">
        {tab === "html" ? (
          <iframe
            ref={iframeRef}
            title="Email preview"
            className="h-[500px] w-full border-0"
            sandbox="allow-same-origin allow-scripts"
          />
        ) : (
          <div>
            {/* Toolbar */}
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
              <select
                key={pastEmails.map((pe) => `${pe.email_id ?? ''}_${pe.email_type}`).join(',')}
                onChange={handleDropdownChange}
                defaultValue={showCurrentEmailOption ? "__current__" : "0"}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 focus:border-xome-500 focus:outline-none focus:ring-1 focus:ring-xome-500"
              >
                {showCurrentEmailOption && (
                  <option value="__current__">Current email</option>
                )}
                {pastEmails.map((pe, i) => (
                  <option key={i} value={i}>
                    {pe.email_type === 'saved'
                      ? `saved_email_${pe.saved_at.replace(/[: ]/g, "_")}`
                      : `email_sent_on_${pe.saved_at.replace(/[: ]/g, "_")}`}
                  </option>
                ))}
              </select>
              {(!viewingPast || viewingPastType === 'saved') && (
                <div className="flex gap-2">
                  {editing ? (
                    <>
                      {onRefineWithAI && (
                        <button
                          onClick={() => setShowRefineBar((v) => !v)}
                          className="flex items-center gap-1 rounded bg-gradient-to-r from-purple-600 to-indigo-600 px-3 py-1 text-xs font-medium text-white transition hover:from-purple-700 hover:to-indigo-700"
                        >
                          <Sparkles className="h-3 w-3" />
                          Refine with AI
                        </button>
                      )}
                      <button
                        onClick={handleCancel}
                        className="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSave}
                        className="rounded bg-xome-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-xome-700"
                      >
                        Save
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={handleEdit}
                        className="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
                      >
                        Edit
                      </button>
                      {viewingPast && viewingPastType === 'saved' && onDeleteSavedEmail && viewingPastEmailId != null && (
                        <button
                          onClick={() => setShowDeleteConfirm(true)}
                          className="flex items-center gap-1 rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                        >
                          <Trash2 className="h-3 w-3" />
                          Delete
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Refine with AI prompt bar */}
            {editing && showRefineBar && (
              <div className="flex items-center gap-2 border-b border-gray-100 bg-purple-50 px-4 py-2">
                <input
                  type="text"
                  value={refinePrompt}
                  onChange={(e) => setRefinePrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !refining) handleApplyRefine();
                  }}
                  placeholder="e.g. make it shorter and more urgent"
                  className="flex-1 rounded border border-purple-200 bg-white px-3 py-1.5 text-sm text-gray-700 placeholder-gray-400 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                  disabled={refining}
                />
                <button
                  onClick={handleApplyRefine}
                  disabled={refining || !refinePrompt.trim()}
                  className="flex items-center gap-1.5 rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-purple-700 disabled:opacity-50"
                >
                  {refining && <Loader2 className="h-3 w-3 animate-spin" />}
                  {refining ? "Refining..." : "Apply"}
                </button>
                <button
                  onClick={() => {
                    setShowRefineBar(false);
                    setRefinePrompt("");
                  }}
                  className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Text area (editing current/saved) or read-only pre */}
            {viewingPast && !editing ? (
              <pre className="max-h-[500px] overflow-auto whitespace-pre-wrap p-4 text-sm text-gray-500 bg-gray-50">
                {viewingPastText}
              </pre>
            ) : editing ? (
              <textarea
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                className="h-[500px] w-full resize-none p-4 text-sm text-gray-700 font-mono focus:outline-none"
              />
            ) : (
              <pre className="max-h-[500px] overflow-auto whitespace-pre-wrap p-4 text-sm text-gray-700">
                {email.plain_text}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="rounded-lg bg-white p-6 shadow-xl max-w-sm w-full mx-4">
            <h3 className="text-base font-semibold text-gray-900 mb-2">Delete saved email?</h3>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to delete this saved email? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (onDeleteSavedEmail && viewingPastEmailId != null) {
                    onDeleteSavedEmail(viewingPastEmailId);
                    setShowDeleteConfirm(false);
                    setViewingPast(false);
                    setViewingPastText("");
                    setViewingPastSubject("");
                    setViewingPastType(null);
                    setViewingPastEmailId(null);
                    setEditing(false);
                    onSelectPastEmail?.(null);
                  }
                }}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
