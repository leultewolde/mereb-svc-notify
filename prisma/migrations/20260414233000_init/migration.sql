-- CreateEnum
CREATE TYPE "NotificationPermissionStatus" AS ENUM ('UNKNOWN', 'GRANTED', 'DENIED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "userId" TEXT NOT NULL,
    "directMessagesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "PushDeviceRegistration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "platform" VARCHAR(16) NOT NULL,
    "expoPushToken" VARCHAR(255) NOT NULL,
    "permissionStatus" "NotificationPermissionStatus" NOT NULL DEFAULT 'UNKNOWN',
    "appVersion" VARCHAR(32),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushDeviceRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "eventId" VARCHAR(128) NOT NULL,
    "userId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "messageId" VARCHAR(128) NOT NULL,
    "conversationId" VARCHAR(128) NOT NULL,
    "notificationType" VARCHAR(32) NOT NULL,
    "expoPushToken" VARCHAR(255) NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "expoTicketId" VARCHAR(255),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PushDeviceRegistration_userId_disabledAt_idx" ON "PushDeviceRegistration"("userId", "disabledAt");

-- CreateIndex
CREATE INDEX "PushDeviceRegistration_expoPushToken_idx" ON "PushDeviceRegistration"("expoPushToken");

-- CreateIndex
CREATE UNIQUE INDEX "PushDeviceRegistration_userId_installationId_key" ON "PushDeviceRegistration"("userId", "installationId");

-- CreateIndex
CREATE INDEX "NotificationDelivery_userId_createdAt_idx" ON "NotificationDelivery"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_createdAt_idx" ON "NotificationDelivery"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_eventId_installationId_key" ON "NotificationDelivery"("eventId", "installationId");
