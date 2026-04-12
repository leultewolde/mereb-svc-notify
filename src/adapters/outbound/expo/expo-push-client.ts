import type { PushMessageInput, PushSendReceipt, PushSenderPort } from '../../../application/notify/ports.js'

type ExpoPushTicket = {
  status?: 'ok' | 'error'
  id?: string
  message?: string
  details?: {
    error?: string
  }
}

type ExpoPushResponse = {
  data?: ExpoPushTicket[]
}

const EXPO_PUSH_SEND_URL = 'https://exp.host/--/api/v2/push/send'
const EXPO_MAX_BATCH_SIZE = 100

function chunkMessages(messages: PushMessageInput[]): PushMessageInput[][] {
  const chunks: PushMessageInput[][] = []

  for (let index = 0; index < messages.length; index += EXPO_MAX_BATCH_SIZE) {
    chunks.push(messages.slice(index, index + EXPO_MAX_BATCH_SIZE))
  }

  return chunks
}

function toReceipt(ticket?: ExpoPushTicket): PushSendReceipt {
  if (ticket?.status === 'ok') {
    return {
      status: 'ok',
      id: ticket.id
    }
  }

  return {
    status: 'error',
    id: ticket?.id,
    message: ticket?.details?.error ?? ticket?.message ?? 'Expo push send failed'
  }
}

export class ExpoPushSender implements PushSenderPort {
  async sendMany(messages: PushMessageInput[]): Promise<PushSendReceipt[]> {
    if (messages.length === 0) {
      return []
    }

    const receipts: PushSendReceipt[] = []

    for (const batch of chunkMessages(messages)) {
      const response = await fetch(EXPO_PUSH_SEND_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(batch)
      })

      const payload = (await response.json().catch(() => ({}))) as ExpoPushResponse

      if (!response.ok) {
        throw new Error(`Expo push send failed with status ${response.status}`)
      }

      const tickets = Array.isArray(payload.data) ? payload.data : []
      for (let index = 0; index < batch.length; index += 1) {
        receipts.push(toReceipt(tickets[index]))
      }
    }

    return receipts
  }
}
