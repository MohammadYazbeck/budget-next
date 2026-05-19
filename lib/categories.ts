export const CUSTOMER_INCOME_CATEGORY = "دخل زبائن";
export const PARTNER_DEPOSIT_CATEGORY = "إيداع شريك";

export const transactionCategories = {
  INCOME: [CUSTOMER_INCOME_CATEGORY],
  EXPENSE: ["رواتب", "أجار", "تصوير", "اشتراكات وخدمات", "تشغيل"],
  PARTNER: [PARTNER_DEPOSIT_CATEGORY, "سحب شريك", "دين على الشركة"],
} as const;

export const fixedCostCategories = [
  "رواتب",
  "أجار",
  "تصوير",
  "اشتراكات وخدمات",
  "تشغيل",
] as const;

export const liabilityCategories = [
  "مصورين",
  "فريلانسر",
  "موردين",
  "أدوات وخدمات",
  "أخرى",
] as const;

export const liabilityExpenseCategory = (category: string) =>
  ({
    مصورين: "تصوير",
    فريلانسر: "تشغيل",
    موردين: "تشغيل",
    "أدوات وخدمات": "اشتراكات وخدمات",
    أخرى: "تشغيل",
  })[category] ?? "تشغيل";
