import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'

const sharedPackagesMocks = vi.hoisted(() => ({
  startConsumer: vi.fn(),
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
}))

vi.mock('@mereb/shared-packages', () => ({
  buildKafkaConfigFromEnv: vi.fn(),
  startConsumer: sharedPackagesMocks.startConsumer,
  createLogger: vi.fn(() => sharedPackagesMocks.logger)
}))

import { startMessageSentConsumer } from '../src/adapters/inbound/workers/message-sent-consumer.js'

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.KAFKA_NOTIFY_MESSAGE_SENT_GROUP_ID
  delete process.env.KAFKA_TOPIC_MESSAGING_MESSAGE_SENT
})

test('passes null kafkaConfig through to startConsumer', async () => {
  sharedPackagesMocks.startConsumer.mockResolvedValue(null)
  const handler = { execute: vi.fn() }

  const consumer = await startMessageSentConsumer(null, handler as never)

  assert.equal(consumer, null)
  assert.equal(sharedPackagesMocks.startConsumer.mock.calls.length, 1)
  const call = sharedPackagesMocks.startConsumer.mock.calls[0][0]
  assert.equal(call.kafkaConfig, null)
})

test('starts consumer with correct topic, group, and parser, and dispatches handler', async () => {
  const fakeConsumer = { subscribe: vi.fn(), run: vi.fn() }
  sharedPackagesMocks.startConsumer.mockResolvedValue(fakeConsumer)
  const handler = { execute: vi.fn().mockResolvedValue(undefined) }
  const kafkaConfig = { brokers: ['localhost:9092'] }

  const consumer = await startMessageSentConsumer(kafkaConfig as never, handler as never)

  assert.deepEqual(consumer, fakeConsumer)
  const call = sharedPackagesMocks.startConsumer.mock.calls[0][0]
  assert.equal(call.kafkaConfig, kafkaConfig)
  assert.equal(call.topic, 'messaging.message.sent.v1')
  assert.equal(call.consumerGroup, 'svc-notify-message-sent')

  const parsed = call.parse(
    JSON.stringify({
      event_id: 'evt-1',
      data: {
        message_id: 'msg-1',
        conversation_id: 'conv-1',
        sender_id: 'sender-1',
        recipient_ids: ['recipient-1', 'recipient-2']
      }
    })
  )

  await call.handle({
    topic: 'messaging.message.sent.v1',
    partition: 0,
    offset: '1',
    value: '',
    parsed,
    consumerGroup: 'svc-notify-message-sent'
  })

  assert.deepEqual(handler.execute.mock.calls[0][0], {
    eventId: 'evt-1',
    messageId: 'msg-1',
    conversationId: 'conv-1',
    senderId: 'sender-1',
    recipientIds: ['recipient-1', 'recipient-2']
  })
})

test('parser throws on malformed JSON (shared runner handles error logging)', async () => {
  sharedPackagesMocks.startConsumer.mockResolvedValue({})
  await startMessageSentConsumer({ brokers: ['localhost:9092'] } as never, { execute: vi.fn() } as never)
  const call = sharedPackagesMocks.startConsumer.mock.calls[0][0]
  assert.throws(() => call.parse('not-json'))
})
