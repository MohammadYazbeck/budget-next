import { NextResponse } from "next/server";
import { dateToDateKey, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const exportedAt = new Date();
  const [clients, fixedCosts, transactions, liabilities] = await Promise.all([
    db.client.findMany({
      orderBy: [{ isActive: "desc" }, { dueDay: "asc" }, { name: "asc" }],
    }),
    db.fixedCost.findMany({
      orderBy: [{ isActive: "desc" }, { category: "asc" }, { name: "asc" }],
    }),
    db.transaction.findMany({
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
    db.liability.findMany({
      orderBy: [{ status: "asc" }, { dueDate: "asc" }, { name: "asc" }],
    }),
  ]);

  const payload = {
    schemaVersion: 1,
    source: "budget-next",
    exportedAt: exportedAt.toISOString(),
    clients: clients.map((client) => ({
      id: client.id,
      name: client.name,
      monthlyFee: client.monthlyFee.toString(),
      dueDay: client.dueDay,
      note: client.note,
      isActive: client.isActive,
      createdAt: client.createdAt.toISOString(),
      updatedAt: client.updatedAt.toISOString(),
    })),
    fixedCosts: fixedCosts.map((cost) => ({
      id: cost.id,
      name: cost.name,
      category: cost.category,
      amount: cost.amount.toString(),
      cycle: cost.cycle,
      isActive: cost.isActive,
      createdAt: cost.createdAt.toISOString(),
      updatedAt: cost.updatedAt.toISOString(),
    })),
    transactions: transactions.map((transaction) => ({
      id: transaction.id,
      type: transaction.type,
      date: dateToDateKey(transaction.date),
      amount: transaction.amount.toString(),
      category: transaction.category,
      clientId: transaction.clientId,
      method: transaction.method,
      submittedBy: transaction.submittedBy,
      note: transaction.note,
      createdAt: transaction.createdAt.toISOString(),
      updatedAt: transaction.updatedAt.toISOString(),
    })),
    liabilities: liabilities.map((liability) => ({
      id: liability.id,
      name: liability.name,
      category: liability.category,
      amount: liability.amount.toString(),
      dueDate: dateToDateKey(liability.dueDate),
      clientId: liability.clientId,
      note: liability.note,
      status: liability.status,
      paidDate: liability.paidDate ? dateToDateKey(liability.paidDate) : null,
      paymentTransactionId: liability.paymentTransactionId,
      createdAt: liability.createdAt.toISOString(),
      updatedAt: liability.updatedAt.toISOString(),
    })),
  };

  const filename = `social-budget-${todayKey(env.APP_TIME_ZONE, exportedAt)}.json`;

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="${filename}"`,
      "content-type": "application/json; charset=utf-8",
    },
  });
}
