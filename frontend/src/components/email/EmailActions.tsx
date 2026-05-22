import { Send, Mail, Loader2, Save, FolderOpen } from "lucide-react";
import type { GeneratedEmail } from "../../types";

interface EmailActionsProps {
  selectedUserId: string;
  properties: { length: number };
  email: GeneratedEmail | null;
  onGenerate: () => void;
  onSave: () => void;
  onSaveDraft: () => void;
  onLoadEmail: () => void;
  generating: boolean;
  saving: boolean;
  savedMessage: string;
  savingDraft: boolean;
  savedDraftMessage: string;
  loadingEmail: boolean;
  loadEmailMessage: string;
  viewingSentEmail?: boolean;
  saveEmailDisabled?: boolean;
}

export default function EmailActions({
  selectedUserId,
  properties,
  email,
  onGenerate,
  onSave,
  onSaveDraft,
  onLoadEmail,
  generating,
  saving,
  savedMessage,
  savingDraft,
  savedDraftMessage,
  loadingEmail,
  loadEmailMessage,
  viewingSentEmail,
  saveEmailDisabled,
}: EmailActionsProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={onGenerate}
        disabled={!selectedUserId || properties.length === 0 || generating}
        className="flex items-center gap-2 rounded-md bg-xome-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-xome-700 disabled:opacity-50"
      >
        {generating ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Mail className="h-4 w-4" />
        )}
        {generating ? "Generating..." : "Generate Email"}
      </button>

      <button
        onClick={onSaveDraft}
        disabled={!email || savingDraft || saveEmailDisabled}
        className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-50"
      >
        {savingDraft ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Save className="h-4 w-4" />
        )}
        {savingDraft ? "Saving..." : "Save Email"}
      </button>

      <button
        onClick={onLoadEmail}
        disabled={!selectedUserId || properties.length === 0 || loadingEmail}
        className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-50"
      >
        {loadingEmail ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <FolderOpen className="h-4 w-4" />
        )}
        {loadingEmail ? "Loading..." : "Load Email"}
      </button>

      <button
        onClick={onSave}
        disabled={!email || saving || viewingSentEmail}
        className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-50"
      >
        {saving ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
        {saving ? "Validating..." : "Validate & Send"}
      </button>

      {loadEmailMessage && (
        <span className="text-xs text-amber-600 font-medium">
          {loadEmailMessage}
        </span>
      )}
      {savedDraftMessage && (
        <span className="text-xs text-green-600 font-medium">
          {savedDraftMessage}
        </span>
      )}
      {savedMessage && (
        <span className="text-xs text-green-600 font-medium">
          {savedMessage}
        </span>
      )}
    </div>
  );
}
