import type { GraphQLContext } from '../../context.js'
import { createLogger } from '@mereb/shared-packages'
import type {
  MessageNotificationEvent,
  NotificationSettingsRecord,
  NotifyRepositoryPort,
  PushDeviceRegistrationRecord,
  PushSenderPort,
  UpsertPushDeviceInput
} from './ports.js'

const logger = createLogger('svc-notify-application')

export class AuthenticationRequiredError extends Error {
  constructor(message = 'Authentication required') {
    super(message)
    this.name = 'AuthenticationRequiredError'
  }
}

function requireAuth(ctx: GraphQLContext): string {
  const userId = ctx.userId?.trim()
  if (!userId) {
    throw new AuthenticationRequiredError()
  }
  return userId
}

export class GetMeNotificationSettingsQuery {
  constructor(private readonly repository: NotifyRepositoryPort) {}

  async execute(ctx: GraphQLContext): Promise<NotificationSettingsRecord> {
    const userId = requireAuth(ctx)
    const settings = await this.repository.getNotificationSettings(userId)
    logger.info(
      { userId, directMessagesEnabled: settings.directMessagesEnabled },
      'Loaded notification settings'
    )
    return settings
  }
}

export class UpdateNotificationSettingsUseCase {
  constructor(private readonly repository: NotifyRepositoryPort) {}

  execute(
    input: { directMessagesEnabled: boolean },
    ctx: GraphQLContext
  ): Promise<NotificationSettingsRecord> {
    const userId = requireAuth(ctx)
    return this.repository.updateNotificationSettings(userId, input).then((settings) => {
      logger.info(
        { userId, directMessagesEnabled: settings.directMessagesEnabled },
        'Updated notification settings'
      )
      return settings
    })
  }
}

export class UpsertPushDeviceUseCase {
  constructor(private readonly repository: NotifyRepositoryPort) {}

  execute(
    input: UpsertPushDeviceInput,
    ctx: GraphQLContext
  ): Promise<PushDeviceRegistrationRecord> {
    const userId = requireAuth(ctx)
    return this.repository.upsertPushDevice(userId, input).then((device) => {
      logger.info(
        {
          userId,
          installationId: device.installationId,
          platform: device.platform,
          permissionStatus: device.permissionStatus,
          appVersion: device.appVersion
        },
        'Upserted push device'
      )
      return device
    })
  }
}

export class RemovePushDeviceUseCase {
  constructor(private readonly repository: NotifyRepositoryPort) {}

  execute(
    input: { installationId: string },
    ctx: GraphQLContext
  ): Promise<boolean> {
    const userId = requireAuth(ctx)
    return this.repository.disablePushDevice(userId, input.installationId).then((removed) => {
      logger.info(
        { userId, installationId: input.installationId, removed },
        'Disabled push device'
      )
      return removed
    })
  }
}

export class HandleMessageSentEventUseCase {
  constructor(
    private readonly repository: NotifyRepositoryPort,
    private readonly pushSender: PushSenderPort
  ) {}

  async execute(event: MessageNotificationEvent): Promise<void> {
    const recipients = event.recipientIds.filter(
      (recipientId) => recipientId && recipientId !== event.senderId
    )

    logger.info(
      {
        eventId: event.eventId,
        messageId: event.messageId,
        conversationId: event.conversationId,
        senderId: event.senderId,
        recipientCount: recipients.length
      },
      'Handling messaging.message.sent notification event'
    )

    for (const userId of recipients) {
      const settings = await this.repository.getNotificationSettings(userId)
      if (!settings.directMessagesEnabled) {
        logger.info(
          { eventId: event.eventId, userId },
          'Skipping notification delivery because direct-message alerts are disabled'
        )
        continue
      }

      const devices = await this.repository.listActivePushDevices(userId)
      if (devices.length === 0) {
        logger.info(
          { eventId: event.eventId, userId },
          'Skipping notification delivery because no active devices are registered'
        )
        continue
      }

      const claimedDevices: PushDeviceRegistrationRecord[] = []

      for (const device of devices) {
        const claimed = await this.repository.claimMessageDelivery({
          eventId: event.eventId,
          userId,
          installationId: device.installationId,
          messageId: event.messageId,
          conversationId: event.conversationId,
          expoPushToken: device.expoPushToken
        })

        if (claimed) {
          claimedDevices.push(device)
        }
      }

      if (claimedDevices.length === 0) {
        logger.info(
          { eventId: event.eventId, userId, deviceCount: devices.length },
          'Skipping notification delivery because all candidate devices were already claimed'
        )
        continue
      }

      try {
        const receipts = await this.pushSender.sendMany(
          claimedDevices.map((device) => ({
            to: device.expoPushToken,
            title: 'New message',
            body: 'Open Mereb Social to read it.',
            channelId: device.platform === 'android' ? 'messages' : undefined,
            data: {
              type: 'message',
              conversationId: event.conversationId
            }
          }))
        )

        logger.info(
          {
            eventId: event.eventId,
            userId,
            claimedDeviceCount: claimedDevices.length,
            okCount: receipts.filter((receipt) => receipt.status === 'ok').length,
            errorCount: receipts.filter((receipt) => receipt.status === 'error').length
          },
          'Sent Expo push batch'
        )

        await Promise.all(
          receipts.map(async (receipt, index) => {
            const device = claimedDevices[index]
            if (!device) {
              return
            }

            if (receipt.status === 'ok') {
              await this.repository.markMessageDeliverySent({
                eventId: event.eventId,
                installationId: device.installationId,
                expoTicketId: receipt.id
              })
              return
            }

            await this.repository.markMessageDeliveryFailed({
              eventId: event.eventId,
              installationId: device.installationId,
              error: receipt.message ?? 'Expo push send failed'
            })
          })
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Expo push send failed'
        logger.error(
          {
            err: error,
            eventId: event.eventId,
            userId,
            claimedDeviceCount: claimedDevices.length
          },
          'Expo push send failed'
        )
        await Promise.all(
          claimedDevices.map((device) =>
            this.repository.markMessageDeliveryFailed({
              eventId: event.eventId,
              installationId: device.installationId,
              error: message
            })
          )
        )
      }
    }
  }
}

export interface NotifyApplicationModule {
  queries: {
    meNotificationSettings: GetMeNotificationSettingsQuery
  }
  commands: {
    updateNotificationSettings: UpdateNotificationSettingsUseCase
    upsertPushDevice: UpsertPushDeviceUseCase
    removePushDevice: RemovePushDeviceUseCase
  }
  workers: {
    handleMessageSent: HandleMessageSentEventUseCase
  }
}

export function createNotifyApplicationModule(deps: {
  repository: NotifyRepositoryPort
  pushSender: PushSenderPort
}): NotifyApplicationModule {
  return {
    queries: {
      meNotificationSettings: new GetMeNotificationSettingsQuery(deps.repository)
    },
    commands: {
      updateNotificationSettings: new UpdateNotificationSettingsUseCase(deps.repository),
      upsertPushDevice: new UpsertPushDeviceUseCase(deps.repository),
      removePushDevice: new RemovePushDeviceUseCase(deps.repository)
    },
    workers: {
      handleMessageSent: new HandleMessageSentEventUseCase(
        deps.repository,
        deps.pushSender
      )
    }
  }
}
