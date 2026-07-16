import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { registerGraphQL } from "./graphql";

describe("GraphQL Gateway Integration Tests", () => {
  const app = new Hono();
  registerGraphQL(app);

  const mockHeaders = {
    "Content-Type": "application/json",
    "X-Tutor-Id": "local-dev",
  };

  it("should query dashboard KPIs successfully", async () => {
    const query = `
      query GetKPIs {
        kpis {
          totalRevenue
          outstandingFees
          activeStudents
          attendanceRate
        }
      }
    `;

    const res = await app.request("/graphql", {
      method: "POST",
      headers: mockHeaders,
      body: JSON.stringify({ query }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.errors).toBeUndefined();
    expect(body.data?.kpis).toBeDefined();
    expect(typeof body.data.kpis.totalRevenue).toBe("number");
    expect(typeof body.data.kpis.outstandingFees).toBe("number");
    expect(typeof body.data.kpis.activeStudents).toBe("number");
    expect(typeof body.data.kpis.attendanceRate).toBe("number");
  });

  it("should query activity feed successfully", async () => {
    const query = `
      query GetActivityFeed {
        activityFeed {
          __typename
          ... on LedgerActivity {
            id
            type
            creditPaise
            debitPaise
            description
            occurredOn
            createdAt
          }
          ... on NotificationActivity {
            id
            category
            title
            body
            createdAt
          }
        }
      }
    `;

    const res = await app.request("/graphql", {
      method: "POST",
      headers: mockHeaders,
      body: JSON.stringify({ query }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.errors).toBeUndefined();
    expect(Array.isArray(body.data?.activityFeed)).toBe(true);

    if (body.data.activityFeed.length > 0) {
      const item = body.data.activityFeed[0];
      expect(item.id).toBeDefined();
      expect(item.__typename).toMatch(/LedgerActivity|NotificationActivity/);
    }
  });

  it("should query due today invoices successfully", async () => {
    const query = `
      query GetDueToday {
        dueToday {
          id
          number
          issueDate
          dueDate
          total
          status
          student {
            id
            firstName
            lastName
          }
        }
      }
    `;

    const res = await app.request("/graphql", {
      method: "POST",
      headers: mockHeaders,
      body: JSON.stringify({ query }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.errors).toBeUndefined();
    expect(Array.isArray(body.data?.dueToday)).toBe(true);

    if (body.data.dueToday.length > 0) {
      const invoice = body.data.dueToday[0];
      expect(invoice.number).toBeDefined();
      expect(invoice.student.firstName).toBeDefined();
    }
  });

  it("should query heatmaps successfully", async () => {
    const query = `
      query GetHeatmaps($start: String, $end: String) {
        heatmaps(startDate: $start, endDate: $end) {
          attendance {
            studentName
            weekStart
            cellStatus
            dueMinor
          }
          financial {
            studentName
            weekStart
            cellStatus
            dueMinor
          }
        }
      }
    `;

    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
    const end = today.toISOString();

    const res = await app.request("/graphql", {
      method: "POST",
      headers: mockHeaders,
      body: JSON.stringify({
        query,
        variables: { start, end },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.errors).toBeUndefined();
    expect(body.data?.heatmaps?.attendance).toBeDefined();
    expect(body.data?.heatmaps?.financial).toBeDefined();
    expect(Array.isArray(body.data.heatmaps.attendance)).toBe(true);
    expect(Array.isArray(body.data.heatmaps.financial)).toBe(true);
  });
});
