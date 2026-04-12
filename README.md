# svc-notify

`svc-notify` is the notification delivery service for Mereb mobile. It exposes a federated GraphQL API for push-device registration and notification preferences, and it consumes messaging events to deliver direct-message pushes through Expo Push.

## API surface

- GraphQL endpoint: `POST /graphql`
- Health checks:
  - `GET /healthz`
  - `GET /readyz`

Core GraphQL operations:

- query: `meNotificationSettings`
- mutations:
  - `upsertPushDevice(input)`
  - `removePushDevice(installationId)`
  - `updateNotificationSettings(directMessagesEnabled)`

Current notification scope:

- direct-message pushes only
- title: `New message`
- body: `Open Mereb Social to read it.`
- tap payload: `type=message`, `conversationId=<id>`

## Eventing and delivery

`svc-notify` subscribes to `messaging.message.sent.v1`. For each recipient, it:

1. skips the sender
2. checks `NotificationPreference.directMessagesEnabled`
3. loads active push-device registrations
4. claims per-device delivery idempotently
5. sends Expo Push notifications
6. records delivery status and Expo ticket IDs

The worker runs inside the main service process. When Kafka is not configured, the HTTP API still starts and the worker stays disabled.

## Environment

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | - | Postgres connection string for the `svc_notify` schema. |
| `OIDC_ISSUER` | yes | - | JWT issuer for GraphQL auth context. Supports a comma-separated fallback list. |
| `OIDC_AUDIENCE` | yes | - | JWT audience/client ID. |
| `PORT` | no | `4005` | HTTP listen port. |
| `HOST` | no | `0.0.0.0` | HTTP listen host. |
| `KAFKA_BROKERS` | no | - | Enables the notification worker when set. |
| `KAFKA_SSL` | no | - | Passed through to shared Kafka config. |
| `KAFKA_SSL_INSECURE` | no | - | Passed through to shared Kafka config. |
| `KAFKA_NOTIFY_MESSAGE_SENT_GROUP_ID` | no | `svc-notify-message-sent` | Consumer group ID override for the message-sent worker. |
| `KAFKA_TOPIC_MESSAGING_MESSAGE_SENT` | no | `messaging.message.sent.v1` | Topic override for message delivery events. |

## Local development

```bash
pnpm --filter @services/svc-notify prisma:migrate
pnpm --filter @services/svc-notify dev
pnpm --filter @services/svc-notify build
pnpm --filter @services/svc-notify start
```

## Tests

```bash
pnpm --filter @services/svc-notify lint
pnpm --filter @services/svc-notify typecheck
pnpm --filter @services/svc-notify test
pnpm --filter @services/svc-notify build
```
