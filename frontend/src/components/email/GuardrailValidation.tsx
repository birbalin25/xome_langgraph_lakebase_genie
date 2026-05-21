import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Send,
} from "lucide-react";
import type { GuardrailValidationResult } from "../../types";

interface GuardrailValidationProps {
  result: GuardrailValidationResult | null;
  validating: boolean;
  cached: boolean;
  contentChanged: boolean;
  onConfirmSend: () => void;
  onRetry: () => void;
}

function severityColor(score: number): string {
  if (score <= 25) return "bg-green-100 text-green-700";
  if (score <= 50) return "bg-amber-100 text-amber-700";
  if (score <= 75) return "bg-orange-100 text-orange-700";
  return "bg-red-100 text-red-700";
}

function severityLabel(score: number): string {
  if (score <= 25) return "Low";
  if (score <= 50) return "Medium";
  if (score <= 75) return "High";
  return "Critical";
}

export default function GuardrailValidation({
  result,
  validating,
  cached,
  contentChanged,
  onConfirmSend,
  onRetry,
}: GuardrailValidationProps) {
  // Loading state
  if (validating) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-6">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-xome-600" />
          <div>
            <p className="text-sm font-medium text-gray-800">
              Running guardrail validation...
            </p>
            <p className="text-xs text-gray-500">
              Checking professional tone, toxicity, PII, and bias
            </p>
          </div>
        </div>
      </div>
    );
  }

  // No result yet — nothing to show
  if (!result) return null;

  // Parse error fallback
  if (result.parse_error) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          <p className="text-sm font-medium text-amber-800">
            Validation response could not be parsed. Please retry.
          </p>
          <button
            onClick={onRetry}
            className="ml-auto flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 transition hover:bg-amber-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Cache / content-change badge */}
      {cached && !contentChanged && (
        <div className="flex items-center gap-2 rounded-md bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">
          <Shield className="h-3.5 w-3.5" />
          Previously validated — no content changes detected
        </div>
      )}
      {contentChanged && (
        <div className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5" />
          Content updated — click "Validate & Send" to re-run validation checks
        </div>
      )}

      {/* 2x2 category cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {result.categories.map((cat) => (
          <div
            key={cat.name}
            className={`rounded-lg border p-3 ${
              cat.passed
                ? "border-green-200 bg-green-50/50"
                : "border-red-200 bg-red-50/50"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                {cat.passed ? (
                  <ShieldCheck className="h-4 w-4 text-green-600" />
                ) : (
                  <ShieldAlert className="h-4 w-4 text-red-600" />
                )}
                <span className="text-sm font-semibold text-gray-800">
                  {cat.label}
                </span>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${severityColor(
                  cat.severity_score
                )}`}
              >
                {severityLabel(cat.severity_score)} ({cat.severity_score})
              </span>
            </div>
            <p className="mt-1.5 text-xs text-gray-600">{cat.explanation}</p>
            {!cat.passed && cat.remediation && (
              <p className="mt-1 text-xs italic text-red-600">
                {cat.remediation}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Footer: aggregate + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
        <div className="flex items-center gap-3">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${severityColor(
              result.aggregate_score
            )}`}
          >
            Score: {result.aggregate_score}
          </span>
          <span className="text-xs text-gray-600">{result.summary}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Re-validate
          </button>
          {result.overall_passed && !contentChanged && (
            <button
              onClick={onConfirmSend}
              className="flex items-center gap-1.5 rounded-md bg-green-600 px-4 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-green-700"
            >
              <Send className="h-3.5 w-3.5" />
              Confirm & Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
