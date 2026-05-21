import { ChevronDown, Loader2, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { GenieColumn } from "../../types";

export interface OtfGenieData {
  columns: GenieColumn[];
  rows: (string | null)[][];
}

interface GenieResultTableProps {
  columns: GenieColumn[];
  rows: (string | null)[][];
  description: string;
  onViewRecommendations: (userIds: string[], models: string[], otfGenieData?: OtfGenieData, otfUserIds?: string[]) => void;
  onSelectProperty: (propertyId: string) => void;
  // Lifted OTF state (persists across view switches)
  otfColumns: GenieColumn[];
  otfRows: (string | null)[][];
  otfDescription: string;
  otfNlQuery: string;
  onOtfNlQueryChange: (query: string) => void;
  onOtfSearch: (query: string) => Promise<void>;
  onOtfClear: () => void;
  // Lifted checkbox selection state
  selectedUserIds: Set<string>;
  onSelectedUserIdsChange: (ids: Set<string>) => void;
}

/** Column names (case-insensitive) treated as user id columns. */
const USER_ID_NAMES = new Set(["user_id", "userid"]);

/** Column names (case-insensitive) treated as clickable property links. */
const PROPERTY_ID_NAMES = new Set(["property_id", "propertyid"]);

const MODEL_OPTIONS = ["Model A", "Model B", "On-the-fly-logic"] as const;

export default function GenieResultTable({
  columns,
  rows,
  description,
  onViewRecommendations,
  onSelectProperty,
  otfColumns,
  otfRows,
  otfDescription,
  otfNlQuery,
  onOtfNlQueryChange,
  onOtfSearch,
  onOtfClear,
  selectedUserIds,
  onSelectedUserIdsChange,
}: GenieResultTableProps) {
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set(MODEL_OPTIONS));
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [otfLoading, setOtfLoading] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  const setSelectedUserIds = onSelectedUserIdsChange;

  // Close model dropdown on outside click
  useEffect(() => {
    if (!modelDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [modelDropdownOpen]);

  if (columns.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border-2 border-dashed border-gray-200 text-gray-400">
        Use the search bar above to find users with Genie
      </div>
    );
  }

  // Detect columns for first table
  const userIdColIndex = columns.findIndex((c) => USER_ID_NAMES.has(c.name.toLowerCase()));
  const propertyIdColIndex = columns.findIndex((c) => PROPERTY_ID_NAMES.has(c.name.toLowerCase()));
  const hasUserIdColumn = userIdColIndex >= 0;

  // Detect columns for OTF table
  const otfUserIdColIndex = otfColumns.findIndex((c) => USER_ID_NAMES.has(c.name.toLowerCase()));
  const otfPropertyIdColIndex = otfColumns.findIndex((c) => PROPERTY_ID_NAMES.has(c.name.toLowerCase()));
  const otfHasUserIdColumn = otfUserIdColIndex >= 0;

  // Collect user IDs from both tables
  const firstTableUserIds: string[] = hasUserIdColumn
    ? rows.map((r) => r[userIdColIndex]).filter((v): v is string => v != null)
    : [];
  const otfTableUserIds: string[] = otfHasUserIdColumn
    ? otfRows.map((r) => r[otfUserIdColIndex]).filter((v): v is string => v != null)
    : [];

  // Per-table select-all state
  const firstAllSelected = firstTableUserIds.length > 0 && firstTableUserIds.every((id) => selectedUserIds.has(id));
  const firstSomeSelected = firstTableUserIds.some((id) => selectedUserIds.has(id)) && !firstAllSelected;
  const otfAllSelected = otfTableUserIds.length > 0 && otfTableUserIds.every((id) => selectedUserIds.has(id));
  const otfSomeSelected = otfTableUserIds.some((id) => selectedUserIds.has(id)) && !otfAllSelected;

  const toggleUser = (userId: string) => {
    const next = new Set(selectedUserIds);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    setSelectedUserIds(next);
  };

  const toggleAllForTable = (tableUserIds: string[], allSelected: boolean) => {
    const next = new Set(selectedUserIds);
    if (allSelected) {
      for (const id of tableUserIds) next.delete(id);
    } else {
      for (const id of tableUserIds) next.add(id);
    }
    setSelectedUserIds(next);
  };

  const handleModelToggle = (opt: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(opt)) {
        next.delete(opt);
        if (opt === "On-the-fly-logic") {
          onOtfClear();
        }
      } else {
        next.add(opt);
      }
      return next;
    });
  };

  const handleOtfSearchClick = async () => {
    if (!otfNlQuery.trim()) return;
    setOtfLoading(true);
    try {
      await onOtfSearch(otfNlQuery.trim());
    } finally {
      setOtfLoading(false);
    }
  };

  // Reusable table renderer
  const renderTable = (
    tableCols: GenieColumn[],
    tableRows: (string | null)[][],
    tableUserIdIdx: number,
    tablePropIdIdx: number,
    tableHasUserId: boolean,
    tableUserIds: string[],
    tableAllSelected: boolean,
    tableSomeSelected: boolean,
  ) => {
    if (tableRows.length === 0) {
      return (
        <div className="flex h-32 items-center justify-center rounded-lg border-2 border-dashed border-gray-200 text-gray-400">
          No results
        </div>
      );
    }

    return (
      <div className="overflow-auto rounded-lg border border-gray-200" style={{ maxHeight: "calc(12 * 37px + 37px)" }}>
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10 bg-gray-50">
            <tr>
              {tableHasUserId && (
                <th className="border-b border-gray-200 px-3 py-2">
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={tableAllSelected}
                      ref={(el) => { if (el) el.indeterminate = tableSomeSelected; }}
                      onChange={() => toggleAllForTable(tableUserIds, tableAllSelected)}
                      className="h-4 w-4 cursor-pointer rounded border-gray-300 text-xome-600 accent-xome-600"
                    />
                    <button
                      onClick={() => toggleAllForTable(tableUserIds, false)}
                      className="text-xs font-medium text-blue-600 hover:text-blue-800"
                    >
                      Select All
                    </button>
                    <span className="text-xs text-gray-300">|</span>
                    <button
                      onClick={() => toggleAllForTable(tableUserIds, true)}
                      className="text-xs font-medium text-blue-600 hover:text-blue-800"
                    >
                      Unselect All
                    </button>
                  </div>
                </th>
              )}
              {tableCols.map((col) => (
                <th
                  key={col.name}
                  className="whitespace-nowrap border-b border-gray-200 px-4 py-2 text-left font-semibold text-gray-700"
                >
                  {col.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row, ri) => {
              const userId = tableHasUserId ? row[tableUserIdIdx] : null;
              const isChecked = userId ? selectedUserIds.has(userId) : false;

              return (
                <tr key={ri} className={ri % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                  {tableHasUserId && (
                    <td className="border-b border-gray-100 px-3 py-2 text-center">
                      {userId && (
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleUser(userId)}
                          className="h-4 w-4 rounded border-gray-300 text-xome-600 accent-xome-600"
                        />
                      )}
                    </td>
                  )}
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className="whitespace-nowrap border-b border-gray-100 px-4 py-2 text-gray-800"
                    >
                      {ci === tablePropIdIdx && !tableHasUserId && cell ? (
                        <button
                          onClick={() => onSelectProperty(cell)}
                          className="text-blue-600 underline hover:text-blue-800"
                        >
                          {cell}
                        </button>
                      ) : (
                        (cell ?? "")
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const canSelectUsers = hasUserIdColumn || otfHasUserIdColumn;

  return (
    <div className="space-y-3">
      {/* Genie description */}
      {description && (
        <p className="text-sm text-gray-600">{description}</p>
      )}

      {/* Result count */}
      <div className="text-sm text-gray-500">
        {rows.length} {rows.length === 1 ? "row" : "rows"} returned
      </div>

      {/* First table (main Genie search results) */}
      {rows.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-lg border-2 border-dashed border-gray-200 text-gray-400">
          No results
        </div>
      ) : (
        renderTable(
          columns, rows, userIdColIndex, propertyIdColIndex,
          hasUserIdColumn, firstTableUserIds, firstAllSelected, firstSomeSelected
        )
      )}

      {/* Action bar — visible when first table has user_id column */}
      {hasUserIdColumn && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <span className="text-sm font-medium text-gray-700">
            {selectedUserIds.size} user{selectedUserIds.size !== 1 ? "s" : ""} selected
          </span>

          {/* Model dropdown with label */}
          <div className="relative" ref={modelDropdownRef}>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Select recommendation engine
            </label>
            <button
              onClick={() => setModelDropdownOpen((prev) => !prev)}
              className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm hover:bg-gray-50 focus:border-xome-500 focus:outline-none focus:ring-1 focus:ring-xome-500"
            >
              {selectedModels.size === MODEL_OPTIONS.length
                ? "All Models"
                : selectedModels.size === 0
                  ? "Select Models"
                  : Array.from(selectedModels).join(", ")}
              <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
            </button>
            {modelDropdownOpen && (
              <div className="absolute left-0 top-full z-20 mt-1 w-48 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
                {MODEL_OPTIONS.map((opt) => (
                  <label
                    key={opt}
                    className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedModels.has(opt)}
                      onChange={() => handleModelToggle(opt)}
                      className="h-4 w-4 rounded border-gray-300 text-xome-600 accent-xome-600"
                    />
                    {opt}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* OTF NL query input + Search button */}
          {selectedModels.has("On-the-fly-logic") && (
            <div className="flex flex-1 items-end gap-2 min-w-[200px]">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  On-the-Fly Logic query
                </label>
                <input
                  type="text"
                  value={otfNlQuery}
                  onChange={(e) => onOtfNlQueryChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleOtfSearchClick(); }}
                  placeholder="Enter a natural language query…"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm placeholder:text-gray-400 focus:border-xome-500 focus:outline-none focus:ring-1 focus:ring-xome-500"
                />
              </div>
              <button
                onClick={handleOtfSearchClick}
                disabled={!otfNlQuery.trim() || otfLoading}
                className="flex items-center gap-1.5 rounded-md bg-gray-700 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-gray-800 disabled:opacity-50"
              >
                {otfLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Search
              </button>
            </div>
          )}
        </div>
      )}

      {/* OTF results section */}
      {otfLoading && (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-xome-600" />
        </div>
      )}
      {!otfLoading && otfColumns.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-purple-700">On-the-Fly Logic Results</h3>
            <span className="text-sm text-gray-500">
              {otfRows.length} {otfRows.length === 1 ? "row" : "rows"} returned
            </span>
          </div>
          {otfDescription && <p className="text-sm text-gray-600">{otfDescription}</p>}
          {renderTable(
            otfColumns, otfRows, otfUserIdColIndex, otfPropertyIdColIndex,
            otfHasUserIdColumn, otfTableUserIds, otfAllSelected, otfSomeSelected
          )}
        </div>
      )}

      {/* View Recommended Properties — at the bottom */}
      {canSelectUsers && rows.length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={() => {
              setModelDropdownOpen(false);
              const otfSelected = selectedModels.has("On-the-fly-logic");
              const otfData =
                otfColumns.length > 0 && otfSelected
                  ? { columns: otfColumns, rows: otfRows }
                  : undefined;
              const otfUserIdSet = new Set(otfTableUserIds);
              const selectedOtfUserIds = otfSelected
                ? Array.from(selectedUserIds).filter((id) => otfUserIdSet.has(id))
                : [];
              onViewRecommendations(
                Array.from(selectedUserIds),
                Array.from(selectedModels),
                otfData,
                selectedOtfUserIds.length > 0 ? selectedOtfUserIds : undefined
              );
            }}
            disabled={selectedUserIds.size === 0 || selectedModels.size === 0}
            className="rounded-md bg-xome-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-xome-700 disabled:opacity-50"
          >
            View Recommended Properties
          </button>
        </div>
      )}
    </div>
  );
}
