import { PARTNER_DEPOSIT_CATEGORY } from "@/lib/categories";
import { dateToDateKey, isDateKeyInMonth } from "@/lib/dates";
import { type MoneyInput, moneyToCents } from "@/lib/money";

export type CalculationTransactionType = "INCOME" | "EXPENSE" | "PARTNER";

export type CalculationTransaction = {
  type: CalculationTransactionType;
  date: Date | string;
  amount: MoneyInput;
  category: string;
  clientId?: string | null;
};

export type CalculationClient = {
  id: string;
  monthlyFee: MoneyInput;
  isActive?: boolean;
};

export type BusinessTotals = {
  incomeCents: number;
  expenseCents: number;
  partnerDepositCents: number;
  netCents: number;
  cashBalanceCents: number;
};

export type DailySummary = {
  date: string;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
};

export function cashImpactCents(transaction: CalculationTransaction): number {
  const amount = moneyToCents(transaction.amount);

  if (transaction.type === "INCOME") return amount;
  if (
    transaction.type === "PARTNER" &&
    transaction.category === PARTNER_DEPOSIT_CATEGORY
  ) {
    return amount;
  }

  return -amount;
}

export function calculateCashBalance(
  transactions: CalculationTransaction[],
): number {
  return transactions.reduce(
    (total, transaction) => total + cashImpactCents(transaction),
    0,
  );
}

export function calculateBusinessTotals(
  transactions: CalculationTransaction[],
): BusinessTotals {
  return transactions.reduce<BusinessTotals>(
    (totals, transaction) => {
      const amount = moneyToCents(transaction.amount);

      if (transaction.type === "INCOME") {
        totals.incomeCents += amount;
      } else if (
        transaction.type === "PARTNER" &&
        transaction.category === PARTNER_DEPOSIT_CATEGORY
      ) {
        totals.partnerDepositCents += amount;
      } else {
        totals.expenseCents += amount;
      }

      totals.cashBalanceCents += cashImpactCents(transaction);
      totals.netCents = totals.incomeCents - totals.expenseCents;

      return totals;
    },
    {
      incomeCents: 0,
      expenseCents: 0,
      partnerDepositCents: 0,
      netCents: 0,
      cashBalanceCents: 0,
    },
  );
}

export function buildDailySummaries(
  transactions: CalculationTransaction[],
): DailySummary[] {
  const byDate = new Map<string, DailySummary>();

  for (const transaction of transactions) {
    const date = transactionDateKey(transaction);
    const amount = moneyToCents(transaction.amount);
    const summary =
      byDate.get(date) ??
      ({
        date,
        incomeCents: 0,
        expenseCents: 0,
        netCents: 0,
      } satisfies DailySummary);

    if (
      transaction.type === "INCOME" ||
      (transaction.type === "PARTNER" &&
        transaction.category === PARTNER_DEPOSIT_CATEGORY)
    ) {
      summary.incomeCents += amount;
    } else {
      summary.expenseCents += amount;
    }

    summary.netCents = summary.incomeCents - summary.expenseCents;
    byDate.set(date, summary);
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function calculateClientCollection(
  clients: CalculationClient[],
  transactions: CalculationTransaction[],
  monthKey: string,
) {
  const activeClients = clients.filter((client) => client.isActive !== false);
  const paidClients = activeClients.filter((client) => {
    const paidCents = transactions
      .filter(
        (transaction) =>
          transaction.type === "INCOME" &&
          transaction.clientId === client.id &&
          isDateKeyInMonth(transactionDateKey(transaction), monthKey),
      )
      .reduce((total, transaction) => total + moneyToCents(transaction.amount), 0);

    return paidCents >= moneyToCents(client.monthlyFee);
  });

  return {
    paidClients: paidClients.length,
    totalClients: activeClients.length,
    collectionRate: activeClients.length
      ? Math.round((paidClients.length / activeClients.length) * 100)
      : 0,
  };
}

function transactionDateKey(transaction: CalculationTransaction): string {
  return transaction.date instanceof Date
    ? dateToDateKey(transaction.date)
    : transaction.date;
}
