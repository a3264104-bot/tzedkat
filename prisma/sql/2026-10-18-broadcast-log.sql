-- יומן שליחות מייל ללקוחות — שתי טבלאות חדשות בלבד.
-- ⚠️ הורץ ידנית (prisma db execute) ולא דרך db push: המסד בייצור
-- סטה מהסכמה, ו-db push היה מוחק את Product.avgWeightPerPiece ועוד.

CREATE TABLE IF NOT EXISTS "BroadcastLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "subject" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "pricelistId" TEXT,
    "attachmentCount" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'SENDING',
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "BroadcastLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BroadcastRecipient" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "customerId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "resendId" TEXT,
    "sentAt" TIMESTAMP(3),
    CONSTRAINT "BroadcastRecipient_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BroadcastRecipient_broadcastId_fkey" FOREIGN KEY ("broadcastId")
        REFERENCES "BroadcastLog"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "BroadcastLog_createdAt_idx" ON "BroadcastLog"("createdAt");
CREATE INDEX IF NOT EXISTS "BroadcastRecipient_broadcastId_status_idx" ON "BroadcastRecipient"("broadcastId", "status");
