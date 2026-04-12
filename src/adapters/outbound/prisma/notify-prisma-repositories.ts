import type { NotificationPermissionStatus as NotificationPermissionStatusModel, Prisma, PrismaClient } from '../../../../generated/client/index.js'
import {
  NotificationDeliveryStatus,
  NotificationPermissionStatus
} from '../../../../generated/client/index.js'
import { prisma } from '../../../prisma.js'
import type {
  NotificationSettingsRecord,
  NotifyRepositoryPort,
  PushDeviceRegistrationRecord,
  UpsertPushDeviceInput
} from '../../../application/notify/ports.js'

type NotifyPrismaDb = PrismaClient | Prisma.TransactionClient

function toNotificationSettingsRecord(input: {
  userId: string
  directMessagesEnabled: boolean
  updatedAt: Date
}): NotificationSettingsRecord {
  return {
    userId: input.userId,
    directMessagesEnabled: input.directMessagesEnabled,
    updatedAt: input.updatedAt
  }
}

function toPushDeviceRegistrationRecord(input: {
  userId: string
  installationId: string
  platform: string
  expoPushToken: string
  permissionStatus: NotificationPermissionStatusModel
  appVersion: string | null
  lastSeenAt: Date
  disabledAt: Date | null
}): PushDeviceRegistrationRecord {
  return {
    userId: input.userId,
    installationId: input.installationId,
    platform: input.platform.toLowerCase() === 'ios' ? 'ios' : 'android',
    expoPushToken: input.expoPushToken,
    permissionStatus: input.permissionStatus,
    appVersion: input.appVersion,
    lastSeenAt: input.lastSeenAt,
    disabledAt: input.disabledAt
  }
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  )
}

export class PrismaNotifyRepository implements NotifyRepositoryPort {
  constructor(private readonly db: NotifyPrismaDb = prisma) {}

  async getNotificationSettings(userId: string): Promise<NotificationSettingsRecord> {
    const row = await this.db.notificationPreference.findUnique({
      where: { userId }
    })

    return row
      ? toNotificationSettingsRecord(row)
      : {
          userId,
          directMessagesEnabled: false,
          updatedAt: new Date(0)
        }
  }

  async updateNotificationSettings(
    userId: string,
    input: { directMessagesEnabled: boolean }
  ): Promise<NotificationSettingsRecord> {
    const row = await this.db.notificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        directMessagesEnabled: input.directMessagesEnabled
      },
      update: {
        directMessagesEnabled: input.directMessagesEnabled
      }
    })

    return toNotificationSettingsRecord(row)
  }

  async upsertPushDevice(
    userId: string,
    input: UpsertPushDeviceInput
  ): Promise<PushDeviceRegistrationRecord> {
    const now = new Date()

    await this.db.pushDeviceRegistration.updateMany({
      where: {
        expoPushToken: input.expoPushToken,
        OR: [
          { userId: { not: userId } },
          { installationId: { not: input.installationId } }
        ],
        disabledAt: null
      },
      data: {
        disabledAt: now
      }
    })

    const row = await this.db.pushDeviceRegistration.upsert({
      where: {
        userId_installationId: {
          userId,
          installationId: input.installationId
        }
      },
      create: {
        userId,
        installationId: input.installationId,
        platform: input.platform.toUpperCase(),
        expoPushToken: input.expoPushToken,
        permissionStatus: input.permissionStatus,
        appVersion: input.appVersion ?? null,
        lastSeenAt: now,
        disabledAt: null
      },
      update: {
        platform: input.platform.toUpperCase(),
        expoPushToken: input.expoPushToken,
        permissionStatus: input.permissionStatus,
        appVersion: input.appVersion ?? null,
        lastSeenAt: now,
        disabledAt: null
      }
    })

    return toPushDeviceRegistrationRecord(row)
  }

  async disablePushDevice(userId: string, installationId: string): Promise<boolean> {
    const result = await this.db.pushDeviceRegistration.updateMany({
      where: {
        userId,
        installationId,
        disabledAt: null
      },
      data: {
        disabledAt: new Date()
      }
    })

    return result.count > 0
  }

  async listActivePushDevices(userId: string): Promise<PushDeviceRegistrationRecord[]> {
    const rows = await this.db.pushDeviceRegistration.findMany({
      where: {
        userId,
        disabledAt: null,
        permissionStatus: NotificationPermissionStatus.GRANTED
      },
      orderBy: { updatedAt: 'desc' }
    })

    return rows.map(toPushDeviceRegistrationRecord)
  }

  async claimMessageDelivery(input: {
    eventId: string
    userId: string
    installationId: string
    messageId: string
    conversationId: string
    expoPushToken: string
  }): Promise<boolean> {
    try {
      await this.db.notificationDelivery.create({
        data: {
          eventId: input.eventId,
          userId: input.userId,
          installationId: input.installationId,
          messageId: input.messageId,
          conversationId: input.conversationId,
          notificationType: 'message',
          expoPushToken: input.expoPushToken,
          status: NotificationDeliveryStatus.PENDING
        }
      })
      return true
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        return false
      }
      throw error
    }
  }

  async markMessageDeliverySent(input: {
    eventId: string
    installationId: string
    expoTicketId?: string
  }): Promise<void> {
    await this.db.notificationDelivery.updateMany({
      where: {
        eventId: input.eventId,
        installationId: input.installationId
      },
      data: {
        status: NotificationDeliveryStatus.SENT,
        expoTicketId: input.expoTicketId ?? null,
        sentAt: new Date(),
        error: null
      }
    })
  }

  async markMessageDeliveryFailed(input: {
    eventId: string
    installationId: string
    error: string
  }): Promise<void> {
    await this.db.notificationDelivery.updateMany({
      where: {
        eventId: input.eventId,
        installationId: input.installationId
      },
      data: {
        status: NotificationDeliveryStatus.FAILED,
        error: input.error
      }
    })
  }
}
