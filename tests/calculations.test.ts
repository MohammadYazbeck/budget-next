import { describe, expect, it } from "vitest";
import { PARTNER_DEPOSIT_CATEGORY } from "@/lib/categories";
import {
  buildDailySummaries,
  calculateBusinessTotals,
  calculateCashBalance,
  calculateClientCollection,
  cashImpactCents,
  type CalculationTransaction,
} from "@/lib/calculations";
import { centsToDecimalString, moneyToCents } from "@/lib/money";

const tx = (
  overrides: Partial<CalculationTransaction>,
): CalculationTransaction => ({
  type: "EXPENSE",
  date: "2026-05-18",
  amount: "0.00",
  category: "تشغيل",
  ...overrides,
});

describe("money helpers", () => {
  it("converts decimal money values to cents without floating point drift", () => {
    expect(moneyToCents("10.015")).toBe(1002);
    expect(moneyToCents("1,250.50")).toBe(125050);
    expect(centsToDecimalString(-350)).toBe("-3.50");
  });
});

describe("cash and business calculations", () => {
  it("treats income and partner deposits as positive cash impact", () => {
    expect(cashImpactCents(tx({ type: "INCOME", amount: "350.00" }))).toBe(
      35000,
    );
    expect(
      cashImpactCents(
        tx({
          type: "PARTNER",
          category: PARTNER_DEPOSIT_CATEGORY,
          amount: "100.00",
        }),
      ),
    ).toBe(10000);
  });

  it("treats expenses and partner withdrawals as negative cash impact", () => {
    expect(cashImpactCents(tx({ type: "EXPENSE", amount: "40.00" }))).toBe(
      -4000,
    );
    expect(
      cashImpactCents(
        tx({ type: "PARTNER", category: "سحب شريك", amount: "80.00" }),
      ),
    ).toBe(-8000);
  });

  it("separates business net from cash balance", () => {
    const transactions = [
      tx({ type: "INCOME", amount: "500.00", category: "دخل زبائن" }),
      tx({ type: "EXPENSE", amount: "120.00", category: "تصوير" }),
      tx({
        type: "PARTNER",
        amount: "200.00",
        category: PARTNER_DEPOSIT_CATEGORY,
      }),
    ];

    expect(calculateCashBalance(transactions)).toBe(58000);
    expect(calculateBusinessTotals(transactions)).toEqual({
      incomeCents: 50000,
      expenseCents: 12000,
      partnerDepositCents: 20000,
      netCents: 38000,
      cashBalanceCents: 58000,
    });
  });

  it("builds daily summaries in date order", () => {
    expect(
      buildDailySummaries([
        tx({ date: "2026-05-19", type: "EXPENSE", amount: "30.00" }),
        tx({ date: "2026-05-18", type: "INCOME", amount: "100.00" }),
        tx({
          date: "2026-05-18",
          type: "PARTNER",
          category: PARTNER_DEPOSIT_CATEGORY,
          amount: "50.00",
        }),
      ]),
    ).toEqual([
      {
        date: "2026-05-18",
        incomeCents: 15000,
        expenseCents: 0,
        netCents: 15000,
      },
      {
        date: "2026-05-19",
        incomeCents: 0,
        expenseCents: 3000,
        netCents: -3000,
      },
    ]);
  });
});

describe("client collection", () => {
  it("calculates monthly collection rate for active clients only", () => {
    expect(
      calculateClientCollection(
        [
          { id: "a", monthlyFee: "500.00" },
          { id: "b", monthlyFee: "300.00" },
          { id: "c", monthlyFee: "200.00", isActive: false },
        ],
        [
          tx({
            type: "INCOME",
            category: "دخل زبائن",
            clientId: "a",
            date: "2026-05-01",
            amount: "500.00",
          }),
          tx({
            type: "INCOME",
            category: "دخل زبائن",
            clientId: "b",
            date: "2026-05-02",
            amount: "100.00",
          }),
          tx({
            type: "INCOME",
            category: "دخل زبائن",
            clientId: "a",
            date: "2026-04-30",
            amount: "500.00",
          }),
        ],
        "2026-05",
      ),
    ).toEqual({
      paidClients: 1,
      totalClients: 2,
      collectionRate: 50,
    });
  });
});
