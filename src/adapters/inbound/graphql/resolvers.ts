import type { IResolvers } from '@graphql-tools/utils'
import type { GraphQLContext } from '../../../context.js'
import { AuthenticationRequiredError, type NotifyApplicationModule } from '../../../application/notify/use-cases.js'

function toGraphQLError(error: unknown): never {
  if (error instanceof AuthenticationRequiredError) {
    throw new Error(error.message)
  }

  throw error
}

export function createResolvers(
  notify: NotifyApplicationModule
): IResolvers<unknown, GraphQLContext> {
  return {
    Query: {
      meNotificationSettings: async (_source, _args, ctx) => {
        try {
          return await notify.queries.meNotificationSettings.execute(ctx)
        } catch (error) {
          toGraphQLError(error)
        }
      },
      _service: () => ({ sdl: null })
    },
    Mutation: {
      upsertPushDevice: async (
        _source,
        args: {
          input: {
            installationId: string
            expoPushToken: string
            platform: 'IOS' | 'ANDROID'
            permissionStatus: 'UNKNOWN' | 'GRANTED' | 'DENIED' | 'BLOCKED'
            appVersion?: string | null
          }
        },
        ctx
      ) => {
        try {
          return await notify.commands.upsertPushDevice.execute(
            {
              installationId: args.input.installationId,
              expoPushToken: args.input.expoPushToken,
              platform: args.input.platform.toLowerCase() === 'ios' ? 'ios' : 'android',
              permissionStatus: args.input.permissionStatus,
              appVersion: args.input.appVersion
            },
            ctx
          )
        } catch (error) {
          toGraphQLError(error)
        }
      },
      removePushDevice: async (_source, args: { installationId: string }, ctx) => {
        try {
          return await notify.commands.removePushDevice.execute(
            { installationId: args.installationId },
            ctx
          )
        } catch (error) {
          toGraphQLError(error)
        }
      },
      updateNotificationSettings: async (
        _source,
        args: { directMessagesEnabled: boolean },
        ctx
      ) => {
        try {
          return await notify.commands.updateNotificationSettings.execute(
            { directMessagesEnabled: args.directMessagesEnabled },
            ctx
          )
        } catch (error) {
          toGraphQLError(error)
        }
      }
    },
    NotificationSettings: {
      updatedAt: (record: { updatedAt: Date }) => record.updatedAt.toISOString()
    },
    PushDeviceRegistration: {
      platform: (record: { platform: 'ios' | 'android' }) =>
        record.platform.toUpperCase(),
      lastSeenAt: (record: { lastSeenAt: Date }) => record.lastSeenAt.toISOString()
    }
  } as IResolvers<unknown, GraphQLContext>
}
