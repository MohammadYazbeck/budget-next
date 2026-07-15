"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  CUSTOMER_INCOME_CATEGORY,
  fixedCostCategories,
  liabilityCategories,
  liabilityExpenseCategory,
  PARTNER_DEPOSIT_CATEGORY,
  transactionCategories,
} from "@/lib/categories";
import { dateKeyToDate, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { centsToDecimalString, moneyToCents } from "@/lib/money";

const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const monthKeySchema = z.string().regex(/^\d{4}-\d{2}$/);
const idSchema = z.string().min(1);
const optionalIdSchema = z.string().trim().optional().transform((value) => value || null);
const moneySchema = z.string().trim().refine((value) => moneyToCents(value) > 0, {
  message: "Amount must be greater than zero.",
});
const returnToSchema = z.string().optional().transform(safeReturnTo);

const transactionTypeSchema = z.enum(["INCOME", "EXPENSE", "PARTNER"]);
const paymentMethodSchema = z.enum(["CASH", "TRANSFER", "BANK", "OTHER"]);
const costCycleSchema = z.enum(["MONTHLY", "YEARLY"]);
const liabilityStatusSchema = z.enum(["OPEN", "PAID"]);
const fixedCostTransactionNotePrefix =
  "\u062a\u0648\u0644\u064a\u062f \u0645\u0635\u0627\u0631\u064a\u0641 \u062b\u0627\u0628\u062a\u0629";

const transactionCategorySchema = z.string().refine(
  (category) =>
    ([
      ...transactionCategories.INCOME,
      ...transactionCategories.EXPENSE,
      ...transactionCategories.PARTNER,
    ] as readonly string[]).includes(category),
  { message: "Invalid transaction category." },
);
const fixedCostCategorySchema = z.string().refine(
  (category) => (fixedCostCategories as readonly string[]).includes(category),
  { message: "Invalid fixed cost category." },
);
const liabilityCategorySchema = z.string().refine(
  (category) => (liabilityCategories as readonly string[]).includes(category),
  { message: "Invalid liability category." },
);

const importValueSchema = z.union([z.string(), z.number()]);
const importMaybeValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.undefined(),
]);
const importIdSchema = importMaybeValueSchema.transform((value) => {
  if (value === null || value === undefined) return null;

  const id = String(value).trim();

  return id || null;
});
const importRequiredStringSchema = importValueSchema
  .transform((value) => String(value).trim())
  .refine((value) => value.length > 0, { message: "Required string is empty." });
const importOptionalStringSchema = importMaybeValueSchema.transform((value) => {
  if (value === null || value === undefined) return null;

  const text = String(value).trim();

  return text || null;
});
const importPositiveMoneySchema = importValueSchema.transform((value, ctx) => {
  const decimal = decimalStringFromImportMoney(value, true);

  if (decimal === null) {
    ctx.addIssue({ code: "custom", message: "Amount must be greater than zero." });
    return z.NEVER;
  }

  return decimal;
});
const importNonNegativeMoneySchema = importValueSchema.transform((value, ctx) => {
  const decimal = decimalStringFromImportMoney(value, false);

  if (decimal === null) {
    ctx.addIssue({ code: "custom", message: "Amount must be zero or greater." });
    return z.NEVER;
  }

  return decimal;
});
const importDateSchema = z.string().trim().transform((value, ctx) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    ctx.addIssue({ code: "custom", message: "Date must use YYYY-MM-DD." });
    return z.NEVER;
  }

  return value;
});
const importOptionalDateSchema = z.union([z.string(), z.null(), z.undefined()]).transform((value, ctx) => {
  const date = value?.trim();

  if (!date) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    ctx.addIssue({ code: "custom", message: "Date must use YYYY-MM-DD." });
    return z.NEVER;
  }

  return date;
});
const importBooleanSchema = importMaybeValueSchema.transform((value) => {
  if (value === null || value === undefined || value === "") return true;
  if (typeof value === "boolean") return value;

  const normalized = String(value).trim().toLowerCase();

  return !["false", "0", "no", "inactive"].includes(normalized);
});
const importTransactionTypeSchema = importMaybeValueSchema.transform((value, ctx) => {
  const type = normalizeImportedEnum(value, {
    income: "INCOME",
    "داخل": "INCOME",
    expense: "EXPENSE",
    "خرج": "EXPENSE",
    partner: "PARTNER",
    "شريك": "PARTNER",
  });
  const parsed = transactionTypeSchema.safeParse(type);

  if (!type || !parsed.success) {
    ctx.addIssue({ code: "custom", message: "Invalid transaction type." });
    return z.NEVER;
  }

  return parsed.data;
});
const importPaymentMethodSchema = importMaybeValueSchema.transform((value, ctx) => {
  if (value === null || value === undefined || value === "") return "CASH";

  const method = normalizeImportedEnum(value, {
    cash: "CASH",
    "كاش": "CASH",
    transfer: "TRANSFER",
    "حوالة": "TRANSFER",
    bank: "BANK",
    "بنك": "BANK",
    other: "OTHER",
    "أخرى": "OTHER",
  });
  const parsed = paymentMethodSchema.safeParse(method);

  if (!method || !parsed.success) {
    ctx.addIssue({ code: "custom", message: "Invalid payment method." });
    return z.NEVER;
  }

  return parsed.data;
});
const importCostCycleSchema = importMaybeValueSchema.transform((value, ctx) => {
  const cycle = normalizeImportedEnum(value, {
    monthly: "MONTHLY",
    "شهري": "MONTHLY",
    yearly: "YEARLY",
    "سنوي": "YEARLY",
  });
  const parsed = costCycleSchema.safeParse(cycle);

  if (!cycle || !parsed.success) {
    ctx.addIssue({ code: "custom", message: "Invalid fixed cost cycle." });
    return z.NEVER;
  }

  return parsed.data;
});
const importLiabilityStatusSchema = importMaybeValueSchema.transform((value, ctx) => {
  if (value === null || value === undefined || value === "") return "OPEN";

  const status = normalizeImportedEnum(value, {
    open: "OPEN",
    "مفتوح": "OPEN",
    paid: "PAID",
    "مدفوع": "PAID",
  });
  const parsed = liabilityStatusSchema.safeParse(status);

  if (!status || !parsed.success) {
    ctx.addIssue({ code: "custom", message: "Invalid liability status." });
    return z.NEVER;
  }

  return parsed.data;
});
const importClientSchema = z
  .object({
    id: importIdSchema,
    name: importRequiredStringSchema,
    monthlyFee: importNonNegativeMoneySchema,
    dueDay: z.coerce.number().int().min(1).max(31),
    note: importOptionalStringSchema,
    isActive: importBooleanSchema,
  })
  .passthrough();
const importFixedCostSchema = z
  .object({
    id: importIdSchema,
    name: importRequiredStringSchema,
    category: importRequiredStringSchema,
    amount: importPositiveMoneySchema,
    cycle: importCostCycleSchema,
    isActive: importBooleanSchema,
  })
  .passthrough();
const importTransactionSchema = z
  .object({
    id: importIdSchema,
    type: importTransactionTypeSchema,
    date: importDateSchema,
    amount: importPositiveMoneySchema,
    category: importRequiredStringSchema,
    clientId: importIdSchema,
    method: importPaymentMethodSchema,
    submittedBy: importOptionalStringSchema,
    note: importOptionalStringSchema,
  })
  .passthrough();
const importLiabilitySchema = z
  .object({
    id: importIdSchema,
    name: importRequiredStringSchema,
    category: importRequiredStringSchema,
    amount: importPositiveMoneySchema,
    dueDate: importDateSchema,
    clientId: importIdSchema,
    note: importOptionalStringSchema,
    status: importLiabilityStatusSchema,
    paidDate: importOptionalDateSchema,
    paymentTransactionId: importIdSchema,
  })
  .passthrough();
const importBudgetSchema = z
  .object({
    clients: z.array(importClientSchema).default([]),
    fixedCosts: z.array(importFixedCostSchema).default([]),
    transactions: z.array(importTransactionSchema).default([]),
    liabilities: z.array(importLiabilitySchema).default([]),
  })
  .passthrough()
  .superRefine(validateImportBudget);
const importRootSchema = z.object({ data: z.unknown().optional() }).passthrough();

type ImportBudget = z.infer<typeof importBudgetSchema>;

export async function createTransactionAction(formData: FormData) {
  const input = z
    .object({
      returnTo: returnToSchema,
      type: transactionTypeSchema,
      date: dateKeySchema,
      amount: moneySchema,
      category: transactionCategorySchema,
      clientId: optionalIdSchema,
      method: paymentMethodSchema,
      submittedBy: z.string().trim().min(1),
      note: z.string().trim().optional(),
    })
    .parse(formEntries(formData));

  const clientId = input.type === "PARTNER" ? null : input.clientId;

  if (!(transactionCategories[input.type] as readonly string[]).includes(input.category)) {
    throw new Error("Transaction category does not match transaction type.");
  }
  if (input.type === "INCOME" && !clientId) {
    throw new Error("Income transactions require a client.");
  }

  await db.transaction.create({
    data: {
      type: input.type,
      date: dateKeyToDate(input.date),
      amount: centsToDecimalString(moneyToCents(input.amount)),
      category: input.category,
      clientId,
      method: input.method,
      submittedBy: input.submittedBy,
      note: input.note || null,
    },
  });

  refresh(input.returnTo);
}

export async function deleteTransactionAction(formData: FormData) {
  const input = z
    .object({
      returnTo: returnToSchema,
      id: idSchema,
    })
    .parse(formEntries(formData));
  const linkedLiability = await db.liability.findFirst({
    where: { paymentTransactionId: input.id },
    select: { id: true },
  });

  if (linkedLiability) {
    throw new Error("Cannot delete a transaction linked to a paid liability.");
  }

  await db.transaction.deleteMany({ where: { id: input.id } });
  refresh(input.returnTo);
}

export async function createClientAction(formData: FormData) {
  const input = z
    .object({
      returnTo: returnToSchema,
      name: z.string().trim().min(1),
      monthlyFee: moneySchema,
      dueDay: z.coerce.number().int().min(1).max(31),
      note: z.string().trim().optional(),
    })
    .parse(formEntries(formData));

  await db.client.create({
    data: {
      name: input.name,
      monthlyFee: centsToDecimalString(moneyToCents(input.monthlyFee)),
      dueDay: input.dueDay,
      note: input.note || null,
    },
  });

  refresh(input.returnTo);
}

export async function updateClientAction(formData: FormData) {
  const input = z
    .object({
      returnTo: returnToSchema,
      id: idSchema,
      name: z.string().trim().min(1),
      monthlyFee: moneySchema,
      dueDay: z.coerce.number().int().min(1).max(31),
      note: z.string().trim().optional(),
    })
    .parse(formEntries(formData));

  await db.client.update({
    where: { id: input.id },
    data: {
      name: input.name,
      monthlyFee: centsToDecimalString(moneyToCents(input.monthlyFee)),
      dueDay: input.dueDay,
      note: input.note || null,
    },
  });

  refresh(input.returnTo);
}

export async function clearClientNoteAction(formData: FormData) {
  const input = z
    .object({
      returnTo: returnToSchema,
      id: idSchema,
    })
    .parse(formEntries(formData));

  await db.client.update({
    where: { id: input.id },
    data: { note: null },
  });

  refresh(input.returnTo);
}

export async function toggleClientAction(formData: FormData) {
  const input = z
    .object({
      returnTo: returnToSchema,
      id: idSchema,
      isActive: z.enum(["true", "false"]).transform((value) => value === "true"),
    })
    .parse(formEntries(formData));

  await db.client.update({
    where: { id: input.id },
    data: { isActive: input.isActive },
  });

  refresh(input.returnTo);
}

export async function createFixedCostAction(formData: FormData) {
  const input = z
    .object({
      returnTo: returnToSchema,
      name: z.string().trim().min(1),
      category: fixedCostCategorySchema,
      amount: moneySchema,
      cycle: costCycleSchema,
    })
    .parse(formEntries(formData));

  await db.fixedCost.create({
    data: {
      name: input.name,
      category: input.category,
      amount: centsToDecimalString(moneyToCents(input.amount)),
      cycle: input.cycle,
    },
  });

  refresh(input.returnTo);
}

export async function updateFixedCostAction(formData: FormData) {
  const input = z
    .object({
      returnTo: returnToSchema,
      id: idSchema,
      name: z.string().trim().min(1),
      category: fixedCostCategorySchema,
      amount: moneySchema,
      cycle: costCycleSchema,
    })
    .parse(formEntries(formData));

  await db.fixedCost.update({
    where: { id: input.id },
    data: {
      name: input.name,
      category: input.category,
      amount: centsToDecimalString(moneyToCents(input.amount)),
      cycle: input.cycle,
    },
  });

  refresh(input.returnTo);
}

export async function toggleFixedCostAction(formData: FormData) {
  const input = z
    .object({
      returnTo: returnToSchema,
      id: idSchema,
      isActive: z.enum(["true", "false"]).transform((value) => value === "true"),
    })
    .parse(formEntries(formData));

  await db.fixedCost.update({
    where: { id: input.id },
    data: { isActive: input.isActive },
  });

  refresh(input.returnTo);
}

export async function generateFixedCostTransactionsAction(formData: FormData) {
  const input = z
    .object({
      returnTo: returnToSchema,
      month: monthKeySchema,
      submittedBy: z.string().trim().min(1),
    })
    .parse(formEntries(formData));
  const fixedCosts = await db.fixedCost.findMany({ where: { isActive: true } });
  const date = dateKeyToDate(`${input.month}-01`);

  await db.$transaction(async (tx) => {
    for (const cost of fixedCosts) {
      const note = fixedCostTransactionNote(input.month, cost.name);
      const existing = await tx.transaction.findFirst({
        where: {
          type: "EXPENSE",
          date,
          category: cost.category,
          note,
        },
        select: { id: true },
      });

      if (existing) continue;

      const monthlyCents =
        cost.cycle === "YEARLY"
          ? Math.round(moneyToCents(cost.amount) / 12)
          : moneyToCents(cost.amount);

      await tx.transaction.create({
        data: {
          type: "EXPENSE",
          date,
          amount: centsToDecimalString(monthlyCents),
          category: cost.category,
          method: "CASH",
          submittedBy: input.submittedBy,
          note,
        },
      });
    }
  });

  refresh(input.returnTo);
}

export async function payFixedCostAction(formData: FormData) {
  const input = z
    .object({
      returnTo: returnToSchema,
      id: idSchema,
      month: monthKeySchema,
      submittedBy: z.string().trim().min(1),
    })
    .parse(formEntries(formData));
  const date = dateKeyToDate(`${input.month}-01`);

  await db.$transaction(async (tx) => {
    const cost = await tx.fixedCost.findUnique({ where: { id: input.id } });

    if (!cost) {
      throw new Error("Fixed cost was not found.");
    }
    if (!cost.isActive) {
      throw new Error("Cannot pay an inactive fixed cost.");
    }

    const note = fixedCostTransactionNote(input.month, cost.name);
    const existing = await tx.transaction.findFirst({
      where: {
        type: "EXPENSE",
        date,
        category: cost.category,
        note,
      },
      select: { id: true },
    });

    if (existing) return;

    const monthlyCents =
      cost.cycle === "YEARLY"
        ? Math.round(moneyToCents(cost.amount) / 12)
        : moneyToCents(cost.amount);

    await tx.transaction.create({
      data: {
        type: "EXPENSE",
        date,
        amount: centsToDecimalString(monthlyCents),
        category: cost.category,
        method: "CASH",
        submittedBy: input.submittedBy,
        note,
      },
    });
  });

  refresh(input.returnTo);
}

export async function createLiabilityAction(formData: FormData) {
  const input = z
    .object({
      returnTo: returnToSchema,
      name: z.string().trim().min(1),
      category: liabilityCategorySchema,
      amount: moneySchema,
      dueDate: dateKeySchema,
      clientId: optionalIdSchema,
      note: z.string().trim().optional(),
    })
    .parse(formEntries(formData));

  await db.liability.create({
    data: {
      name: input.name,
      category: input.category,
      amount: centsToDecimalString(moneyToCents(input.amount)),
      dueDate: dateKeyToDate(input.dueDate),
      clientId: input.clientId,
      note: input.note || null,
    },
  });

  refresh(input.returnTo);
}

export async function payLiabilityAction(formData: FormData) {
  const input = z
    .object({
      returnTo: returnToSchema,
      id: idSchema,
      paidDate: dateKeySchema.optional(),
      submittedBy: z.string().trim().min(1),
    })
    .parse(formEntries(formData));
  const paidDate = dateKeyToDate(input.paidDate || todayKey(env.APP_TIME_ZONE));

  await db.$transaction(async (tx) => {
    const liability = await tx.liability.findUnique({ where: { id: input.id } });

    if (!liability) {
      throw new Error("Liability was not found.");
    }
    if (liability.status === "PAID") {
      throw new Error("Liability is already paid.");
    }

    const transaction = await tx.transaction.create({
      data: {
        type: "EXPENSE",
        date: paidDate,
        amount: liability.amount,
        category: liabilityExpenseCategory(liability.category),
        clientId: liability.clientId,
        method: "CASH",
        submittedBy: input.submittedBy,
        note: `دفع liability: ${liability.name}`,
      },
    });

    await tx.liability.update({
      where: { id: liability.id },
      data: {
        status: "PAID",
        paidDate,
        paymentTransactionId: transaction.id,
      },
    });
  });

  refresh(input.returnTo);
}

export async function deleteOpenLiabilityAction(formData: FormData) {
  const input = z
    .object({
      returnTo: returnToSchema,
      id: idSchema,
    })
    .parse(formEntries(formData));
  const liability = await db.liability.findUnique({ where: { id: input.id } });

  if (!liability) {
    refresh(input.returnTo);
  }
  if (liability?.status === "PAID") {
    throw new Error("Cannot delete a paid liability.");
  }

  await db.liability.deleteMany({ where: { id: input.id, status: "OPEN" } });
  refresh(input.returnTo);
}

export async function importLegacyJsonAction(formData: FormData) {
  const returnTo = safeReturnTo(formData.get("returnTo")?.toString());
  let target = returnTo;

  try {
    if (formData.get("confirmReplace") !== "REPLACE") {
      throw new Error("Import requires replacement confirmation.");
    }

    const file = formData.get("importFile");

    if (!(file instanceof File) || file.size === 0) {
      throw new Error("Choose a JSON import file.");
    }
    if (file.size > 10 * 1024 * 1024) {
      throw new Error("Import file is too large. Maximum size is 10 MB.");
    }

    const parsedJson = JSON.parse(await file.text()) as unknown;
    const imported = parseImportBudget(parsedJson);

    await replaceBudgetData(imported);

    target = withImportStatus(returnTo, {
      importSuccess: importSummary(imported),
    });
  } catch (error) {
    target = withImportStatus(returnTo, {
      importError: importErrorMessage(error),
    });
  }

  refresh(target);
}

function parseImportBudget(raw: unknown): ImportBudget {
  const root = importRootSchema.parse(raw);

  return importBudgetSchema.parse(root.data ?? raw);
}

function fixedCostTransactionNote(month: string, costName: string) {
  return `${fixedCostTransactionNotePrefix} ${month}: ${costName}`;
}

async function replaceBudgetData(imported: ImportBudget) {
  await db.$transaction(async (tx) => {
    await tx.liability.deleteMany();
    await tx.transaction.deleteMany();
    await tx.fixedCost.deleteMany();
    await tx.client.deleteMany();

    const clientIdMap = new Map<string, string>();
    const transactionIdMap = new Map<string, string>();

    for (const client of imported.clients) {
      const created = await tx.client.create({
        data: {
          name: client.name,
          monthlyFee: client.monthlyFee,
          dueDay: client.dueDay,
          note: client.note,
          isActive: client.isActive,
        },
        select: { id: true },
      });

      if (client.id) clientIdMap.set(client.id, created.id);
    }

    for (const cost of imported.fixedCosts) {
      await tx.fixedCost.create({
        data: {
          name: cost.name,
          category: cost.category,
          amount: cost.amount,
          cycle: cost.cycle,
          isActive: cost.isActive,
        },
      });
    }

    for (const transaction of imported.transactions) {
      const created = await tx.transaction.create({
        data: {
          type: transaction.type,
          date: dateKeyToDate(transaction.date),
          amount: transaction.amount,
          category: transaction.category,
          clientId: mapImportRelation(transaction.clientId, clientIdMap, "client"),
          method: transaction.method,
          submittedBy: transaction.submittedBy,
          note: transaction.note,
        },
        select: { id: true },
      });

      if (transaction.id) transactionIdMap.set(transaction.id, created.id);
    }

    for (const liability of imported.liabilities) {
      await tx.liability.create({
        data: {
          name: liability.name,
          category: liability.category,
          amount: liability.amount,
          dueDate: dateKeyToDate(liability.dueDate),
          clientId: mapImportRelation(liability.clientId, clientIdMap, "client"),
          note: liability.note,
          status: liability.status,
          paidDate: liability.paidDate ? dateKeyToDate(liability.paidDate) : null,
          paymentTransactionId: liability.paymentTransactionId
            ? mapImportRelation(liability.paymentTransactionId, transactionIdMap, "payment transaction")
            : null,
        },
      });
    }
  });
}

function validateImportBudget(imported: ImportBudget, ctx: z.RefinementCtx) {
  const clientIds = collectImportIds(imported.clients, "clients", ctx);
  const transactionIds = collectImportIds(imported.transactions, "transactions", ctx);

  imported.fixedCosts.forEach((cost, index) => {
    if (!(fixedCostCategories as readonly string[]).includes(cost.category)) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid fixed cost category.",
        path: ["fixedCosts", index, "category"],
      });
    }
  });

  imported.transactions.forEach((transaction, index) => {
    if (!(transactionCategories[transaction.type] as readonly string[]).includes(transaction.category)) {
      ctx.addIssue({
        code: "custom",
        message: "Transaction category does not match transaction type.",
        path: ["transactions", index, "category"],
      });
    }
    if (transaction.type === "INCOME" && !transaction.clientId) {
      ctx.addIssue({
        code: "custom",
        message: "Income transactions require a client.",
        path: ["transactions", index, "clientId"],
      });
    }
    if (transaction.clientId && !clientIds.has(transaction.clientId)) {
      ctx.addIssue({
        code: "custom",
        message: "Transaction references an unknown client.",
        path: ["transactions", index, "clientId"],
      });
    }
  });

  imported.liabilities.forEach((liability, index) => {
    if (!(liabilityCategories as readonly string[]).includes(liability.category)) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid liability category.",
        path: ["liabilities", index, "category"],
      });
    }
    if (liability.clientId && !clientIds.has(liability.clientId)) {
      ctx.addIssue({
        code: "custom",
        message: "Liability references an unknown client.",
        path: ["liabilities", index, "clientId"],
      });
    }
    if (liability.paymentTransactionId && !transactionIds.has(liability.paymentTransactionId)) {
      ctx.addIssue({
        code: "custom",
        message: "Liability references an unknown payment transaction.",
        path: ["liabilities", index, "paymentTransactionId"],
      });
    }
  });
}

function collectImportIds(
  items: { id: string | null }[],
  path: string,
  ctx: z.RefinementCtx,
) {
  const ids = new Set<string>();

  items.forEach((item, index) => {
    if (!item.id) return;
    if (ids.has(item.id)) {
      ctx.addIssue({
        code: "custom",
        message: "Duplicate import ID.",
        path: [path, index, "id"],
      });
    }

    ids.add(item.id);
  });

  return ids;
}

function mapImportRelation(
  sourceId: string | null,
  idMap: Map<string, string>,
  label: string,
) {
  if (!sourceId) return null;

  const mapped = idMap.get(sourceId);

  if (!mapped) {
    throw new Error(`Import references an unknown ${label}: ${sourceId}`);
  }

  return mapped;
}

function decimalStringFromImportMoney(value: string | number, positiveOnly: boolean) {
  const cents = moneyToCents(value);

  if (!Number.isFinite(cents)) return null;
  if (positiveOnly ? cents <= 0 : cents < 0) return null;

  return centsToDecimalString(cents);
}

function normalizeImportedEnum(value: unknown, aliases: Record<string, string>) {
  const raw = String(value ?? "").trim();
  const normalized = raw.toLowerCase();

  return aliases[normalized] ?? aliases[raw] ?? aliases[raw.toUpperCase()] ?? raw.toUpperCase();
}

function importSummary(imported: ImportBudget) {
  return [
    `${imported.clients.length} clients`,
    `${imported.fixedCosts.length} fixed costs`,
    `${imported.transactions.length} transactions`,
    `${imported.liabilities.length} liabilities`,
  ].join(", ");
}

function importErrorMessage(error: unknown) {
  if (error instanceof SyntaxError) {
    return "Invalid JSON file.";
  }
  if (error instanceof z.ZodError) {
    return error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "file"}: ${issue.message}`)
      .join("; ")
      .slice(0, 700);
  }
  if (error instanceof Error) {
    return error.message.slice(0, 700);
  }

  return "Import failed.";
}

function withImportStatus(
  returnTo: string,
  status: { importSuccess?: string; importError?: string },
) {
  const url = new URL(returnTo, "http://local");

  url.searchParams.delete("importSuccess");
  url.searchParams.delete("importError");

  if (status.importSuccess) {
    url.searchParams.set("importSuccess", status.importSuccess);
  }
  if (status.importError) {
    url.searchParams.set("importError", status.importError);
  }

  return `${url.pathname}${url.search}`;
}

function formEntries(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

function safeReturnTo(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";

  return value;
}

function refresh(returnTo: string): never {
  revalidatePath("/");
  redirect(returnTo);
}
