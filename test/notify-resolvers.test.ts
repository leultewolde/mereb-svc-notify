import assert from 'node:assert/strict'
import { test, vi } from 'vitest'
import type { GraphQLContext } from '../src/context.js'
import { createResolvers } from '../src/adapters/inbound/graphql/resolvers.js'
import {
  AuthenticationRequiredError,
  type NotifyApplicationModule
} from '../src/application/notify/use-cases.js'

function createNotifyModule() {
  const meNotificationSettings = vi.fn()
  const upsertPushDevice = vi.fn()
  const removePushDevice = vi.fn()
  const updateNotificationSettings = vi.fn()

  const notify: NotifyApplicationModule = {
    queries: {
      meNotificationSettings: { execute: meNotificationSettings }
    },
    commands: {
      upsertPushDevice: { execute: upsertPushDevice },
      removePushDevice: { execute: removePushDevice },
      updateNotificationSettings: { execute: updateNotificationSettings }
    },
    workers: {
      handleMessageSent: { execute: vi.fn() }
    }
  } as unknown as NotifyApplicationModule

  return {
    notify,
    calls: {
      meNotificationSettings,
      upsertPushDevice,
      removePushDevice,
      updateNotificationSettings
    }
  }
}

test('GraphQL resolvers delegate to the application module and map payloads correctly', async () => {
  const { notify, calls } = createNotifyModule()
  const resolvers = createResolvers(notify)
  const ctx: GraphQLContext = { userId: 'user-1' }
  const updatedAt = new Date('2026-04-11T00:00:00.000Z')
  const lastSeenAt = new Date('2026-04-11T01:00:00.000Z')

  calls.meNotificationSettings.mockResolvedValue({
    userId: 'user-1',
    directMessagesEnabled: true,
    updatedAt
  })
  calls.upsertPushDevice.mockResolvedValue({
    userId: 'user-1',
    installationId: 'install-1',
    platform: 'android',
    expoPushToken: 'ExponentPushToken[token]',
    permissionStatus: 'GRANTED',
    appVersion: '1.0.1',
    lastSeenAt,
    disabledAt: null
  })
  calls.removePushDevice.mockResolvedValue(true)
  calls.updateNotificationSettings.mockResolvedValue({
    userId: 'user-1',
    directMessagesEnabled: false,
    updatedAt
  })

  assert.deepEqual(await resolvers.Query?.meNotificationSettings?.({}, {}, ctx, {}), {
    userId: 'user-1',
    directMessagesEnabled: true,
    updatedAt
  })
  assert.deepEqual(await resolvers.Query?._service?.({}, {}, ctx, {}), { sdl: null })

  const upserted = await resolvers.Mutation?.upsertPushDevice?.(
    {},
    {
      input: {
        installationId: 'install-1',
        expoPushToken: 'ExponentPushToken[token]',
        platform: 'ANDROID',
        permissionStatus: 'GRANTED',
        appVersion: '1.0.1'
      }
    },
    ctx,
    {}
  )
  const removed = await resolvers.Mutation?.removePushDevice?.(
    {},
    { installationId: 'install-1' },
    ctx,
    {}
  )
  const updated = await resolvers.Mutation?.updateNotificationSettings?.(
    {},
    { directMessagesEnabled: false },
    ctx,
    {}
  )

  assert.equal(upserted?.platform, 'android')
  assert.equal(removed, true)
  assert.equal(updated?.directMessagesEnabled, false)
  assert.deepEqual(calls.upsertPushDevice.mock.calls[0], [
    {
      installationId: 'install-1',
      expoPushToken: 'ExponentPushToken[token]',
      platform: 'android',
      permissionStatus: 'GRANTED',
      appVersion: '1.0.1'
    },
    ctx
  ])
  assert.deepEqual(calls.removePushDevice.mock.calls[0], [
    { installationId: 'install-1' },
    ctx
  ])
  assert.deepEqual(calls.updateNotificationSettings.mock.calls[0], [
    { directMessagesEnabled: false },
    ctx
  ])

  assert.equal(
    resolvers.NotificationSettings?.updatedAt?.({ updatedAt }, {}, ctx, {}),
    '2026-04-11T00:00:00.000Z'
  )
  assert.equal(
    resolvers.PushDeviceRegistration?.platform?.({ platform: 'android' }, {}, ctx, {}),
    'ANDROID'
  )
  assert.equal(
    resolvers.PushDeviceRegistration?.lastSeenAt?.({ lastSeenAt }, {}, ctx, {}),
    '2026-04-11T01:00:00.000Z'
  )
})

test('GraphQL resolvers convert authentication errors into plain GraphQL errors', async () => {
  const { notify, calls } = createNotifyModule()
  const resolvers = createResolvers(notify)

  calls.meNotificationSettings.mockRejectedValue(
    new AuthenticationRequiredError('Authentication required')
  )
  calls.updateNotificationSettings.mockRejectedValue(
    new AuthenticationRequiredError('Authentication required')
  )

  await assert.rejects(
    () => resolvers.Query?.meNotificationSettings?.({}, {}, {}, {}),
    (error) =>
      error instanceof Error &&
      error.message === 'Authentication required' &&
      !(error instanceof AuthenticationRequiredError)
  )
  await assert.rejects(
    () =>
      resolvers.Mutation?.updateNotificationSettings?.(
        {},
        { directMessagesEnabled: true },
        {},
        {}
      ),
    (error) =>
      error instanceof Error &&
      error.message === 'Authentication required' &&
      !(error instanceof AuthenticationRequiredError)
  )
})
