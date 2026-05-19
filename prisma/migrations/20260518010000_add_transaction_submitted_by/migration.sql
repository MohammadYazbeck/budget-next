-- Add optional submitter name for manual and generated transactions.
ALTER TABLE "Transaction" ADD COLUMN "submittedBy" TEXT;

CREATE INDEX "Transaction_submittedBy_idx" ON "Transaction"("submittedBy");
