import { CostCycle, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const clients = [
  { name: "زبون 1", monthlyFee: "350.00", dueDay: 1 },
  { name: "زبون 2", monthlyFee: "500.00", dueDay: 1 },
  { name: "زبون 3", monthlyFee: "650.00", dueDay: 5 },
  { name: "زبون 4", monthlyFee: "420.00", dueDay: 5 },
  { name: "زبون 5", monthlyFee: "800.00", dueDay: 10 },
  { name: "زبون 6", monthlyFee: "300.00", dueDay: 10 },
  { name: "زبون 7", monthlyFee: "550.00", dueDay: 15 },
  { name: "زبون 8", monthlyFee: "700.00", dueDay: 15 },
  { name: "زبون 9", monthlyFee: "450.00", dueDay: 20 },
  { name: "زبون 10", monthlyFee: "600.00", dueDay: 20 },
  { name: "زبون 11", monthlyFee: "900.00", dueDay: 25 },
  { name: "زبون 12", monthlyFee: "380.00", dueDay: 25 },
  { name: "زبون 13", monthlyFee: "520.00", dueDay: 28 },
];

const fixedCosts = [
  { name: "راتب موظف 1", category: "رواتب", amount: "700.00", cycle: CostCycle.MONTHLY },
  { name: "راتب موظف 2", category: "رواتب", amount: "650.00", cycle: CostCycle.MONTHLY },
  { name: "راتب موظف 3", category: "رواتب", amount: "600.00", cycle: CostCycle.MONTHLY },
  { name: "راتب موظف 4", category: "رواتب", amount: "550.00", cycle: CostCycle.MONTHLY },
  { name: "راتب موظف 5", category: "رواتب", amount: "500.00", cycle: CostCycle.MONTHLY },
  { name: "راتب موظف 6", category: "رواتب", amount: "450.00", cycle: CostCycle.MONTHLY },
  { name: "راتب موظف 7", category: "رواتب", amount: "400.00", cycle: CostCycle.MONTHLY },
  { name: "أجار المكتب", category: "أجار", amount: "650.00", cycle: CostCycle.MONTHLY },
  { name: "ChatGPT", category: "اشتراكات وخدمات", amount: "20.00", cycle: CostCycle.MONTHLY },
  { name: "Freepik", category: "اشتراكات وخدمات", amount: "15.00", cycle: CostCycle.MONTHLY },
];

async function main() {
  await prisma.$transaction([
    prisma.liability.deleteMany(),
    prisma.transaction.deleteMany(),
    prisma.fixedCost.deleteMany(),
    prisma.client.deleteMany(),
  ]);

  await prisma.client.createMany({ data: clients });
  await prisma.fixedCost.createMany({ data: fixedCosts });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
