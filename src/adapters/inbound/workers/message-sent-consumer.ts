import { buildKafkaConfigFromEnv, createConsumer, ensureTopicExists } from '@mereb/shared-packages'
import type { Consumer } from 'kafkajs'
import { createLogger } from '@mereb/shared-packages'
import type { HandleMessageSentEventUseCase } from '../../../application/notify/use-cases.js'
import {
  NOTIFY_MESSAGING_EVENT_TOPICS,
  type MessagingMessageSentIntegrationEvent
} from '../../../contracts/messaging-events.js'

const logger = createLogger('svc-notify-message-sent-worker')
type KafkaConfig = NonNullable<ReturnType<typeof buildKafkaConfigFromEnv>>

function getConsumerGroupId() {
  return process.env.KAFKA_NOTIFY_MESSAGE_SENT_GROUP_ID ?? 'svc-notify-message-sent'
}

export async function startMessageSentConsumer(
  kafkaConfig: KafkaConfig | null,
  handler: HandleMessageSentEventUseCase
): Promise<Consumer | null> {
  if (!kafkaConfig) {
    logger.warn('Kafka config missing; notify worker disabled')
    return null
  }

  const topic = process.env.KAFKA_TOPIC_MESSAGING_MESSAGE_SENT ?? NOTIFY_MESSAGING_EVENT_TOPICS.messageSent
  await ensureTopicExists(kafkaConfig, topic, 1, 1)

  const consumer = await createConsumer(kafkaConfig, getConsumerGroupId())
  await consumer.subscribe({ topic, fromBeginning: false })

  consumer.run({
    eachMessage: async ({ message, partition, topic }) => {
      const value = message.value?.toString()
      if (!value) {
        logger.warn({ topic, partition, offset: message.offset }, 'Skipping message with no value')
        return
      }

      let parsed: MessagingMessageSentIntegrationEvent | null = null
      try {
        parsed = JSON.parse(value) as MessagingMessageSentIntegrationEvent
      } catch (error) {
        logger.error({ err: error, value }, 'Failed to parse messaging.message.sent event')
        return
      }

      try {
        await handler.execute({
          eventId: parsed.event_id,
          messageId: parsed.data.message_id,
          conversationId: parsed.data.conversation_id,
          senderId: parsed.data.sender_id,
          recipientIds: parsed.data.recipient_ids
        })
      } catch (error) {
        logger.error(
          { err: error, topic, partition, offset: message.offset, eventId: parsed.event_id },
          'Failed to process messaging.message.sent event'
        )
      }
    }
  }).catch((error) => {
    logger.error({ err: error }, 'Notify consumer crashed')
  })

  logger.info({ topic, groupId: getConsumerGroupId() }, 'Notify message consumer started')
  return consumer
}
