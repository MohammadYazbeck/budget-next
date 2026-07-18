import type { Prisma } from "@prisma/client";
import Link from "next/link";
import {
  clearClientNoteAction,
  createClientAction,
  createFixedCostAction,
  createLiabilityAction,
  createTransactionAction,
  deleteOpenLiabilityAction,
  deleteTransactionAction,
  generateFixedCostTransactionsAction,
  importLegacyJsonAction,
  payFixedCostAction,
  payLiabilityAction,
  toggleClientAction,
  toggleFixedCostAction,
  updateClientAction,
  updateFixedCostAction,
} from "@/app/actions/budget";
import { calculateBusinessTotals, calculateCashBalance, calculateClientCollection } from "@/lib/calculations";
import {
  fixedCostCategories,
  liabilityCategories,
  PARTNER_DEPOSIT_CATEGORY,
  transactionCategories,
} from "@/lib/categories";
import { dateToDateKey, monthKeyFromDateKey, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { formatCents, moneyToCents } from "@/lib/money";

export const dynamic = "force-dynamic";

type ViewKey = "dashboard" | "transactions" | "clients" | "fixedCosts" | "liabilities" | "reports";
type FilterMode = "month" | "day";
type TransactionSortKey = "date" | "type" | "client";
type SearchParams = {
  view?: string;
  mode?: string;
  month?: string;
  day?: string;
  transactionSort?: string;
  importSuccess?: string;
  importError?: string;
};

type TransactionWithClient = Prisma.TransactionGetPayload<{
  include: { client: true; liabilityPayment: true };
}>;

type LiabilityWithClient = Prisma.LiabilityGetPayload<{
  include: { client: true; paymentTransaction: true };
}>;

type PageData = {
  clients: Prisma.ClientGetPayload<object>[];
  fixedCosts: Prisma.FixedCostGetPayload<object>[];
  liabilities: LiabilityWithClient[];
  transactions: TransactionWithClient[];
};

const views: { key: ViewKey; label: string }[] = [
  { key: "dashboard", label: "لوحة التحكم" },
  { key: "transactions", label: "الحركات" },
  { key: "clients", label: "الزبائن" },
  { key: "fixedCosts", label: "المصاريف الثابتة" },
  { key: "liabilities", label: "Liabilities" },
  { key: "reports", label: "التقارير" },
];

const paymentMethodLabels = {
  CASH: "كاش",
  TRANSFER: "حوالة",
  BANK: "بنك",
  OTHER: "أخرى",
} as const;
const transactionSortLabels: Record<TransactionSortKey, string> = {
  date: "الأحدث",
  type: "حسب النوع",
  client: "حسب الزبون",
};

const fieldClassName =
  "min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm text-slate-900";
const primaryButtonClassName =
  "inline-flex min-h-10 items-center justify-center rounded-lg bg-blue-700 px-4 text-sm font-black text-white transition hover:bg-blue-800";
const secondaryButtonClassName =
  "inline-flex min-h-10 items-center justify-center rounded-lg bg-slate-800 px-4 text-sm font-black text-white transition hover:bg-slate-900";
const dangerButtonClassName =
  "inline-flex min-h-10 items-center justify-center rounded-lg bg-red-100 px-4 text-sm font-black text-red-800 transition hover:bg-red-200";

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = (await searchParams) ?? {};
  const selectedDate = validDateKey(params.day) ? params.day : todayKey(env.APP_TIME_ZONE);
  const selectedMonth = validMonthKey(params.month)
    ? params.month
    : monthKeyFromDateKey(selectedDate);
  const mode: FilterMode = params.mode === "day" ? "day" : "month";
  const view = normalizeView(params.view);
  const transactionSort = normalizeTransactionSort(params.transactionSort);

  let data: PageData;

  try {
    data = await loadPageData();
  } catch (error) {
    return (
      <Shell
        activeView={view}
        mode={mode}
        selectedMonth={selectedMonth}
        selectedDate={selectedDate}
        monthOptions={[selectedMonth]}
        totalBalanceCents={0}
      >
        <DatabaseError error={error} />
      </Shell>
    );
  }

  const model = buildReadModel(data, mode, selectedMonth, selectedDate);
  const returnTo = hrefFor({
    view,
    mode,
    selectedMonth,
    selectedDate,
    transactionSort: view === "transactions" ? transactionSort : undefined,
  });

  return (
    <Shell
      activeView={view}
      mode={mode}
      selectedMonth={selectedMonth}
      selectedDate={selectedDate}
      monthOptions={model.monthOptions}
      totalBalanceCents={model.totalBalanceCents}
    >
      {view === "dashboard" && <Dashboard model={model} />}
      {view === "transactions" && (
        <TransactionsView
          clients={data.clients}
          mode={mode}
          periodLabel={model.selectedLabel}
          returnTo={returnTo}
          selectedDate={selectedDate}
          selectedMonth={selectedMonth}
          sort={transactionSort}
          transactions={model.periodTransactions}
        />
      )}
      {view === "clients" && <ClientsView model={model} returnTo={returnTo} />}
      {view === "fixedCosts" && (
        <FixedCostsView
          model={model}
          returnTo={returnTo}
          selectedMonth={selectedMonth}
        />
      )}
      {view === "liabilities" && (
        <LiabilitiesView
          clients={data.clients}
          liabilities={data.liabilities}
          returnTo={returnTo}
          selectedDate={selectedDate}
        />
      )}
      {view === "reports" && (
        <ReportsView
          importError={params.importError}
          importSuccess={params.importSuccess}
          model={model}
          returnTo={returnTo}
        />
      )}
    </Shell>
  );
}

async function loadPageData(): Promise<PageData> {
  const [clients, fixedCosts, liabilities, transactions] = await Promise.all([
    db.client.findMany({
      orderBy: [{ isActive: "desc" }, { dueDay: "asc" }, { name: "asc" }],
    }),
    db.fixedCost.findMany({
      orderBy: [{ isActive: "desc" }, { category: "asc" }, { name: "asc" }],
    }),
    db.liability.findMany({
      include: { client: true, paymentTransaction: true },
      orderBy: [{ status: "asc" }, { dueDate: "asc" }, { name: "asc" }],
    }),
    db.transaction.findMany({
      include: { client: true, liabilityPayment: true },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
  ]);

  return { clients, fixedCosts, liabilities, transactions };
}

function buildReadModel(
  data: PageData,
  mode: FilterMode,
  selectedMonth: string,
  selectedDate: string,
) {
  const calcTransactions = data.transactions.map((transaction) => ({
    type: transaction.type,
    date: transaction.date,
    amount: transaction.amount,
    category: transaction.category,
    clientId: transaction.clientId,
  }));
  const today = todayKey(env.APP_TIME_ZONE);
  const periodTransactions = data.transactions.filter((transaction) =>
    isInActivePeriod(transaction.date, mode, selectedMonth, selectedDate),
  );
  const periodCalcTransactions = periodTransactions.map((transaction) => ({
    type: transaction.type,
    date: transaction.date,
    amount: transaction.amount,
    category: transaction.category,
    clientId: transaction.clientId,
  }));
  const todayCalcTransactions = data.transactions
    .filter((transaction) => dateToDateKey(transaction.date) === today)
    .map((transaction) => ({
      type: transaction.type,
      date: transaction.date,
      amount: transaction.amount,
      category: transaction.category,
      clientId: transaction.clientId,
    }));

  const periodTotals = calculateBusinessTotals(periodCalcTransactions);
  const todayTotals = calculateBusinessTotals(todayCalcTransactions);
  const dailySummaries = buildChartDays(periodCalcTransactions, mode, selectedMonth, selectedDate);
  const activeDays = dailySummaries.filter(
    (day) => day.incomeCents > 0 || day.expenseCents > 0,
  );
  const averageDivisor = Math.max(1, activeDays.length);
  const totalIncomeCents = dailySummaries.reduce((sum, day) => sum + day.incomeCents, 0);
  const totalExpenseCents = dailySummaries.reduce((sum, day) => sum + day.expenseCents, 0);
  const bestIncomeDay = dailySummaries.reduce(
    (best, day) => (day.incomeCents > best.incomeCents ? day : best),
    dailySummaries[0] ?? {
      date: selectedDate,
      incomeCents: 0,
      expenseCents: 0,
      netCents: 0,
    },
  );
  const openLiabilities = data.liabilities.filter((liability) => liability.status !== "PAID");
  const openLiabilitiesCents = openLiabilities.reduce(
    (sum, liability) => sum + moneyToCents(liability.amount),
    0,
  );
  const expectedFixedCostCents = data.fixedCosts
    .filter((cost) => cost.isActive)
    .reduce((sum, cost) => sum + monthlyFixedCostCents(cost), 0);
  const collection = calculateClientCollection(
    data.clients.map((client) => ({
      id: client.id,
      monthlyFee: client.monthlyFee,
      isActive: client.isActive,
    })),
    calcTransactions,
    selectedMonth,
  );
  const clientReportsForPeriod = clientReports(data.clients, periodTransactions);
  const clientRemainingTotalCents = clientReportsForPeriod.reduce(
    (sum, report) => sum + report.remainingCents,
    0,
  );

  return {
    ...data,
    periodTransactions,
    selectedLabel: mode === "day" ? selectedDate : selectedMonth,
    monthOptions: monthOptions(data.transactions, selectedMonth),
    totalBalanceCents: calculateCashBalance(calcTransactions),
    todayIncomeCents: todayTotals.incomeCents,
    todayExpenseCents: todayTotals.expenseCents,
    todayNetCents: todayTotals.netCents,
    periodIncomeCents: periodTotals.incomeCents,
    periodExpenseCents: periodTotals.expenseCents,
    periodNetCents: periodTotals.netCents,
    averageIncomeCents: Math.round(totalIncomeCents / averageDivisor),
    averageExpenseCents: Math.round(totalExpenseCents / averageDivisor),
    averageNetCents: Math.round((totalIncomeCents - totalExpenseCents) / averageDivisor),
    bestIncomeDay,
    collection,
    openLiabilitiesCount: openLiabilities.length,
    openLiabilitiesCents,
    clientRemainingTotalCents,
    expectedFixedCostCents,
    projectedNetAfterFixedCents: periodTotals.netCents - expectedFixedCostCents,
    dailySummaries,
    categoryTotals: categoryTotals(periodTransactions),
    clientReports: clientReportsForPeriod,
    dailyRows: dailyRows(periodTransactions),
  };
}

function Shell({
  activeView,
  mode,
  selectedMonth,
  selectedDate,
  monthOptions,
  totalBalanceCents,
  children,
}: {
  activeView: ViewKey;
  mode: FilterMode;
  selectedMonth: string;
  selectedDate: string;
  monthOptions: string[];
  totalBalanceCents: number;
  children: React.ReactNode;
}) {
  const activeLabel = views.find((view) => view.key === activeView)?.label ?? "لوحة التحكم";

  return (
    <main className="grid min-h-screen grid-cols-[280px_1fr] max-lg:grid-cols-1">
      <aside className="flex flex-col gap-7 bg-slate-800 p-6 text-white">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-lg bg-amber-400 font-black text-slate-900">
            S
          </span>
          <div>
            <strong className="block">صندوق السوشيال</strong>
            <span className="mt-1 block text-sm text-slate-300">Budget Control</span>
          </div>
        </div>

        <nav aria-label="الأقسام" className="grid gap-2">
          {views.map((view) => (
            <Link
              key={view.key}
              href={hrefFor({ view: view.key, mode, selectedMonth, selectedDate })}
              className={`rounded-lg px-4 py-3 text-right text-sm font-bold transition ${
                view.key === activeView
                  ? "bg-slate-700 text-white"
                  : "text-slate-200 hover:bg-slate-700"
              }`}
            >
              {view.label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto rounded-lg border border-white/15 p-4">
          <span className="block text-sm text-slate-300">الرصيد الحالي</span>
          <strong className="mt-2 block text-3xl">{formatCents(totalBalanceCents)}</strong>
        </div>
      </aside>

      <section className="p-7">
        <header className="mb-6 flex items-start justify-between gap-4 max-xl:grid">
          <div>
            <p className="mb-1 text-sm font-bold text-slate-500">إدارة داخل وخرج الشركة</p>
            <h1 className="text-3xl font-black">{activeLabel}</h1>
          </div>
          <PeriodFilters
            activeView={activeView}
            mode={mode}
            selectedMonth={selectedMonth}
            selectedDate={selectedDate}
            monthOptions={monthOptions}
          />
        </header>

        {children}
      </section>
    </main>
  );
}

function PeriodFilters({
  activeView,
  mode,
  selectedMonth,
  selectedDate,
  monthOptions,
}: {
  activeView: ViewKey;
  mode: FilterMode;
  selectedMonth: string;
  selectedDate: string;
  monthOptions: string[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex overflow-hidden rounded-lg border border-stone-300 bg-white">
        <Link
          href={hrefFor({ view: activeView, mode: "month", selectedMonth, selectedDate })}
          className={`px-4 py-2 text-sm font-black ${
            mode === "month" ? "bg-blue-700 text-white" : "text-slate-500"
          }`}
        >
          شهري
        </Link>
        <Link
          href={hrefFor({ view: activeView, mode: "day", selectedMonth, selectedDate })}
          className={`px-4 py-2 text-sm font-black ${
            mode === "day" ? "bg-blue-700 text-white" : "text-slate-500"
          }`}
        >
          يومي
        </Link>
      </div>

      <form className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="view" value={activeView} />
        <input type="hidden" name="mode" value={mode} />
        {mode === "month" ? (
          <select
            name="month"
            defaultValue={selectedMonth}
            className="min-h-11 rounded-lg border border-stone-300 bg-white px-3 text-sm"
          >
            {monthOptions.map((month) => (
              <option key={month} value={month}>
                {month}
              </option>
            ))}
          </select>
        ) : (
          <input
            name="day"
            type="date"
            defaultValue={selectedDate}
            className="min-h-11 rounded-lg border border-stone-300 bg-white px-3 text-sm"
          />
        )}
        <button
          type="submit"
          className="min-h-11 rounded-lg bg-slate-800 px-4 text-sm font-black text-white"
        >
          تطبيق
        </button>
      </form>
    </div>
  );
}

function Dashboard({ model }: { model: ReturnType<typeof buildReadModel> }) {
  const kpis = [
    { label: "دخل اليوم", value: formatCents(model.todayIncomeCents), accent: "border-emerald-600" },
    { label: "خرج اليوم", value: formatCents(model.todayExpenseCents), accent: "border-red-600" },
    { label: "صافي اليوم", value: formatCents(model.todayNetCents), accent: "border-amber-600" },
    { label: "صافي الفترة", value: formatCents(model.periodNetCents), accent: "border-blue-600" },
  ];
  const stats = [
    ["متوسط الدخل اليومي", formatCents(model.averageIncomeCents)],
    ["متوسط الخرج اليومي", formatCents(model.averageExpenseCents)],
    ["متوسط الصافي اليومي", formatCents(model.averageNetCents)],
    ["أعلى يوم دخل", `${formatCents(model.bestIncomeDay.incomeCents)} / ${model.bestIncomeDay.date}`],
    [
      "تحصيل الزبائن",
      `${model.collection.collectionRate}% (${model.collection.paidClients} / ${model.collection.totalClients})`,
    ],
    [
      "التزامات مفتوحة",
      `${formatCents(model.openLiabilitiesCents)} / ${model.openLiabilitiesCount} بند`,
    ],
    ["المصاريف الثابتة المتوقعة", formatCents(model.expectedFixedCostCents)],
    ["الصافي المتوقع بعد الثابتة", formatCents(model.projectedNetAfterFixedCents)],
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4 max-xl:grid-cols-2 max-sm:grid-cols-1">
        {kpis.map((kpi) => (
          <article
            key={kpi.label}
            className={`rounded-lg border border-stone-200 border-t-4 ${kpi.accent} bg-white p-5 shadow-sm`}
          >
            <span className="text-sm font-bold text-slate-500">{kpi.label}</span>
            <strong className="mt-2 block text-3xl">{kpi.value}</strong>
          </article>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-4 max-xl:grid-cols-2 max-sm:grid-cols-1">
        {stats.map(([label, value]) => (
          <article key={label} className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
            <span className="text-sm font-bold text-slate-500">{label}</span>
            <strong className="mt-2 block text-xl">{value}</strong>
          </article>
        ))}
      </div>

      <DailyChart model={model} />

      <div className="grid grid-cols-[1.1fr_0.9fr] gap-4 max-xl:grid-cols-1">
        <Panel title="الفترة المختارة" subtitle={model.selectedLabel}>
          <Metric label="دخل الفترة" value={formatCents(model.periodIncomeCents)} />
          <Metric label="خرج الفترة" value={formatCents(model.periodExpenseCents)} />
          <Metric label="الرصيد الكلي" value={formatCents(model.totalBalanceCents)} />
          <CategoryBars totals={model.categoryTotals} />
        </Panel>

        <Panel title="تنبيهات الدفع" subtitle="زبائن الشهر">
          <ClientCollectionList model={model} />
        </Panel>
      </div>
    </div>
  );
}

function DailyChart({ model }: { model: ReturnType<typeof buildReadModel> }) {
  const maxValue = Math.max(
    1,
    ...model.dailySummaries.flatMap((day) => [
      day.incomeCents,
      day.expenseCents,
      Math.abs(day.netCents),
    ]),
  );
  const visibleDays = model.dailySummaries.filter(
    (day) => day.incomeCents > 0 || day.expenseCents > 0,
  );
  const chartDays = visibleDays.length ? visibleDays : model.dailySummaries.slice(0, 10);

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-black">الحركة اليومية خلال الفترة</h2>
        <span className="text-sm font-bold text-slate-500">داخل / خرج / صافي</span>
      </div>
      <div className="flex min-h-44 items-end gap-3 overflow-x-auto border-t border-stone-100 px-1 pt-5">
        {chartDays.map((day) => (
          <div key={day.date} className="grid min-w-11 justify-items-center gap-2">
            <div className="flex h-32 items-end gap-1">
              <span
                className="block w-2.5 rounded-t-full bg-emerald-600"
                style={{ height: `${barHeight(day.incomeCents, maxValue)}px` }}
              />
              <span
                className="block w-2.5 rounded-t-full bg-red-600"
                style={{ height: `${barHeight(day.expenseCents, maxValue)}px` }}
              />
              <span
                className={`block w-2.5 rounded-t-full ${day.netCents < 0 ? "bg-amber-600" : "bg-blue-700"}`}
                style={{ height: `${barHeight(Math.abs(day.netCents), maxValue)}px` }}
              />
            </div>
            <small className="text-xs text-slate-500">{Number(day.date.slice(8, 10))}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function TransactionsView({
  clients,
  mode,
  periodLabel,
  returnTo,
  selectedDate,
  selectedMonth,
  sort,
  transactions,
}: {
  clients: Prisma.ClientGetPayload<object>[];
  mode: FilterMode;
  periodLabel: string;
  returnTo: string;
  selectedDate: string;
  selectedMonth: string;
  sort: TransactionSortKey;
  transactions: TransactionWithClient[];
}) {
  return (
    <div className="space-y-4">
      <Panel title="إضافة حركة" subtitle="داخل / خرج / شريك">
        <form action={createTransactionAction} className="grid gap-4">
          <input type="hidden" name="returnTo" value={returnTo} />
          <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-1">
            <FormField label="النوع">
              <select name="type" required className={fieldClassName}>
                <option value="INCOME">داخل</option>
                <option value="EXPENSE">خرج</option>
                <option value="PARTNER">شريك</option>
              </select>
            </FormField>
            <FormField label="التاريخ">
              <input name="date" type="date" required defaultValue={todayKey(env.APP_TIME_ZONE)} className={fieldClassName} />
            </FormField>
            <FormField label="المبلغ بالدولار">
              <input name="amount" type="number" min="0" step="0.01" required className={fieldClassName} />
            </FormField>
            <FormField label="التصنيف">
              <select name="category" required className={fieldClassName}>
                <optgroup label="داخل">
                  {transactionCategories.INCOME.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </optgroup>
                <optgroup label="خرج">
                  {transactionCategories.EXPENSE.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </optgroup>
                <optgroup label="شريك">
                  {transactionCategories.PARTNER.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </optgroup>
              </select>
            </FormField>
            <FormField label="الزبون">
              <select name="clientId" className={fieldClassName}>
                <option value="">بدون زبون</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="طريقة الدفع">
              <select name="method" className={fieldClassName}>
                <option value="CASH">كاش</option>
                <option value="TRANSFER">حوالة</option>
                <option value="BANK">بنك</option>
                <option value="OTHER">أخرى</option>
              </select>
            </FormField>
            <FormField label="مدخل الحركة">
              <input name="submittedBy" required placeholder="اسم الشخص" className={fieldClassName} />
            </FormField>
          </div>
          <FormField label="ملاحظات">
            <input name="note" type="text" placeholder="مثال: تصوير حملة زبون معين" className={fieldClassName} />
          </FormField>
          <div>
            <button type="submit" className={primaryButtonClassName}>
              إضافة حركة
            </button>
          </div>
        </form>
      </Panel>

      <TransactionsTable
        mode={mode}
        periodLabel={periodLabel}
        returnTo={returnTo}
        selectedDate={selectedDate}
        selectedMonth={selectedMonth}
        sort={sort}
        transactions={transactions}
      />
    </div>
  );
}

function TransactionsTable({
  mode,
  periodLabel,
  returnTo,
  selectedDate,
  selectedMonth,
  sort,
  transactions,
}: {
  mode: FilterMode;
  periodLabel: string;
  returnTo: string;
  selectedDate: string;
  selectedMonth: string;
  sort: TransactionSortKey;
  transactions: TransactionWithClient[];
}) {
  const sortedTransactions = sortTransactions(transactions, sort);

  return (
    <Panel title="آخر الحركات" subtitle={`${sortedTransactions.length} حركة`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-bold text-slate-500">{periodLabel}</p>
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(transactionSortLabels) as TransactionSortKey[]).map((sortKey) => (
            <Link
              key={sortKey}
              href={hrefFor({
                view: "transactions",
                mode,
                selectedMonth,
                selectedDate,
                transactionSort: sortKey,
              })}
              className={`inline-flex min-h-9 items-center rounded-lg px-3 text-xs font-black transition ${
                sort === sortKey
                  ? "bg-blue-700 text-white"
                  : "bg-stone-100 text-slate-700 hover:bg-stone-200"
              }`}
            >
              {transactionSortLabels[sortKey]}
            </Link>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-right text-slate-500">
              <th className="py-3 pl-4">التاريخ</th>
              <th className="py-3 pl-4">النوع</th>
              <th className="py-3 pl-4">التصنيف</th>
              <th className="py-3 pl-4">الزبون</th>
              <th className="py-3 pl-4">المبلغ</th>
              <th className="py-3 pl-4">طريقة الدفع</th>
              <th className="py-3">ملاحظات</th>
              <th className="py-3 pl-4">مدخل الحركة</th>
              <th className="py-3"></th>
            </tr>
          </thead>
          <tbody>
            {sortedTransactions.length ? (
              sortedTransactions.map((transaction) => {
                const impact = moneyToCents(transaction.amount);
                const positive =
                  transaction.type === "INCOME" ||
                  (transaction.type === "PARTNER" &&
                    transaction.category === PARTNER_DEPOSIT_CATEGORY);

                return (
                  <tr key={transaction.id} className="border-b border-stone-100">
                    <td className="py-3 pl-4">{dateToDateKey(transaction.date)}</td>
                    <td className="py-3 pl-4">{transactionTypeLabel(transaction.type)}</td>
                    <td className="py-3 pl-4">{transaction.category}</td>
                    <td className="py-3 pl-4">{transaction.client?.name ?? "-"}</td>
                    <td className={`py-3 pl-4 font-black ${positive ? "text-emerald-700" : "text-red-700"}`}>
                      {positive ? "+" : "-"}
                      {formatCents(impact)}
                    </td>
                    <td className="py-3 pl-4">{paymentMethodLabels[transaction.method]}</td>
                    <td className="py-3">{transaction.note ?? "-"}</td>
                    <td className="py-3 pl-4">{transaction.submittedBy ?? "-"}</td>
                    <td className="py-3">
                      {transaction.liabilityPayment ? (
                        <span className="text-xs font-bold text-slate-500">مرتبط</span>
                      ) : (
                        <form action={deleteTransactionAction}>
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <input type="hidden" name="id" value={transaction.id} />
                          <button type="submit" className={dangerButtonClassName}>
                            حذف
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className="py-6 text-slate-500" colSpan={9}>
                  لا يوجد حركات بعد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function ClientsView({
  model,
  returnTo,
}: {
  model: ReturnType<typeof buildReadModel>;
  returnTo: string;
}) {
  return (
    <div className="space-y-4">
      <Panel title="إضافة زبون" subtitle="اشتراك شهري">
        <form action={createClientAction} className="grid grid-cols-4 items-end gap-3 max-lg:grid-cols-1">
          <input type="hidden" name="returnTo" value={returnTo} />
          <FormField label="اسم الزبون">
            <input name="name" required className={fieldClassName} />
          </FormField>
          <FormField label="الاشتراك الشهري">
            <input name="monthlyFee" type="number" min="0" step="0.01" required className={fieldClassName} />
          </FormField>
          <FormField label="يوم الدفع المتوقع">
            <input name="dueDay" type="number" min="1" max="31" required className={fieldClassName} />
          </FormField>
          <FormField label="ملاحظة">
            <input name="note" className={fieldClassName} />
          </FormField>
          <button type="submit" className={primaryButtonClassName}>
            إضافة زبون
          </button>
        </form>
      </Panel>

      <div className="grid grid-cols-1 gap-4">
        <SummaryCard label="إجمالي المتبقي على الزبائن" value={formatCents(model.clientRemainingTotalCents)} />
      </div>

      <div className="grid grid-cols-3 gap-4 max-xl:grid-cols-2 max-md:grid-cols-1">
        {model.clients.map((client) => {
          const report = model.clientReports.find((item) => item.id === client.id);

          return (
            <article key={client.id} className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-start justify-between gap-3">
                <h2 className="text-lg font-black">{client.name}</h2>
                <Pill tone={client.isActive ? "paid" : "unpaid"}>
                  {client.isActive ? "نشط" : "متوقف"}
                </Pill>
              </div>
              <Metric label="دخل الفترة" value={formatCents(report?.incomeCents ?? 0)} />
              <Metric label="المتبقي" value={formatCents(report?.remainingCents ?? 0)} />
              <Metric label="تكاليف مباشرة" value={formatCents(report?.costCents ?? 0)} />
              <Metric label="الصافي المباشر" value={formatCents(report?.netCents ?? 0)} />

              <Metric label="ملاحظة" value={client.note ?? "-"} />

              <form action={updateClientAction} className="mt-4 grid gap-3">
                <input type="hidden" name="returnTo" value={returnTo} />
                <input type="hidden" name="id" value={client.id} />
                <FormField label="اسم الزبون">
                  <input name="name" required defaultValue={client.name} className={fieldClassName} />
                </FormField>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="الاشتراك">
                    <input
                      name="monthlyFee"
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      defaultValue={client.monthlyFee.toString()}
                      className={fieldClassName}
                    />
                  </FormField>
                  <FormField label="يوم الدفع">
                    <input
                      name="dueDay"
                      type="number"
                      min="1"
                      max="31"
                      required
                      defaultValue={client.dueDay}
                      className={fieldClassName}
                    />
                  </FormField>
                </div>
                <FormField label="ملاحظة">
                  <textarea
                    name="note"
                    defaultValue={client.note ?? ""}
                    rows={3}
                    className={fieldClassName}
                  />
                </FormField>
                <button type="submit" className={secondaryButtonClassName}>
                  حفظ التعديل
                </button>
              </form>

              {client.note ? (
                <form action={clearClientNoteAction} className="mt-3">
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <input type="hidden" name="id" value={client.id} />
                  <button type="submit" className={dangerButtonClassName}>
                    حذف الملاحظة
                  </button>
                </form>
              ) : null}

              <form action={toggleClientAction} className="mt-3">
                <input type="hidden" name="returnTo" value={returnTo} />
                <input type="hidden" name="id" value={client.id} />
                <input type="hidden" name="isActive" value={client.isActive ? "false" : "true"} />
                <button type="submit" className={client.isActive ? dangerButtonClassName : primaryButtonClassName}>
                  {client.isActive ? "إيقاف الزبون" : "تفعيل الزبون"}
                </button>
              </form>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function FixedCostsView({
  model,
  returnTo,
  selectedMonth,
}: {
  model: ReturnType<typeof buildReadModel>;
  returnTo: string;
  selectedMonth: string;
}) {
  return (
    <div className="space-y-4">
      <Panel title="إضافة بند ثابت" subtitle="تعريف مصروف متكرر">
        <form action={createFixedCostAction} className="grid grid-cols-5 items-end gap-3 max-xl:grid-cols-2 max-md:grid-cols-1">
          <input type="hidden" name="returnTo" value={returnTo} />
          <FormField label="الاسم">
            <input name="name" required className={fieldClassName} />
          </FormField>
          <FormField label="التصنيف">
            <select name="category" className={fieldClassName}>
              {fixedCostCategories.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </FormField>
          <FormField label="المبلغ">
            <input name="amount" type="number" min="0" step="0.01" required className={fieldClassName} />
          </FormField>
          <FormField label="دورة الدفع">
            <select name="cycle" className={fieldClassName}>
              <option value="MONTHLY">شهري</option>
              <option value="YEARLY">سنوي</option>
            </select>
          </FormField>
          <button type="submit" className={primaryButtonClassName}>
            إضافة بند
          </button>
        </form>
      </Panel>

      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <SummaryCard label="المصاريف الثابتة الشهرية المتوقعة" value={formatCents(model.expectedFixedCostCents)} />
        <SummaryCard label="الصافي المتوقع بعد الثابتة" value={formatCents(model.projectedNetAfterFixedCents)} />
      </div>

      <Panel title="توليد مصاريف الشهر" subtitle="ينشئ حركات خرج ولا يكرر نفس الشهر">
        <form action={generateFixedCostTransactionsAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="returnTo" value={returnTo} />
          <FormField label="الشهر">
            <input name="month" type="month" required defaultValue={selectedMonth} className={fieldClassName} />
          </FormField>
          <FormField label="مدخل الحركة">
            <input name="submittedBy" required placeholder="اسم الشخص" className={fieldClassName} />
          </FormField>
          <button type="submit" className={secondaryButtonClassName}>
            توليد الحركات
          </button>
        </form>
      </Panel>

      <div className="grid grid-cols-3 gap-4 max-xl:grid-cols-2 max-md:grid-cols-1">
        {model.fixedCosts.map((cost) => (
          <article key={cost.id} className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 className="text-lg font-black">{cost.name}</h2>
              <Pill tone={cost.isActive ? "paid" : "unpaid"}>
                {cost.isActive ? "نشط" : "متوقف"}
              </Pill>
            </div>
            <Metric label="التصنيف" value={cost.category} />
            <Metric label="الدفع" value={cost.cycle === "YEARLY" ? "سنوي" : "شهري"} />
            <Metric label="المبلغ" value={formatCents(moneyToCents(cost.amount))} />
            <Metric label="محسوب شهريًا" value={formatCents(monthlyFixedCostCents(cost))} />

            <form action={payFixedCostAction} className="mt-4 grid gap-3 rounded-lg border border-blue-100 bg-blue-50 p-3">
              <input type="hidden" name="returnTo" value={returnTo} />
              <input type="hidden" name="id" value={cost.id} />
              <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                <FormField label="شهر الدفع">
                  <input name="month" type="month" required defaultValue={selectedMonth} className={fieldClassName} />
                </FormField>
                <FormField label="مدخل الحركة">
                  <input name="submittedBy" required placeholder="اسم الشخص" className={fieldClassName} />
                </FormField>
              </div>
              <button type="submit" className={primaryButtonClassName}>
                دفع هذا المصروف
              </button>
            </form>

            <form action={updateFixedCostAction} className="mt-4 grid gap-3">
              <input type="hidden" name="returnTo" value={returnTo} />
              <input type="hidden" name="id" value={cost.id} />
              <FormField label="الاسم">
                <input name="name" required defaultValue={cost.name} className={fieldClassName} />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="التصنيف">
                  <select name="category" defaultValue={cost.category} className={fieldClassName}>
                    {fixedCostCategories.map((category) => (
                      <option key={category}>{category}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="دورة الدفع">
                  <select name="cycle" defaultValue={cost.cycle} className={fieldClassName}>
                    <option value="MONTHLY">شهري</option>
                    <option value="YEARLY">سنوي</option>
                  </select>
                </FormField>
              </div>
              <FormField label="المبلغ">
                <input
                  name="amount"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  defaultValue={cost.amount.toString()}
                  className={fieldClassName}
                />
              </FormField>
              <button type="submit" className={secondaryButtonClassName}>
                حفظ التعديل
              </button>
            </form>

            <form action={toggleFixedCostAction} className="mt-3">
              <input type="hidden" name="returnTo" value={returnTo} />
              <input type="hidden" name="id" value={cost.id} />
              <input type="hidden" name="isActive" value={cost.isActive ? "false" : "true"} />
              <button type="submit" className={cost.isActive ? dangerButtonClassName : primaryButtonClassName}>
                {cost.isActive ? "إيقاف البند" : "تفعيل البند"}
              </button>
            </form>
          </article>
        ))}
      </div>
    </div>
  );
}

function LiabilitiesView({
  clients,
  liabilities,
  returnTo,
  selectedDate,
}: {
  clients: Prisma.ClientGetPayload<object>[];
  liabilities: LiabilityWithClient[];
  returnTo: string;
  selectedDate: string;
}) {
  const open = liabilities.filter((liability) => liability.status !== "PAID");
  const paid = liabilities.filter((liability) => liability.status === "PAID");
  const openTotalCents = open.reduce((sum, liability) => sum + moneyToCents(liability.amount), 0);
  const paidTotalCents = paid.reduce((sum, liability) => sum + moneyToCents(liability.amount), 0);
  const liabilityTotalCents = openTotalCents + paidTotalCents;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
        <SummaryCard label="إجمالي الالتزامات المفتوحة" value={formatCents(openTotalCents)} />
        <SummaryCard label="إجمالي الالتزامات المدفوعة" value={formatCents(paidTotalCents)} />
        <SummaryCard label="إجمالي كل الالتزامات" value={formatCents(liabilityTotalCents)} />
      </div>

      <Panel title="إضافة Liability" subtitle="التزام قبل الدفع">
        <form action={createLiabilityAction} className="grid gap-4">
          <input type="hidden" name="returnTo" value={returnTo} />
          <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-1">
            <FormField label="الجهة / الشخص">
              <input name="name" required placeholder="مثال: مصور حملة زبون 1" className={fieldClassName} />
            </FormField>
            <FormField label="النوع">
              <select name="category" className={fieldClassName}>
                {liabilityCategories.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
            </FormField>
            <FormField label="المبلغ بالدولار">
              <input name="amount" type="number" min="0" step="0.01" required className={fieldClassName} />
            </FormField>
            <FormField label="تاريخ الاستحقاق">
              <input name="dueDate" type="date" required defaultValue={selectedDate} className={fieldClassName} />
            </FormField>
            <FormField label="الزبون المرتبط">
              <select name="clientId" className={fieldClassName}>
                <option value="">بدون زبون</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="ملاحظات">
              <input name="note" placeholder="تفاصيل الالتزام" className={fieldClassName} />
            </FormField>
          </div>
          <div>
            <button type="submit" className={primaryButtonClassName}>
              إضافة Liability
            </button>
          </div>
        </form>
      </Panel>

      <div className="grid grid-cols-2 gap-4 max-xl:grid-cols-1">
        <Panel title="الالتزامات المفتوحة" subtitle={`${open.length} بند`}>
          <LiabilityList liabilities={open} returnTo={returnTo} selectedDate={selectedDate} />
        </Panel>
        <Panel title="المدفوعة" subtitle="تحولت لحركات خرج">
          <LiabilityList liabilities={paid} returnTo={returnTo} selectedDate={selectedDate} />
        </Panel>
      </div>
    </div>
  );
}

function LiabilityList({
  liabilities,
  returnTo,
  selectedDate,
}: {
  liabilities: LiabilityWithClient[];
  returnTo: string;
  selectedDate: string;
}) {
  if (!liabilities.length) {
    return <p className="text-sm font-bold text-slate-500">لا يوجد بنود في هذا القسم.</p>;
  }

  return (
    <div className="grid gap-3">
      {liabilities.map((liability) => {
        const dueDate = dateToDateKey(liability.dueDate);
        const paid = liability.status === "PAID";

        return (
          <article key={liability.id} className="rounded-lg border border-stone-200 bg-stone-50 p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-black">{liability.name}</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {liability.category}
                  {liability.client ? ` / ${liability.client.name}` : ""}
                </p>
              </div>
              <Pill tone={paid ? "paid" : "partial"}>{paid ? "مدفوع" : "مفتوح"}</Pill>
            </div>
            <Metric label="المبلغ" value={formatCents(moneyToCents(liability.amount))} />
            <Metric label="الاستحقاق" value={dueDate} />
            <Metric label="ملاحظات" value={liability.note ?? "-"} />
            {paid ? null : (
              <div className="mt-4 flex flex-wrap gap-2">
                <form action={payLiabilityAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <input type="hidden" name="id" value={liability.id} />
                  <input type="date" name="paidDate" defaultValue={selectedDate} className={fieldClassName} />
                  <input name="submittedBy" required placeholder="مدخل الحركة" className={fieldClassName} />
                  <button type="submit" className={primaryButtonClassName}>
                    دفع
                  </button>
                </form>
                <form action={deleteOpenLiabilityAction}>
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <input type="hidden" name="id" value={liability.id} />
                  <button type="submit" className={dangerButtonClassName}>
                    حذف
                  </button>
                </form>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function ReportsView({
  importError,
  importSuccess,
  model,
  returnTo,
}: {
  importError?: string;
  importSuccess?: string;
  model: ReturnType<typeof buildReadModel>;
  returnTo: string;
}) {
  return (
    <div className="space-y-4">
      {importSuccess ? (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-900">
          تم الاستيراد: {importSuccess}
        </section>
      ) : null}
      {importError ? (
        <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-900">
          فشل الاستيراد: {importError}
        </section>
      ) : null}

      <Panel title="نسخ البيانات" subtitle="JSON">
        <div className="grid grid-cols-[auto_1fr] gap-4 max-lg:grid-cols-1">
          <div>
            <a href="/api/export" className={secondaryButtonClassName}>
              تصدير JSON
            </a>
          </div>
          <form action={importLegacyJsonAction} encType="multipart/form-data" className="grid gap-3">
            <input type="hidden" name="returnTo" value={returnTo} />
            <FormField label="ملف JSON">
              <input name="importFile" type="file" accept="application/json,.json" required className={fieldClassName} />
            </FormField>
            <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
              <input name="confirmReplace" type="checkbox" value="REPLACE" required className="size-4 accent-blue-700" />
              استبدال بيانات قاعدة البيانات الحالية
            </label>
            <div>
              <button type="submit" className={dangerButtonClassName}>
                استيراد واستبدال
              </button>
            </div>
          </form>
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-4 max-xl:grid-cols-1">
      <Panel title="تكلفة كل قسم" subtitle="للفترة المختارة">
        <CategoryRows totals={model.categoryTotals} />
      </Panel>
      <Panel title="تقرير كل زبون" subtitle="للفترة المختارة">
        <div className="grid gap-4">
          {model.clientReports.map((report) => (
            <article key={report.id} className="border-b border-stone-100 pb-4 last:border-b-0 last:pb-0">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="font-black">{report.name}</h3>
                <Pill tone={report.remainingCents === 0 ? "paid" : report.incomeCents > 0 ? "partial" : "unpaid"}>
                  {report.remainingCents === 0 ? "مدفوع" : report.incomeCents > 0 ? "جزئي" : "غير مدفوع"}
                </Pill>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <MiniMetric label="المتوقع" value={formatCents(report.expectedCents)} />
                <MiniMetric label="المدفوع" value={formatCents(report.incomeCents)} />
                <MiniMetric label="المتبقي" value={formatCents(report.remainingCents)} />
                <MiniMetric label="تكاليف مباشرة" value={formatCents(report.costCents)} />
                <MiniMetric label="الصافي" value={formatCents(report.netCents)} />
              </div>
            </article>
          ))}
        </div>
      </Panel>
      <section className="col-span-2 max-xl:col-span-1">
        <Panel title="الحركة اليومية" subtitle="داخل وخرج وصافي">
          <div className="grid grid-cols-2 gap-x-6 max-lg:grid-cols-1">
            {model.dailyRows.length ? (
              model.dailyRows.map((row) => (
                <Metric
                  key={row.date}
                  label={row.date}
                  value={`${formatCents(row.incomeCents)} / ${formatCents(row.expenseCents)} / ${formatCents(row.netCents)}`}
                />
              ))
            ) : (
              <p className="text-sm font-bold text-slate-500">لا يوجد حركة يومية بهذه الفترة.</p>
            )}
          </div>
        </Panel>
      </section>
    </div>
    </div>
  );
}

function FormField({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-bold text-slate-600">
      {label}
      {children}
    </label>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-black">{title}</h2>
        {subtitle ? <span className="text-sm font-bold text-slate-500">{subtitle}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-stone-100 py-3 text-sm">
      <span className="font-bold text-slate-500">{label}</span>
      <strong className="text-left">{value}</strong>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
      <span className="block text-xs font-bold text-slate-500">{label}</span>
      <strong className="mt-1 block">{value}</strong>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <span className="text-sm font-bold text-slate-500">{label}</span>
      <strong className="mt-2 block text-2xl">{value}</strong>
    </article>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone: "paid" | "partial" | "unpaid" }) {
  const className = {
    paid: "bg-emerald-100 text-emerald-800",
    partial: "bg-blue-100 text-blue-800",
    unpaid: "bg-amber-100 text-amber-800",
  }[tone];

  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${className}`}>
      {children}
    </span>
  );
}

function CategoryBars({ totals }: { totals: { category: string; amountCents: number }[] }) {
  if (!totals.length) {
    return <p className="mt-4 text-sm font-bold text-slate-500">لا يوجد خرج مسجل بهذه الفترة بعد.</p>;
  }

  const max = Math.max(...totals.map((item) => item.amountCents), 1);

  return (
    <div className="mt-4 grid gap-3">
      {totals.map((item) => (
        <div key={item.category}>
          <div className="mb-2 flex justify-between gap-3 text-sm">
            <span className="font-bold text-slate-500">{item.category}</span>
            <strong>{formatCents(item.amountCents)}</strong>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-stone-100">
            <div
              className="h-full rounded-full bg-teal-700"
              style={{ width: `${(item.amountCents / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function CategoryRows({ totals }: { totals: { category: string; amountCents: number }[] }) {
  if (!totals.length) {
    return <p className="text-sm font-bold text-slate-500">لا يوجد تكاليف بهذه الفترة.</p>;
  }

  return (
    <div>
      {totals.map((item) => (
        <Metric key={item.category} label={item.category} value={formatCents(item.amountCents)} />
      ))}
    </div>
  );
}

function ClientCollectionList({ model }: { model: ReturnType<typeof buildReadModel> }) {
  return (
    <div className="grid gap-1">
      {model.clientReports.map((report) => (
        <div key={report.id} className="flex items-center justify-between gap-3 border-b border-stone-100 py-3">
          <span className="font-bold">{report.name}</span>
          <strong className="text-sm">
            {formatCents(report.incomeCents)} / {formatCents(report.expectedCents)}
          </strong>
          <Pill tone={report.remainingCents === 0 ? "paid" : report.incomeCents > 0 ? "partial" : "unpaid"}>
            {report.remainingCents === 0 ? "مدفوع" : report.incomeCents > 0 ? "جزئي" : "غير مدفوع"}
          </Pill>
        </div>
      ))}
    </div>
  );
}

function DatabaseError({ error }: { error: unknown }) {
  return (
    <section className="rounded-lg border border-red-200 bg-red-50 p-5 text-red-950">
      <h2 className="text-lg font-black">قاعدة البيانات غير متاحة</h2>
      <p className="mt-2 text-sm font-bold">
        شغل قاعدة البيانات المحلية أولًا عبر `npm.cmd run db:local:start` ثم أعد تحميل الصفحة.
      </p>
      <pre className="mt-4 overflow-x-auto rounded-lg bg-white p-3 text-xs text-red-800">
        {error instanceof Error ? error.message : "Unknown database error"}
      </pre>
    </section>
  );
}

function buildChartDays(
  transactions: {
    type: "INCOME" | "EXPENSE" | "PARTNER";
    date: Date;
    amount: Prisma.Decimal;
    category: string;
    clientId: string | null;
  }[],
  mode: FilterMode,
  selectedMonth: string,
  selectedDate: string,
) {
  const days =
    mode === "day"
      ? [selectedDate]
      : Array.from({ length: daysInMonth(selectedMonth) }, (_, index) => {
          const day = String(index + 1).padStart(2, "0");
          return `${selectedMonth}-${day}`;
        });
  const byDate = new Map(
    days.map((date) => [
      date,
      { date, incomeCents: 0, expenseCents: 0, netCents: 0 },
    ]),
  );

  for (const transaction of transactions) {
    const date = dateToDateKey(transaction.date);
    const summary = byDate.get(date);
    if (!summary) continue;

    const amount = moneyToCents(transaction.amount);
    if (
      transaction.type === "INCOME" ||
      (transaction.type === "PARTNER" && transaction.category === PARTNER_DEPOSIT_CATEGORY)
    ) {
      summary.incomeCents += amount;
    } else {
      summary.expenseCents += amount;
    }
    summary.netCents = summary.incomeCents - summary.expenseCents;
  }

  return [...byDate.values()];
}

function categoryTotals(transactions: TransactionWithClient[]) {
  const totals = new Map<string, number>();

  for (const transaction of transactions) {
    if (
      transaction.type === "INCOME" ||
      (transaction.type === "PARTNER" && transaction.category === PARTNER_DEPOSIT_CATEGORY)
    ) {
      continue;
    }
    totals.set(
      transaction.category,
      (totals.get(transaction.category) ?? 0) + moneyToCents(transaction.amount),
    );
  }

  return [...totals.entries()]
    .map(([category, amountCents]) => ({ category, amountCents }))
    .sort((a, b) => b.amountCents - a.amountCents);
}

function clientReports(clients: Prisma.ClientGetPayload<object>[], transactions: TransactionWithClient[]) {
  return clients.map((client) => {
    const clientTransactions = transactions.filter((transaction) => transaction.clientId === client.id);
    const incomeCents = clientTransactions
      .filter((transaction) => transaction.type === "INCOME")
      .reduce((sum, transaction) => sum + moneyToCents(transaction.amount), 0);
    const costCents = clientTransactions
      .filter((transaction) => transaction.type !== "INCOME")
      .reduce((sum, transaction) => sum + moneyToCents(transaction.amount), 0);
    const expectedCents = moneyToCents(client.monthlyFee);
    const remainingCents = Math.max(0, expectedCents - incomeCents);

    return {
      id: client.id,
      name: client.name,
      expectedCents,
      incomeCents,
      remainingCents,
      costCents,
      netCents: incomeCents - costCents,
    };
  });
}

function dailyRows(transactions: TransactionWithClient[]) {
  const totals = new Map<string, { incomeCents: number; expenseCents: number }>();

  for (const transaction of transactions) {
    const date = dateToDateKey(transaction.date);
    const row = totals.get(date) ?? { incomeCents: 0, expenseCents: 0 };
    const amount = moneyToCents(transaction.amount);

    if (transaction.type === "INCOME") {
      row.incomeCents += amount;
    } else if (!(transaction.type === "PARTNER" && transaction.category === PARTNER_DEPOSIT_CATEGORY)) {
      row.expenseCents += amount;
    }

    totals.set(date, row);
  }

  return [...totals.entries()]
    .map(([date, value]) => ({
      date,
      incomeCents: value.incomeCents,
      expenseCents: value.expenseCents,
      netCents: value.incomeCents - value.expenseCents,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

function monthOptions(transactions: TransactionWithClient[], selectedMonth: string) {
  const months = new Set([selectedMonth, monthKeyFromDateKey(todayKey(env.APP_TIME_ZONE))]);
  for (const transaction of transactions) {
    months.add(monthKeyFromDateKey(dateToDateKey(transaction.date)));
  }

  return [...months].sort().reverse();
}

function monthlyFixedCostCents(cost: Prisma.FixedCostGetPayload<object>) {
  const amount = moneyToCents(cost.amount);

  return cost.cycle === "YEARLY" ? Math.round(amount / 12) : amount;
}

function isInActivePeriod(date: Date, mode: FilterMode, selectedMonth: string, selectedDate: string) {
  const dateKey = dateToDateKey(date);

  return mode === "day" ? dateKey === selectedDate : dateKey.startsWith(`${selectedMonth}-`);
}

function daysInMonth(monthKey: string) {
  return new Date(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)), 0).getDate();
}

function barHeight(value: number, maxValue: number) {
  return Math.max(4, (value / maxValue) * 120);
}

function transactionTypeLabel(type: "INCOME" | "EXPENSE" | "PARTNER") {
  return type === "INCOME" ? "داخل" : type === "PARTNER" ? "شريك" : "خرج";
}

function sortTransactions(transactions: TransactionWithClient[], sort: TransactionSortKey) {
  const sorted = [...transactions];

  if (sort === "type") {
    return sorted.sort((a, b) => {
      const byType = compareArabicText(transactionTypeLabel(a.type), transactionTypeLabel(b.type));
      if (byType !== 0) return byType;

      const byClient = compareNullableClientNames(a.client?.name, b.client?.name);
      if (byClient !== 0) return byClient;

      return compareTransactionsByDateDesc(a, b);
    });
  }

  if (sort === "client") {
    return sorted.sort((a, b) => {
      const byClient = compareNullableClientNames(a.client?.name, b.client?.name);
      if (byClient !== 0) return byClient;

      const byType = compareArabicText(transactionTypeLabel(a.type), transactionTypeLabel(b.type));
      if (byType !== 0) return byType;

      return compareTransactionsByDateDesc(a, b);
    });
  }

  return sorted;
}

function compareNullableClientNames(a: string | null | undefined, b: string | null | undefined) {
  const aName = a?.trim();
  const bName = b?.trim();

  if (aName && !bName) return -1;
  if (!aName && bName) return 1;
  if (!aName && !bName) return 0;

  return compareArabicText(aName ?? "", bName ?? "");
}

function compareArabicText(a: string, b: string) {
  return a.localeCompare(b, "ar", { sensitivity: "base" });
}

function compareTransactionsByDateDesc(a: TransactionWithClient, b: TransactionWithClient) {
  const byDate = b.date.getTime() - a.date.getTime();
  if (byDate !== 0) return byDate;

  return b.createdAt.getTime() - a.createdAt.getTime();
}

function normalizeView(view: string | undefined): ViewKey {
  return views.some((item) => item.key === view) ? (view as ViewKey) : "dashboard";
}

function normalizeTransactionSort(sort: string | undefined): TransactionSortKey {
  return sort === "type" || sort === "client" ? sort : "date";
}

function hrefFor({
  view,
  mode,
  selectedMonth,
  selectedDate,
  transactionSort,
}: {
  view: ViewKey;
  mode: FilterMode;
  selectedMonth: string;
  selectedDate: string;
  transactionSort?: TransactionSortKey;
}) {
  const params = new URLSearchParams({ view, mode });

  if (mode === "day") {
    params.set("day", selectedDate);
  } else {
    params.set("month", selectedMonth);
  }

  if (view === "transactions" && transactionSort && transactionSort !== "date") {
    params.set("transactionSort", transactionSort);
  }

  return `/?${params.toString()}`;
}

function validDateKey(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validMonthKey(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value);
}
