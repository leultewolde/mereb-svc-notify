import assert from 'node:assert/strict'
import { afterEach, test, vi } from 'vitest'
import { ExpoPushSender } from '../src/adapters/outbound/expo/expo-push-client.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

test('sendMany returns early for empty message lists', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)

  const sender = new ExpoPushSender()
  const receipts = await sender.sendMany([])

  assert.deepEqual(receipts, [])
  assert.equal(fetchMock.mock.calls.length, 0)
})

test('sendMany batches messages and maps Expo tickets into receipts', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)

  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: Array.from({ length: 100 }, (_, index) => ({
          status: 'ok',
          id: `ticket-${index + 1}`
        }))
      })
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            status: 'error',
            message: 'DeviceNotRegistered',
            details: { error: 'DeviceNotRegistered' }
          }
        ]
      })
    })

  const sender = new ExpoPushSender()
  const messages = Array.from({ length: 101 }, (_, index) => ({
    to: `ExponentPushToken[${index}]`,
    title: 'New message',
    body: 'Open Mereb Social to read it.',
    data: {
      type: 'message',
      conversationId: `conv-${index}`
    }
  }))

  const receipts = await sender.sendMany(messages)

  assert.equal(fetchMock.mock.calls.length, 2)
  assert.equal(
    JSON.parse(fetchMock.mock.calls[0][1].body as string).length,
    100
  )
  assert.equal(JSON.parse(fetchMock.mock.calls[1][1].body as string).length, 1)
  assert.equal(receipts.length, 101)
  assert.deepEqual(receipts[0], { status: 'ok', id: 'ticket-1' })
  assert.deepEqual(receipts[100], {
    status: 'error',
    id: undefined,
    message: 'DeviceNotRegistered'
  })
})

test('sendMany throws when Expo returns a non-success response', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false,
    status: 503,
    json: async () => ({})
  })
  vi.stubGlobal('fetch', fetchMock)

  const sender = new ExpoPushSender()

  await assert.rejects(
    () =>
      sender.sendMany([
        {
          to: 'ExponentPushToken[token]',
          title: 'New message',
          body: 'Open Mereb Social to read it.',
          data: {
            type: 'message',
            conversationId: 'conv-1'
          }
        }
      ]),
    (error) =>
      error instanceof Error &&
      error.message === 'Expo push send failed with status 503'
  )
})
