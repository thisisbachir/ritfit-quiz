-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quiz" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "draft" JSONB NOT NULL,
    "published" JSONB,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Response" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "answerLabels" JSONB NOT NULL,
    "email" TEXT,
    "emailConsent" BOOLEAN NOT NULL DEFAULT false,
    "recommendedIds" JSONB NOT NULL,
    "klaviyoSyncedAt" TIMESTAMP(3),
    "klaviyoError" TEXT,
    "orderId" TEXT,
    "orderName" TEXT,
    "orderTotal" DECIMAL(12,2),
    "orderCurrency" TEXT,
    "purchasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Response_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "responseId" TEXT,
    "value" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogCache" (
    "shop" TEXT NOT NULL,
    "products" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogCache_pkey" PRIMARY KEY ("shop")
);

-- CreateIndex
CREATE INDEX "Quiz_shop_idx" ON "Quiz"("shop");

-- CreateIndex
CREATE INDEX "Response_quizId_createdAt_idx" ON "Response"("quizId", "createdAt");

-- CreateIndex
CREATE INDEX "Response_shop_idx" ON "Response"("shop");

-- CreateIndex
CREATE INDEX "Event_quizId_type_createdAt_idx" ON "Event"("quizId", "type", "createdAt");

-- AddForeignKey
ALTER TABLE "Response" ADD CONSTRAINT "Response_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;
