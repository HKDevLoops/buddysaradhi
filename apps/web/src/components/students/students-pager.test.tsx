// Implements: 05_Students.md §Master List — roster paging.
//
// SEAMS UNDER TEST (agreed before writing; these are the public interfaces, not internals):
//
//   S1 — `pageWindow(input)`: the pager's own arithmetic. The question a tutor asks is
//        "which slice am I looking at, and is there more?" and the value it returns is
//        what the screen renders. Asserted through worked examples taken from the
//        spec's own arithmetic, never recomputed with the same expression the code uses.
//
//   S2 — `<StudentsPager>` as rendered DOM: what a tutor (or a screen reader) can read
//        and press. Asserted through roles, accessible names and visible text, so the
//        test survives a restyle.
//
// Not tested here, deliberately: the toolbar's export loop and the client's query wiring.
// Those belong to different slices; this file owns paging only.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StudentsPager, pageWindow } from "./students-pager";

describe("S1 · pageWindow — which slice of the roster is on screen", () => {
  // Worked examples. 200 students at 50 per page is the case the defect was reported on:
  // 150 of them were unreachable.
  it("counts the pages in a 200-student roster at 50 rows per page", () => {
    const win = pageWindow({ page: 1, pageSize: 50, total: 200 });

    expect(win.pageCount).toBe(4);
    expect(win.first).toBe(1);
    expect(win.last).toBe(50);
    expect(win.prevDisabled).toBe(true);
    expect(win.nextDisabled).toBe(false);
  });

  it("reports the middle slice by its real row numbers, not its page number", () => {
    const win = pageWindow({ page: 2, pageSize: 50, total: 200 });

    expect(win.first).toBe(51);
    expect(win.last).toBe(100);
  });

  it("stops the last page at the last row when the page is not full", () => {
    const win = pageWindow({ page: 3, pageSize: 50, total: 120 });

    expect(win.pageCount).toBe(3);
    expect(win.first).toBe(101);
    expect(win.last).toBe(120);
    expect(win.prevDisabled).toBe(false);
    // A 20-row final page must not read as "there are more".
    expect(win.nextDisabled).toBe(true);
  });

  it("has no next page when everything fits on one page", () => {
    const win = pageWindow({ page: 1, pageSize: 50, total: 12 });

    expect(win.pageCount).toBe(1);
    expect(win.first).toBe(1);
    expect(win.last).toBe(12);
    expect(win.prevDisabled).toBe(true);
    expect(win.nextDisabled).toBe(true);
  });

  it("clamps a page left past the end back to the last real page", () => {
    // What a filter change or a delete leaves behind.
    const win = pageWindow({ page: 9, pageSize: 50, total: 120 });

    expect(win.clampedPage).toBe(3);
    expect(win.isClamped).toBe(true);
    expect(win.first).toBe(101);
    expect(win.last).toBe(120);
  });

  it("clamps a page below one up to the first page", () => {
    const win = pageWindow({ page: 0, pageSize: 50, total: 200 });

    expect(win.clampedPage).toBe(1);
    expect(win.isClamped).toBe(true);
  });

  it("reports an empty roster as page 1 of 1 with no rows shown", () => {
    const win = pageWindow({ page: 1, pageSize: 50, total: 0 });

    expect(win.pageCount).toBe(1);
    expect(win.first).toBe(0);
    expect(win.last).toBe(0);
    expect(win.prevDisabled).toBe(true);
    expect(win.nextDisabled).toBe(true);
  });

  it("does not clamp when the page is real", () => {
    const win = pageWindow({ page: 4, pageSize: 50, total: 200 });

    expect(win.isClamped).toBe(false);
    expect(win.clampedPage).toBe(4);
  });
});

describe("S2 · StudentsPager — what the tutor can read and press", () => {
  function renderPager(overrides: Partial<Parameters<typeof StudentsPager>[0]> = {}) {
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();
    render(
      <StudentsPager
        page={2}
        pageSize={50}
        total={200}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        {...overrides}
      />,
    );
    return { onPageChange, onPageSizeChange };
  }

  it("tells the tutor which rows of the roster they are looking at", () => {
    renderPager();

    // Screen readers get this too: the range is the one changing piece on a page turn.
    expect(screen.getByText("Showing 51–100 of 200")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("Page 2 of 4")).toBeInTheDocument();
  });

  it("moves forward one page and back one page, never further", async () => {
    const user = userEvent.setup();
    const { onPageChange } = renderPager();

    await user.click(screen.getByRole("button", { name: "Next page of students" }));
    expect(onPageChange).toHaveBeenLastCalledWith(3);

    await user.click(screen.getByRole("button", { name: "Previous page of students" }));
    expect(onPageChange).toHaveBeenLastCalledWith(1);
  });

  it("will not offer a page past the end of the roster", () => {
    renderPager({ page: 4 });

    expect(screen.getByRole("button", { name: "Next page of students" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous page of students" })).toBeEnabled();
    expect(screen.getByText("Showing 151–200 of 200")).toBeInTheDocument();
  });

  it("will not offer a page before the start of the roster", () => {
    renderPager({ page: 1 });

    expect(screen.getByRole("button", { name: "Previous page of students" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page of students" })).toBeEnabled();
  });

  it("holds position while a page request is in flight", () => {
    // A second click mid-flight would skip a page the tutor never saw.
    renderPager({ isFetching: true });

    expect(screen.getByRole("button", { name: "Next page of students" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous page of students" })).toBeDisabled();
  });

  it("shows the row count as a labelled choice, so the tutor can change page size", async () => {
    const user = userEvent.setup();
    const { onPageSizeChange } = renderPager();

    const select = screen.getByLabelText("Rows");
    expect(select).toHaveValue("50");

    await user.selectOptions(select, "100");
    expect(onPageSizeChange).toHaveBeenLastCalledWith(100);
  });

  it("says so plainly when the roster is empty instead of counting from one", () => {
    renderPager({ total: 0, page: 1 });

    expect(screen.getByText("No students to show")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
  });
});