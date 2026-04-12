import type { GraphQLContext } from '../../context.js'
import type {
  MessageNotificationEvent,
  NotificationSettingsRecord,
  NotifyRepositoryPort,
  PushDeviceRegistrationRecord,
  PushSenderPort,
  UpsertPushDeviceInput
} from './ports.js'

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

  execute(ctx: GraphQLContext): Promise<NotificationSettingsRecord> {
    return this.repository.getNotificationSettings(requireAuth(ctx))
  }
}

export class UpdateNotificationSettingsUseCase {
  constructor(private readonly repository: NotifyRepositoryPort) {}

  execute(
    input: { directMessagesEnabled: boolean },
    ctx: GraphQLContext
  ): Promise<NotificationSettingsRecord> {
    return this.repository.updateNotificationSettings(requireAuth(ctx), input)
  }
}

export class UpsertPushDeviceUseCase {
  constructor(private readonly repository: NotifyRepositoryPort) {}

  execute(
    input: UpsertPushDeviceInput,
    ctx: GraphQLContext
  ): Promise<PushDeviceRegistrationRecord> {
    return this.repository.upsertPushDevice(requireAuth(ctx), input)
  }
}

export class RemovePushDeviceUseCase {
  constructor(private readonly repository: NotifyRepositoryPort) {}

  execute(
    input: { installationId: string },
    ctx: GraphQLContext
  ): Promise<boolean> {
    return this.repository.disablePushDevice(requireAuth(ctx), input.installationId)
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

    for (const userId of recipients) {
      const settings = await this.repository.getNotificationSettings(userId)
      if (!settings.directMessagesEnabled) {
        continue
      }

      const devices = await this.repository.listActivePushDevices(userId)
      if (devices.length === 0) {
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
