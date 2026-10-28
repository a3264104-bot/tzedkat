-- 2026-10-28: שלוש תוספות בלבד (additive). הורץ ידנית דרך prisma db execute.

-- 1) מחיר שמור לנציג במוצר נסתר (מועדף / לא פעיל). שורה לכל נציג+מוצר.
CREATE TABLE IF NOT EXISTS "AgentProductPrice" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentProductPrice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AgentProductPrice_agentId_productId_key" ON "AgentProductPrice"("agentId", "productId");
CREATE INDEX IF NOT EXISTS "AgentProductPrice_productId_idx" ON "AgentProductPrice"("productId");
DO $$ BEGIN
  ALTER TABLE "AgentProductPrice" ADD CONSTRAINT "AgentProductPrice_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AgentProductPrice" ADD CONSTRAINT "AgentProductPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) בעלות על חוב: מי רשם אותו (נציג / מנהל).
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "debtOwners" JSONB;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "appliedDebtOwners" JSONB;
ALTER TABLE "DebtLedger" ADD COLUMN IF NOT EXISTS "ownerKey" TEXT;
ALTER TABLE "DebtLedger" ADD COLUMN IF NOT EXISTS "method" TEXT;
ALTER TABLE "DebtLedger" ADD COLUMN IF NOT EXISTS "transactionId" TEXT;

-- 3) גיבוי הזמנה לפני ביטול — כדי שאפשר יהיה לשחזר.
CREATE TABLE IF NOT EXISTS "OrderBackup" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CANCEL',
    "reason" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restoredAt" TIMESTAMP(3),
    "restoredBy" TEXT,
    CONSTRAINT "OrderBackup_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "OrderBackup_orderId_idx" ON "OrderBackup"("orderId");
