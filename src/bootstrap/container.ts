import {
  createNotifyApplicationModule,
  type NotifyApplicationModule
} from '../application/notify/use-cases.js'
import { ExpoPushSender } from '../adapters/outbound/expo/expo-push-client.js'
import { PrismaNotifyRepository } from '../adapters/outbound/prisma/notify-prisma-repositories.js'

export interface NotifyContainer {
  notify: NotifyApplicationModule
}

export function createContainer(): NotifyContainer {
  const repository = new PrismaNotifyRepository()
  const pushSender = new ExpoPushSender()

  return {
    notify: createNotifyApplicationModule({
      repository,
      pushSender
    })
  }
}
