-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "quoteId" TEXT,
    "senderId" TEXT,
    "senderName" TEXT NOT NULL,
    "senderEmail" TEXT NOT NULL,
    "senderRole" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Message_orderId_idx" ON "Message"("orderId");

-- CreateIndex
CREATE INDEX "Message_quoteId_idx" ON "Message"("quoteId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
