import { buildKafkaConfigFromEnv, createLogger, startConsumer } from '@mereb/shared-packages'
import type { Consumer } from 'kafkajs'
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
  return startConsumer<MessagingMessageSentIntegrationEvent>({
    kafkaConfig,
    topic: process.env.KAFKA_TOPIC_MESSAGING_MESSAGE_SENT ?? NOTIFY_MESSAGING_EVENT_TOPICS.messageSent,
    consumerGroup: getConsumerGroupId(),
    logger,
    parse: (raw) => JSON.parse(raw) as MessagingMessageSentIntegrationEvent,
    disabledMessage: 'Kafka config missing; notify worker disabled',
    handle: async ({ parsed }) => {
      await handler.execute({
        eventId: parsed.event_id,
        messageId: parsed.data.message_id,
        conversationId: parsed.data.conversation_id,
        senderId: parsed.data.sender_id,
        recipientIds: parsed.data.recipient_ids
      })
    }
  })
}
