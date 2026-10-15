-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('DOWN', 'POWER', 'OTHER');

-- CreateEnum
CREATE TYPE "AlarmStatus" AS ENUM ('ACTIVE', 'CLEARED');

-- CreateEnum
CREATE TYPE "ClearType" AS ENUM ('EMAIL', 'AUTO_SUPERSEDED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('VIEWER', 'OPERATOR', 'ADMIN');

-- CreateTable
CREATE TABLE "raw_messages" (
    "id" SERIAL NOT NULL,
    "gmailId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "body" TEXT,
    "office" TEXT,
    "parseError" TEXT,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "raw_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alarms" (
    "id" SERIAL NOT NULL,
    "alarmKey" TEXT NOT NULL,
    "alarmName" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "category" "Category" NOT NULL,
    "alarmTime" TIMESTAMP(3) NOT NULL,
    "status" "AlarmStatus" NOT NULL DEFAULT 'ACTIVE',
    "clearTime" TIMESTAMP(3),
    "durationMin" INTEGER,
    "clearType" "ClearType",
    "consecNbr" TEXT,
    "cellName" TEXT,
    "device" TEXT,
    "office" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alarms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orphan_clears" (
    "id" SERIAL NOT NULL,
    "alarmKey" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "clearTime" TIMESTAMP(3) NOT NULL,
    "rawMessageId" INTEGER NOT NULL,
    "consecNbr" TEXT,
    "office" TEXT,

    CONSTRAINT "orphan_clears_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" SERIAL NOT NULL,
    "pattern" TEXT NOT NULL,
    "category" "Category" NOT NULL,
    "priority" INTEGER NOT NULL,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "site" TEXT NOT NULL,
    "region" TEXT,
    "owner" TEXT,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("site")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "notifyPrefs" JSONB,
    "notificationsSeenAt" TIMESTAMP(3),
    "displayPrefs" JSONB,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_status" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "lastHistoryId" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastRunMessages" INTEGER NOT NULL DEFAULT 0,
    "reprocessDays" INTEGER,
    "officeLabel" TEXT,
    "syncedLabel" TEXT,
    "availableLabels" JSONB,
    "displayFilter" JSONB,

    CONSTRAINT "system_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_master" (
    "code" TEXT NOT NULL,
    "siteName" TEXT,
    "office" TEXT NOT NULL,
    "nodality" TEXT,
    "vip" BOOLEAN NOT NULL DEFAULT false,
    "siteType" TEXT,
    "powerSource" TEXT,
    "battery" TEXT,
    "phone" TEXT,
    "region" TEXT,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_master_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "hourly_normalizations" (
    "id" SERIAL NOT NULL,
    "field" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,

    CONSTRAINT "hourly_normalizations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "raw_messages_gmailId_key" ON "raw_messages"("gmailId");

-- CreateIndex
CREATE INDEX "raw_messages_receivedAt_idx" ON "raw_messages"("receivedAt");

-- CreateIndex
CREATE INDEX "raw_messages_office_idx" ON "raw_messages"("office");

-- CreateIndex
CREATE UNIQUE INDEX "alarms_consecNbr_key" ON "alarms"("consecNbr");

-- CreateIndex
CREATE INDEX "alarms_alarmKey_alarmTime_idx" ON "alarms"("alarmKey", "alarmTime");

-- CreateIndex
CREATE INDEX "alarms_status_category_idx" ON "alarms"("status", "category");

-- CreateIndex
CREATE INDEX "alarms_office_status_idx" ON "alarms"("office", "status");

-- CreateIndex
CREATE INDEX "alarms_site_idx" ON "alarms"("site");

-- CreateIndex
CREATE INDEX "orphan_clears_alarmKey_idx" ON "orphan_clears"("alarmKey");

-- CreateIndex
CREATE INDEX "orphan_clears_consecNbr_idx" ON "orphan_clears"("consecNbr");

-- CreateIndex
CREATE INDEX "rules_priority_idx" ON "rules"("priority");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "site_master_office_idx" ON "site_master"("office");

-- CreateIndex
CREATE UNIQUE INDEX "hourly_normalizations_field_from_key" ON "hourly_normalizations"("field", "from");

-- AddForeignKey
ALTER TABLE "orphan_clears" ADD CONSTRAINT "orphan_clears_rawMessageId_fkey" FOREIGN KEY ("rawMessageId") REFERENCES "raw_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

