// Implements: docs/design/overhaul-plan.md §3 — the combobox contract W1 gates on: combobox
// ARIA wiring, keyboard-only navigation, 44px rows, matched-character highlight, an explicit
// empty state, and "no fetch while typing". AGENTS.md §2 Rule 10 (WCAG 2.1 AA combobox
// pattern), Rule 2 (ranking is local — the box takes candidates, never a loader).

import { describe, expect, it, vi } from "vitest";
import React, { useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { StudentSearchBox } from "./student-search-box";

// "ash" scores 88 on the two rows that contain it; the tie-break chain puts the shorter
// text first, so the ranked order is Ashim Dey then Asha Menon. "Ajay S. Menon" has no
// 'h' and does not match at all.
const CANDIDATES = [
  { item: "s1", text: "Asha Menon STU-0001", meta: "STU-0001" },
  { item: "s2", text: "Ajay S. Menon STU-0002", meta: "STU-0002" },
  { item: "s3", text: "Ashim Dey STU-0003", meta: "STU-0003" },
];

/** A controlled parent, so the debounce and the prop round-trip are exercised. */
function Harness({
  onSelect,
  emptyLabel,
  error = null,
  candidates = CANDIDATES,
}: {
  onSelect: (item: string) => void;
  emptyLabel?: string;
  error?: string | null;
  candidates?: typeof CANDIDATES;
}) {
  const [value, setValue] = useState("");
  return (
    <>
      <StudentSearchBox
        label="Find a student"
        value={value}
        onValueChange={setValue}
        onSelect={onSelect}
        candidates={candidates}
        placeholder="Search students"
        emptyLabel={emptyLabel}
        error={error}
      />
      <span data-testid="parent-value">{value}</span>
    </>
  );
}

function openBox(query = "ash") {
  const input = screen.getByRole("combobox", { name: "Find a student" });
  // A real `.focus()` (not a synthetic event) so the ARIA focus assertions below reflect
  // what a keyboard user gets; wrapped in act because it runs the component's onFocus.
  act(() => {
    input.focus();
  });
  if (query !== "") fireEvent.change(input, { target: { value: query } });
  return input;
}

describe("StudentSearchBox", () => {
  it("exposes the combobox pattern", () => {
    render(<Harness onSelect={() => {}} />);
    const input = screen.getByRole("combobox", { name: "Find a student" });

    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).toHaveAttribute("aria-controls");
    expect(input).not.toHaveAttribute("aria-activedescendant");

    openBox();
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(input.getAttribute("aria-activedescendant")).toBeTruthy();
  });

  it("does not open a full-roster list on focus alone", () => {
    render(<Harness onSelect={() => {}} />);
    const input = openBox("");

    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("renders every ranked candidate once a query exists", () => {
    render(<Harness onSelect={() => {}} />);
    openBox();

    const listbox = screen.getByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("Ashim Dey STU-0003");
    expect(options[1]).toHaveTextContent("Asha Menon STU-0001");
  });

  it("marks every matched character", () => {
    render(<Harness onSelect={() => {}} />);
    openBox("mn");

    const listbox = screen.getByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    // "Asha Menon STU-0001": 'M' and 'n' are far apart, so two runs must be marked.
    const marks = options[0]?.querySelectorAll("mark") ?? [];
    expect(marks.length).toBe(2);
    expect([...marks].map((mark) => mark.textContent)).toEqual(["M", "n"]);
    // Splitting into spans must not change the rendered text.
    expect(options[0]?.textContent).toContain("Asha Menon STU-0001");
  });

  it("announces the match count politely", () => {
    render(<Harness onSelect={() => {}} />);
    openBox("ash");

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status.textContent).toContain("2 of 3");
  });

  it("moves the active row with ArrowDown / ArrowUp without moving DOM focus", () => {
    render(<Harness onSelect={() => {}} />);
    const input = openBox();

    const first = input.getAttribute("aria-activedescendant");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const second = input.getAttribute("aria-activedescendant");
    expect(second).not.toBe(first);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const third = input.getAttribute("aria-activedescendant");
    expect(third).not.toBe(second);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("aria-activedescendant")).toBe(second);
    expect(document.activeElement).toBe(input);
  });

  it("jumps to the ends with Home / End", () => {
    render(<Harness onSelect={() => {}} />);
    const input = openBox();

    fireEvent.keyDown(input, { key: "End" });
    const last = input.getAttribute("aria-activedescendant");
    fireEvent.keyDown(input, { key: "Home" });
    const home = input.getAttribute("aria-activedescendant");
    expect(home).not.toBe(last);
    expect(last).toBeTruthy();
  });

  it("selects the active row with Enter and closes the list", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const input = openBox();

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("s3");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("selects with the mouse without blurring first", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    openBox();

    const option = within(screen.getByRole("listbox")).getAllByRole("option")[1] as HTMLElement;
    fireEvent.mouseDown(option);

    expect(onSelect).toHaveBeenCalledWith("s1");
  });

  it("clears on the first Escape and closes on the second", () => {
    render(<Harness onSelect={() => {}} />);
    const input = openBox("ash");

    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("");
    fireEvent.change(input, { target: { value: "ash" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("debounces what it pushes to the controlled parent and issues no request", () => {
    vi.useFakeTimers();
    try {
      render(<Harness onSelect={() => {}} />);
      const input = screen.getByRole("combobox", { name: "Find a student" });
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "a" } });
      fireEvent.change(input, { target: { value: "as" } });
      fireEvent.change(input, { target: { value: "ash" } });

      expect(screen.getByTestId("parent-value").textContent).toBe("");
      act(() => {
        vi.advanceTimersByTime(120);
      });
      expect(screen.getByTestId("parent-value").textContent).toBe("ash");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows an explicit empty state naming the query", () => {
    render(<Harness onSelect={() => {}} emptyLabel="No student matches ‘xyz’" />);
    openBox("xyz");

    expect(screen.getByText("No student matches ‘xyz’")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("surfaces a typed error verbatim and never leaks driver text", () => {
    render(<Harness onSelect={() => {}} error="UPSTREAM: database request failed — retry" />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "UPSTREAM: database request failed — retry",
    );
  });

  it("gives every option row a 44px minimum target", () => {
    render(<Harness onSelect={() => {}} />);
    openBox();

    for (const option of screen.getAllByRole("option")) {
      expect(option.className).toContain("min-h-[44px]");
    }
  });
});