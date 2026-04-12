import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'

const sharedPackagesMocks = vi.hoisted(() => ({
  ensureTopicExists: vi.fn(),
  createConsumer: vi.fn(),
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
}))

vi.mock('@mereb/shared-packages', () => ({
  buildKafkaConfigFromEnv: vi.fn(),
  createConsumer: sharedPackagesMocks.createConsumer,
  ensureTopicExists: sharedPackagesMocks.ensureTopicExists,
  createLogger: vi.fn(() => sharedPackagesMocks.logger)
}))

import { startMessageSentConsumer } from '../src/adapters/inbound/workers/message-sent-consumer.js'

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.KAFKA_NOTIFY_MESSAGE_SENT_GROUP_ID
  delete process.env.KAFKA_TOPIC_MESSAGING_MESSAGE_SENT
})

test('returns null when Kafka is not configured', async () => {
  const handler = { execute: vi.fn() }

  const consumer = await startMessageSentConsumer(
    null,
    handler as never
  )

  assert.equal(consumer, null)
  assert.equal(sharedPackagesMocks.logger.warn.mock.calls.length, 1)
})

test('starts the consumer and processes valid message events', async () => {
  const subscribe = vi.fn().mockResolvedValue(undefined)
  const run = vi.fn().mockResolvedValue(undefined)
  sharedPackagesMocks.createConsumer.mockResolvedValue({ subscribe, run })

  const handler = { execute: vi.fn().mockResolvedValue(undefined) }
  const kafkaConfig = { brokers: ['localhost:9092'] }

  const consumer = await startMessageSentConsumer(
    kafkaConfig as never,
    handler as never
  )

  assert.deepEqual(consumer, { subscribe, run })
  assert.deepEqual(sharedPackagesMocks.ensureTopicExists.mock.calls[0], [
    kafkaConfig,
    'messaging.message.sent.v1',
    1,
    1
  ])
  assert.deepEqual(sharedPackagesMocks.createConsumer.mock.calls[0], [
    kafkaConfig,
    'svc-notify-message-sent'
  ])
  assert.deepEqual(subscribe.mock.calls[0], [
    { topic: 'messaging.message.sent.v1', fromBeginning: false }
  ])
  assert.equal(sharedPackagesMocks.logger.info.mock.calls.length, 1)

  const eachMessage = run.mock.calls[0][0].eachMessage as (input: {
    message: { value?: Buffer; offset: string }
    partition: number
    topic: string
  }) => Promise<void>

  await eachMessage({
    topic: 'messaging.message.sent.v1',
    partition: 0,
    message: {
      offset: '1',
      value: Buffer.from(
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
    }
  })

  assert.deepEqual(handler.execute.mock.calls[0][0], {
    eventId: 'evt-1',
    messageId: 'msg-1',
    conversationId: 'conv-1',
    senderId: 'sender-1',
    recipientIds: ['recipient-1', 'recipient-2']
  })
})

test('worker skips empty messages and logs malformed or failed events', async () => {
  const subscribe = vi.fn().mockResolvedValue(undefined)
  const run = vi.fn().mockResolvedValue(undefined)
  sharedPackagesMocks.createConsumer.mockResolvedValue({ subscribe, run })

  const handler = {
    execute: vi.fn().mockRejectedValue(new Error('handler failed'))
  }

  await startMessageSentConsumer({ brokers: ['localhost:9092'] } as never, handler as never)

  const eachMessage = run.mock.calls[0][0].eachMessage as (input: {
    message: { value?: Buffer; offset: string }
    partition: number
    topic: string
  }) => Promise<void>

  await eachMessage({
    topic: 'messaging.message.sent.v1',
    partition: 0,
    message: {
      offset: '2',
      value: undefined
    }
  })
  await eachMessage({
    topic: 'messaging.message.sent.v1',
    partition: 0,
    message: {
      offset: '3',
      value: Buffer.from('not-json')
    }
  })
  await eachMessage({
    topic: 'messaging.message.sent.v1',
    partition: 0,
    message: {
      offset: '4',
      value: Buffer.from(
        JSON.stringify({
          event_id: 'evt-2',
          data: {
            message_id: 'msg-2',
            conversation_id: 'conv-2',
            sender_id: 'sender-2',
            recipient_ids: ['recipient-3']
          }
        })
      )
    }
  })

  assert.equal(sharedPackagesMocks.logger.warn.mock.calls.length, 1)
  assert.equal(sharedPackagesMocks.logger.error.mock.calls.length, 2)
})
