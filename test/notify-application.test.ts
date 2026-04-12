import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  AuthenticationRequiredError,
  createNotifyApplicationModule
} from '../src/application/notify/use-cases.js'
import type {
  NotificationSettingsRecord,
  NotifyRepositoryPort,
  PushDeviceRegistrationRecord,
  PushSenderPort,
  PushSendReceipt,
  UpsertPushDeviceInput
} from '../src/application/notify/ports.js'
import type { GraphQLContext } from '../src/context.js'

function notificationSettings(
  partial: Partial<NotificationSettingsRecord> & Pick<NotificationSettingsRecord, 'userId'>
): NotificationSettingsRecord {
  return {
    userId: partial.userId,
    directMessagesEnabled: partial.directMessagesEnabled ?? false,
    updatedAt: partial.updatedAt ?? new Date('2026-04-11T00:00:00.000Z')
  }
}

function pushDevice(
  partial: Partial<PushDeviceRegistrationRecord> &
    Pick<
      PushDeviceRegistrationRecord,
      'userId' | 'installationId' | 'platform' | 'expoPushToken'
    >
): PushDeviceRegistrationRecord {
  return {
    userId: partial.userId,
    installationId: partial.installationId,
    platform: partial.platform,
    expoPushToken: partial.expoPushToken,
    permissionStatus: partial.permissionStatus ?? 'GRANTED',
    appVersion: partial.appVersion ?? '1.0.0',
    lastSeenAt: partial.lastSeenAt ?? new Date('2026-04-11T00:00:00.000Z'),
    disabledAt: partial.disabledAt ?? null
  }
}

class FakeNotifyRepository implements NotifyRepositoryPort {
  settings = new Map<string, NotificationSettingsRecord>()
  devices = new Map<string, PushDeviceRegistrationRecord[]>()
  upsertCalls: Array<{ userId: string; input: UpsertPushDeviceInput }> = []
  disableCalls: Array<{ userId: string; installationId: string }> = []
  claims: Array<{
    eventId: string
    userId: string
    installationId: string
    messageId: string
    conversationId: string
    expoPushToken: string
  }> = []
  sent: Array<{ eventId: string; installationId: string; expoTicketId?: string }> = []
  failed: Array<{ eventId: string; installationId: string; error: string }> = []
  claimableInstallations = new Set<string>()

  async getNotificationSettings(userId: string): Promise<NotificationSettingsRecord> {
    return (
      this.settings.get(userId) ??
      notificationSettings({
        userId,
        directMessagesEnabled: false,
        updatedAt: new Date(0)
      })
    )
  }

  async updateNotificationSettings(
    userId: string,
    input: { directMessagesEnabled: boolean }
  ): Promise<NotificationSettingsRecord> {
    const record = notificationSettings({
      userId,
      directMessagesEnabled: input.directMessagesEnabled
    })
    this.settings.set(userId, record)
    return record
  }

  async upsertPushDevice(
    userId: string,
    input: UpsertPushDeviceInput
  ): Promise<PushDeviceRegistrationRecord> {
    this.upsertCalls.push({ userId, input })
    const record = pushDevice({
      userId,
      installationId: input.installationId,
      platform: input.platform,
      expoPushToken: input.expoPushToken,
      permissionStatus: input.permissionStatus,
      appVersion: input.appVersion ?? null
    })
    this.devices.set(userId, [record])
    return record
  }

  async disablePushDevice(userId: string, installationId: string): Promise<boolean> {
    this.disableCalls.push({ userId, installationId })
    return true
  }

  async listActivePushDevices(userId: string): Promise<PushDeviceRegistrationRecord[]> {
    return this.devices.get(userId) ?? []
  }

  async claimMessageDelivery(input: {
    eventId: string
    userId: string
    installationId: string
    messageId: string
    conversationId: string
    expoPushToken: string
  }): Promise<boolean> {
    this.claims.push(input)
    return this.claimableInstallations.has(input.installationId)
  }

  async markMessageDeliverySent(input: {
    eventId: string
    installationId: string
    expoTicketId?: string
  }): Promise<void> {
    this.sent.push(input)
  }

  async markMessageDeliveryFailed(input: {
    eventId: string
    installationId: string
    error: string
  }): Promise<void> {
    this.failed.push(input)
  }
}

class FakePushSender implements PushSenderPort {
  calls: Array<
    Array<{
      to: string
      title: string
      body: string
      channelId?: string
      data: Record<string, string>
    }>
  > = []
  nextReceipts: PushSendReceipt[] = []
  nextError: Error | null = null

  async sendMany(
    messages: Array<{
      to: string
      title: string
      body: string
      channelId?: string
      data: Record<string, string>
    }>
  ): Promise<PushSendReceipt[]> {
    this.calls.push(messages)
    if (this.nextError) {
      throw this.nextError
    }
    return this.nextReceipts
  }
}

function authenticatedContext(userId = 'user-1'): GraphQLContext {
  return { userId }
}

test('notification settings and device commands require auth and delegate through the repository', async () => {
  const repository = new FakeNotifyRepository()
  const pushSender = new FakePushSender()
  const notify = createNotifyApplicationModule({ repository, pushSender })

  const updatedSettings = await notify.commands.updateNotificationSettings.execute(
    { directMessagesEnabled: true },
    authenticatedContext('user-42')
  )
  const device = await notify.commands.upsertPushDevice.execute(
    {
      installationId: 'install-1',
      expoPushToken: 'ExponentPushToken[abc]',
      platform: 'ios',
      permissionStatus: 'GRANTED',
      appVersion: '1.0.0'
    },
    authenticatedContext('user-42')
  )
  const removed = await notify.commands.removePushDevice.execute(
    { installationId: 'install-1' },
    authenticatedContext('user-42')
  )

  assert.equal(updatedSettings.directMessagesEnabled, true)
  assert.equal(updatedSettings.userId, 'user-42')
  assert.equal(device.platform, 'ios')
  assert.equal(device.installationId, 'install-1')
  assert.equal(removed, true)
  assert.deepEqual(repository.upsertCalls[0], {
    userId: 'user-42',
    input: {
      installationId: 'install-1',
      expoPushToken: 'ExponentPushToken[abc]',
      platform: 'ios',
      permissionStatus: 'GRANTED',
      appVersion: '1.0.0'
    }
  })
  assert.deepEqual(repository.disableCalls, [
    { userId: 'user-42', installationId: 'install-1' }
  ])
  assert.equal(
    (await notify.queries.meNotificationSettings.execute(authenticatedContext('user-42')))
      .directMessagesEnabled,
    true
  )

  await assert.rejects(
    async () => notify.queries.meNotificationSettings.execute({}),
    (error) => error instanceof AuthenticationRequiredError
  )
  await assert.rejects(
    async () =>
      notify.commands.updateNotificationSettings.execute(
        { directMessagesEnabled: true },
        {}
      ),
    (error) => error instanceof AuthenticationRequiredError
  )
  await assert.rejects(
    async () =>
      notify.commands.upsertPushDevice.execute(
        {
          installationId: 'install-2',
          expoPushToken: 'ExponentPushToken[def]',
          platform: 'android',
          permissionStatus: 'GRANTED'
        },
        {}
      ),
    (error) => error instanceof AuthenticationRequiredError
  )
  await assert.rejects(
    async () =>
      notify.commands.removePushDevice.execute({ installationId: 'install-2' }, {}),
    (error) => error instanceof AuthenticationRequiredError
  )
})

test('message sent worker only notifies opted-in recipients and maps receipts back to devices', async () => {
  const repository = new FakeNotifyRepository()
  const pushSender = new FakePushSender()
  const notify = createNotifyApplicationModule({ repository, pushSender })

  repository.settings.set(
    'recipient-enabled',
    notificationSettings({ userId: 'recipient-enabled', directMessagesEnabled: true })
  )
  repository.settings.set(
    'recipient-disabled',
    notificationSettings({ userId: 'recipient-disabled', directMessagesEnabled: false })
  )
  repository.settings.set(
    'recipient-no-devices',
    notificationSettings({ userId: 'recipient-no-devices', directMessagesEnabled: true })
  )
  repository.settings.set(
    'recipient-unclaimed',
    notificationSettings({ userId: 'recipient-unclaimed', directMessagesEnabled: true })
  )

  repository.devices.set('recipient-enabled', [
    pushDevice({
      userId: 'recipient-enabled',
      installationId: 'ios-install',
      platform: 'ios',
      expoPushToken: 'ExponentPushToken[ios]'
    }),
    pushDevice({
      userId: 'recipient-enabled',
      installationId: 'android-install',
      platform: 'android',
      expoPushToken: 'ExponentPushToken[android]'
    })
  ])
  repository.devices.set('recipient-unclaimed', [
    pushDevice({
      userId: 'recipient-unclaimed',
      installationId: 'ignored-install',
      platform: 'android',
      expoPushToken: 'ExponentPushToken[ignored]'
    })
  ])
  repository.claimableInstallations = new Set(['ios-install', 'android-install'])
  pushSender.nextReceipts = [
    { status: 'ok', id: 'ticket-ios' },
    { status: 'error', message: 'InvalidCredentials' }
  ]

  await notify.workers.handleMessageSent.execute({
    eventId: 'evt-1',
    messageId: 'msg-1',
    conversationId: 'conv-1',
    senderId: 'sender-1',
    recipientIds: [
      'sender-1',
      'recipient-enabled',
      'recipient-disabled',
      'recipient-no-devices',
      'recipient-unclaimed',
      ''
    ]
  })

  assert.equal(pushSender.calls.length, 1)
  assert.deepEqual(pushSender.calls[0], [
    {
      to: 'ExponentPushToken[ios]',
      title: 'New message',
      body: 'Open Mereb Social to read it.',
      channelId: undefined,
      data: {
        type: 'message',
        conversationId: 'conv-1'
      }
    },
    {
      to: 'ExponentPushToken[android]',
      title: 'New message',
      body: 'Open Mereb Social to read it.',
      channelId: 'messages',
      data: {
        type: 'message',
        conversationId: 'conv-1'
      }
    }
  ])

  assert.deepEqual(
    repository.claims.map((claim) => claim.installationId),
    ['ios-install', 'android-install', 'ignored-install']
  )
  assert.deepEqual(repository.sent, [
    {
      eventId: 'evt-1',
      installationId: 'ios-install',
      expoTicketId: 'ticket-ios'
    }
  ])
  assert.deepEqual(repository.failed, [
    {
      eventId: 'evt-1',
      installationId: 'android-install',
      error: 'InvalidCredentials'
    }
  ])
})

test('message sent worker marks all claimed devices failed when Expo send throws', async () => {
  const repository = new FakeNotifyRepository()
  const pushSender = new FakePushSender()
  const notify = createNotifyApplicationModule({ repository, pushSender })

  repository.settings.set(
    'recipient-enabled',
    notificationSettings({ userId: 'recipient-enabled', directMessagesEnabled: true })
  )
  repository.devices.set('recipient-enabled', [
    pushDevice({
      userId: 'recipient-enabled',
      installationId: 'install-1',
      platform: 'android',
      expoPushToken: 'ExponentPushToken[android-1]'
    }),
    pushDevice({
      userId: 'recipient-enabled',
      installationId: 'install-2',
      platform: 'ios',
      expoPushToken: 'ExponentPushToken[ios-2]'
    })
  ])
  repository.claimableInstallations = new Set(['install-1', 'install-2'])
  pushSender.nextError = new Error('Expo temporarily unavailable')

  await notify.workers.handleMessageSent.execute({
    eventId: 'evt-2',
    messageId: 'msg-2',
    conversationId: 'conv-2',
    senderId: 'sender-2',
    recipientIds: ['recipient-enabled']
  })

  assert.deepEqual(repository.sent, [])
  assert.deepEqual(repository.failed, [
    {
      eventId: 'evt-2',
      installationId: 'install-1',
      error: 'Expo temporarily unavailable'
    },
    {
      eventId: 'evt-2',
      installationId: 'install-2',
      error: 'Expo temporarily unavailable'
    }
  ])
})
