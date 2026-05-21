import { useCallback, useEffect, useState } from "react";
import type {
  FilterOptions,
  FilterState,
  GenieColumn,
  Property,
} from "../../types";
import type { OtfGenieData } from "../genie/GenieResultTable";
import * as api from "../../api/campaign";
import FilterPanel from "../filters/FilterPanel";
import GenieSearchBar from "../genie/GenieSearchBar";
import GenieResultTable from "../genie/GenieResultTable";
import GenieUserDetail from "../genie/GenieUserDetail";
import GenieMultiUserDetail from "../genie/GenieMultiUserDetail";
import PropertyDetailModal from "../properties/PropertyDetailModal";
import Sidebar from "./Sidebar";

const INITIAL_FILTERS: FilterState = {
  city: "",
  state: "",
  property_type: "",
  segment: "",
  price_min: 0,
  price_max: 5_000_000,
  listing_count: 10,
};

export default function AppShell() {
  // ── Filter state ────────────────────────────
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);

  // ── Genie state ─────────────────────────────
  const [genieColumns, setGenieColumns] = useState<GenieColumn[]>([]);
  const [genieRows, setGenieRows] = useState<(string | null)[][]>([]);
  const [genieDescription, setGenieDescription] = useState("");
  const [genieLoading, setGenieLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [genieError, setGenieError] = useState("");

  // ── OTF results state (lifted so it persists across view switches) ──
  const [otfColumns, setOtfColumns] = useState<GenieColumn[]>([]);
  const [otfRows, setOtfRows] = useState<(string | null)[][]>([]);
  const [otfDescription, setOtfDescription] = useState("");
  const [otfNlQuery, setOtfNlQuery] = useState("");
  const [tableSelectedUserIds, setTableSelectedUserIds] = useState<Set<string>>(new Set());

  // ── View state ──────────────────────────────
  const [view, setView] = useState<"list" | "detail" | "multi-detail">("list");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [otfGenieData, setOtfGenieData] = useState<OtfGenieData | undefined>();
  const [otfUserIds, setOtfUserIds] = useState<string[]>([]);

  // ── Property modal state ──────────────────
  const [modalProperty, setModalProperty] = useState<Property | null>(null);

  // ── Load filter options on mount ────────────
  useEffect(() => {
    api.fetchFilters().then((opts) => {
      setFilterOptions(opts);
      setFilters((f) => ({
        ...f,
        price_min: opts.price_range.min,
        price_max: opts.price_range.max,
      }));
    });
  }, []);

  // ── Filter change handler ───────────────────
  const handleFilterChange = useCallback((patch: Partial<FilterState>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  // ── Genie query ─────────────────────────────
  const handleGenieQuery = useCallback(
    async (query: string) => {
      setGenieLoading(true);
      setGenieError("");
      try {
        const result = await api.queryGenie(query, conversationId);
        setGenieColumns(result.columns);
        setGenieRows(result.rows);
        setGenieDescription(result.description || "");
        setConversationId(result.conversation_id);
        // Clear OTF results and selections on new main search
        setOtfColumns([]);
        setOtfRows([]);
        setOtfDescription("");
        setOtfNlQuery("");
        setTableSelectedUserIds(new Set());
        if (result.error) {
          setGenieError(result.error);
        }
        setView("list");
      } catch (err) {
        console.error("Genie query failed", err);
        setGenieError(err instanceof Error ? err.message : "Query failed");
      } finally {
        setGenieLoading(false);
      }
    },
    [conversationId]
  );

  // ── New search (clear conversation) ─────────
  const handleNewSearch = useCallback(() => {
    setConversationId(null);
    setGenieColumns([]);
    setGenieRows([]);
    setGenieDescription("");
    setGenieError("");
    setOtfColumns([]);
    setOtfRows([]);
    setOtfDescription("");
    setOtfNlQuery("");
    setTableSelectedUserIds(new Set());
    setView("list");
  }, []);

  // ── OTF search handler ─────────────────────
  const handleOtfSearch = useCallback(
    async (query: string) => {
      setOtfNlQuery(query);
      try {
        const result = await api.queryGenie(query, null);
        setOtfColumns(result.columns);
        setOtfRows(result.rows);
        setOtfDescription(result.description || "");
      } catch (err) {
        console.error("OTF Genie query failed", err);
      }
    },
    []
  );

  // ── Clear OTF results ─────────────────────
  const handleOtfClear = useCallback(() => {
    setOtfColumns([]);
    setOtfRows([]);
    setOtfDescription("");
    setOtfNlQuery("");
  }, []);

  // ── Select user → detail view (kept for backward compat) ──
  const handleSelectUser = useCallback((userId: string) => {
    setSelectedUserId(userId);
    setView("detail");
  }, []);

  // ── Multi-user → multi-detail view ────────
  const handleViewRecommendations = useCallback(
    (userIds: string[], models: string[], otfData?: OtfGenieData, otfUids?: string[]) => {
      setSelectedUserIds(userIds);
      setSelectedModels(models);
      setOtfGenieData(otfData);
      setOtfUserIds(otfUids || []);
      setView("multi-detail");
    },
    []
  );

  // ── Select property → modal ────────────────
  const handleSelectProperty = useCallback(async (propertyId: string) => {
    try {
      const property = await api.fetchProperty(propertyId);
      setModalProperty(property);
    } catch (err) {
      console.error("Failed to fetch property", err);
    }
  }, []);

  // ── Back to list ────────────────────────────
  const handleBack = useCallback(() => {
    setView("list");
  }, []);

  // ── Apply filters (no-op on list view — filtering is client-side) ──
  const handleApplyFilters = useCallback(() => {
    // On detail view, this triggers a re-render of GenieUserDetail which
    // re-fetches listings because filters are passed as props.
  }, []);

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* Sidebar */}
      <Sidebar>
        <FilterPanel
          options={filterOptions}
          filters={filters}
          onChange={handleFilterChange}
          onSearch={handleApplyFilters}
          loading={false}
        />
      </Sidebar>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-7xl space-y-4">
          {/* Genie search bar */}
          <GenieSearchBar
            onSubmit={handleGenieQuery}
            loading={genieLoading}
            conversationId={conversationId}
            onNewSearch={handleNewSearch}
            error={genieError}
          />

          {/* View switching */}
          {view === "list" ? (
            <GenieResultTable
              columns={genieColumns}
              rows={genieRows}
              description={genieDescription}
              onViewRecommendations={handleViewRecommendations}
              onSelectProperty={handleSelectProperty}
              otfColumns={otfColumns}
              otfRows={otfRows}
              otfDescription={otfDescription}
              otfNlQuery={otfNlQuery}
              onOtfNlQueryChange={setOtfNlQuery}
              onOtfSearch={handleOtfSearch}
              onOtfClear={handleOtfClear}
              selectedUserIds={tableSelectedUserIds}
              onSelectedUserIdsChange={setTableSelectedUserIds}
            />
          ) : view === "multi-detail" ? (
            <GenieMultiUserDetail
              userIds={selectedUserIds}
              models={selectedModels}
              filters={filters}
              onBack={handleBack}
              otfGenieData={otfGenieData}
              otfUserIds={otfUserIds}
            />
          ) : (
            <GenieUserDetail
              userId={selectedUserId}
              filters={filters}
              onBack={handleBack}
            />
          )}
        </div>
      </main>

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
