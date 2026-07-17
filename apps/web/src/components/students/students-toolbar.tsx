"use client";

// Implements: UI/03_Component_Library.md §11 Form Input + Toolbar
// Standard toolbar aligned with the dynamic palette custom properties.

import { useStudentsStore } from "@/stores/students-store";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Filter, Download, MoreHorizontal } from "lucide-react";

export function StudentsToolbar() {
  const { searchQuery, setSearchQuery, filters, bulkSelectedIds } = useStudentsStore();

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  return (
    <div
      className="flex items-center justify-between gap-4 p-4 rounded-xl"
      style={{
        background: "var(--surface-glass)",
        backdropFilter: "blur(20px) saturate(140%)",
        border: "1px solid var(--border-glass)",
      }}
    >
      <div className="flex-1 flex items-center gap-3">
        <div className="relative max-w-sm w-full">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
            style={{ color: "var(--text-muted)" }}
            aria-hidden="true"
          />
          <Input
            placeholder="Search by name, phone or code..."
            className="pl-9 h-9"
            style={{
              background: "var(--bg-surface-inset)",
              border: "1px solid var(--border-default)",
              color: "var(--text-primary)",
            }}
            value={searchQuery}
            onChange={handleSearchChange}
          />
        </div>

        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-2"
          style={{
            border: "1px solid var(--border-default)",
            background: "var(--bg-surface-raised)",
            color: "var(--text-primary)",
          }}
        >
          <Filter className="w-4 h-4" />
          Filters
          {filters.status.length > 0 && filters.status.length !== 4 && (
            <span
              className="ml-1 w-2 h-2 rounded-full"
              style={{ background: "var(--accent-primary)" }}
            />
          )}
        </Button>
      </div>

      <div className="flex items-center gap-3">
        {bulkSelectedIds.length > 0 && (
          <div
            className="flex items-center gap-2 mr-4 text-sm font-medium"
            style={{ color: "var(--accent-primary)" }}
          >
            <span>{bulkSelectedIds.length} selected</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              style={{ color: "var(--text-primary)" }}
            >
              Actions
            </Button>
          </div>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          style={{ color: "var(--text-secondary)" }}
        >
          <Download className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          style={{ color: "var(--text-secondary)" }}
        >
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
