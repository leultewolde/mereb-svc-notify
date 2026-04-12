import type { IntegrationEventEnvelope } from '@mereb/shared-packages'

export const NOTIFY_MESSAGING_EVENT_TOPICS = {
  messageSent: 'messaging.message.sent.v1'
} as const

export interface MessagingMessageSentEventData {
  message_id: string
  conversation_id: string
  sender_id: string
  recipient_ids: string[]
}

export type MessagingMessageSentIntegrationEvent =
  IntegrationEventEnvelope<MessagingMessageSentEventData>
