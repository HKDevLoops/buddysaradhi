import type { Hono } from "hono";
import { createYoga, createSchema } from "graphql-yoga";
import { getContext } from "../lib/respond";
import { buildHeatmap } from "../lib/heatmap";
import { cacheGet, cacheSet } from "../cache";

const typeDefs = `
  type Query {
    kpis: DashboardKPIs!
    activityFeed: [ActivityItem!]!
    dueToday: [DueInvoice!]!
    heatmaps(startDate: String, endDate: String): Heatmaps!
  }

  type DashboardKPIs {
    totalRevenue: Float!
    outstandingFees: Float!
    activeStudents: Int!
    attendanceRate: Float!
  }

  union ActivityItem = LedgerActivity | NotificationActivity

  type LedgerActivity {
    id: ID!
    type: String!
    debitPaise: Float!
    creditPaise: Float!
    description: String
    occurredOn: String!
    createdAt: String!
  }

  type NotificationActivity {
    id: ID!
    category: String!
    title: String!
    body: String
    createdAt: String!
  }

  type DueInvoice {
    id: ID!
    number: String!
    issueDate: String!
    dueDate: String
    total: Float!
    status: String!
    student: StudentInfo!
  }

  type StudentInfo {
    id: ID!
    firstName: String!
    lastName: String
  }

  type HeatmapPoint {
    studentName: String!
    weekStart: String!
    cellStatus: String!
    dueMinor: Float!
  }

  type Heatmaps {
    attendance: [HeatmapPoint!]!
    financial: [HeatmapPoint!]!
  }
`;

const resolvers = {
  ActivityItem: {
    __resolveType(obj: any) {
      if (obj.__typename) {
        return obj.__typename;
      }
      if ("title" in obj) {
        return "NotificationActivity";
      }
      return "LedgerActivity";
    },
  },
  Query: {
    kpis: async (_parent: any, _args: any, context: any) => {
      const { db, tenantId } = context;
      const cacheKey = `graphql:${tenantId}:kpis`;
      const cached = await cacheGet(cacheKey);
      if (cached) return JSON.parse(cached);

      // 1. Total Revenue
      const ledgerSum = await db.ledgerEntry.aggregate({
        where: { tenantId, type: "PAYMENT_RECEIVED" },
        _sum: { creditPaise: true },
      });
      const totalRevenue = ledgerSum._sum.creditPaise ?? 0;

      // 2. Outstanding Fees
      const studentSum = await db.student.aggregate({
        where: { tenantId, status: "active", archivedAt: null, balancePaise: { gt: 0 } },
        _sum: { balancePaise: true },
      });
      const outstandingFees = studentSum._sum.balancePaise ?? 0;

      // 3. Active Students
      const activeStudents = await db.student.count({
        where: { tenantId, status: "active", archivedAt: null },
      });

      // 4. Attendance Rate
      const totalAttendance = await db.attendanceRecord.count({
        where: { tenantId, deletedAt: null },
      });
      const presentAttendance = await db.attendanceRecord.count({
        where: {
          tenantId,
          deletedAt: null,
          status: { in: ["present", "late"] },
        },
      });
      const attendanceRate = totalAttendance > 0 ? (presentAttendance / totalAttendance) * 100 : 100.0;

      const result = {
        totalRevenue,
        outstandingFees,
        activeStudents,
        attendanceRate,
      };
      await cacheSet(cacheKey, JSON.stringify(result));
      return result;
    },
    activityFeed: async (_parent: any, _args: any, context: any) => {
      const { db, tenantId } = context;
      const cacheKey = `graphql:${tenantId}:activityFeed`;
      const cached = await cacheGet(cacheKey);
      if (cached) return JSON.parse(cached);

      const notifications = await db.notification.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 20,
      });

      const ledger = await db.ledgerEntry.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 20,
      });

      const notifItems = notifications.map((n: any) => ({
        __typename: "NotificationActivity",
        id: n.id,
        category: n.category,
        title: n.title,
        body: n.body,
        createdAt: n.createdAt.toISOString(),
      }));

      const ledgerItems = ledger.map((e: any) => ({
        __typename: "LedgerActivity",
        id: e.id,
        type: e.type,
        debitPaise: e.debitPaise,
        creditPaise: e.creditPaise,
        description: e.description,
        occurredOn: e.occurredOn,
        createdAt: e.createdAt.toISOString(),
      }));

      const result = [...notifItems, ...ledgerItems].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      await cacheSet(cacheKey, JSON.stringify(result));
      return result;
    },
    dueToday: async (_parent: any, _args: any, context: any) => {
      const { db, tenantId } = context;
      const cacheKey = `graphql:${tenantId}:dueToday`;
      const cached = await cacheGet(cacheKey);
      if (cached) return JSON.parse(cached);

      const today = new Date().toISOString().slice(0, 10);

      const invoices = await db.invoice.findMany({
        where: {
          tenantId,
          status: { in: ["unpaid", "partial", "overdue"] },
          dueDate: { lte: today },
          deletedAt: null,
          voidedAt: null,
        },
        include: { student: true },
        orderBy: { dueDate: "asc" },
      });

      const result = invoices.map((inv: any) => ({
        id: inv.id,
        number: inv.number,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        total: inv.total,
        status: inv.status,
        student: {
          id: inv.student.id,
          firstName: inv.student.firstName,
          lastName: inv.student.lastName,
        },
      }));
      await cacheSet(cacheKey, JSON.stringify(result));
      return result;
    },
    heatmaps: async (_parent: any, args: any, context: any) => {
      const { db, tenantId } = context;
      const startDate = args.startDate || new Date(new Date().setDate(1)).toISOString();
      const endDate = args.endDate || new Date().toISOString();
      const cacheKey = `graphql:${tenantId}:heatmaps:${startDate}:${endDate}`;
      const cached = await cacheGet(cacheKey);
      if (cached) return JSON.parse(cached);

      const attendanceRows = await buildHeatmap(db, tenantId, startDate, endDate, "dues");
      const financialRows = await buildHeatmap(db, tenantId, startDate, endDate, "financial");

      const mapRow = (r: any) => ({
        studentName: r.student_name,
        weekStart: r.week_start,
        cellStatus: r.cell_status,
        dueMinor: r.due_minor,
      });

      const result = {
        attendance: attendanceRows.map(mapRow),
        financial: financialRows.map(mapRow),
      };
      await cacheSet(cacheKey, JSON.stringify(result));
      return result;
    },
  },
};

export function registerGraphQL(app: Hono) {
  const yoga = createYoga({
    schema: createSchema({
      typeDefs,
      resolvers,
    }),
    graphqlEndpoint: "/graphql",
  });

  // Hono handler routing standard fetch request/response to yoga
  app.all("/graphql", async (c) => {
    const { db, tenantId } = getContext(c);
    const response = await yoga.fetch(c.req.raw, { db, tenantId });
    return response;
  });
}
