import type { NotificationPermissionStatus } from '../../../generated/client/index.js'

export type PushPlatform = 'ios' | 'android'

export interface NotificationSettingsRecord {
  userId: string
  directMessagesEnabled: boolean
  updatedAt: Date
}

export interface PushDeviceRegistrationRecord {
  userId: string
  installationId: string
  platform: PushPlatform
  expoPushToken: string
  permissionStatus: NotificationPermissionStatus
  appVersion: string | null
  lastSeenAt: Date
  disabledAt: Date | null
}

export interface UpsertPushDeviceInput {
  installationId: string
  expoPushToken: string
  platform: PushPlatform
  permissionStatus: NotificationPermissionStatus
  appVersion?: string | null
}

export interface MessageNotificationEvent {
  eventId: string
  messageId: string
  conversationId: string
  senderId: string
  recipientIds: string[]
}

export interface PushMessageInput {
  to: string
  title: string
  body: string
  channelId?: string
  data: Record<string, string>
}

export interface PushSendReceipt {
  status: 'ok' | 'error'
  id?: string
  message?: string
}

export interface NotifyRepositoryPort {
  getNotificationSettings(userId: string): Promise<NotificationSettingsRecord>
  updateNotificationSettings(
    userId: string,
    input: { directMessagesEnabled: boolean }
  ): Promise<NotificationSettingsRecord>
  upsertPushDevice(
    userId: string,
    input: UpsertPushDeviceInput
  ): Promise<PushDeviceRegistrationRecord>
  disablePushDevice(userId: string, installationId: string): Promise<boolean>
  listActivePushDevices(userId: string): Promise<PushDeviceRegistrationRecord[]>
  claimMessageDelivery(input: {
    eventId: string
    userId: string
    installationId: string
    messageId: string
    conversationId: string
    expoPushToken: string
  }): Promise<boolean>
  markMessageDeliverySent(input: {
    eventId: string
    installationId: string
    expoTicketId?: string
  }): Promise<void>
  markMessageDeliveryFailed(input: {
    eventId: string
    installationId: string
    error: string
  }): Promise<void>
}

export interface PushSenderPort {
  sendMany(messages: PushMessageInput[]): Promise<PushSendReceipt[]>
}
