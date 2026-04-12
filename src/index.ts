import { buildKafkaConfigFromEnv, getNumberEnv, initDefaultTelemetry, loadEnv } from '@mereb/shared-packages'
import { buildServer } from './server.js'
import { runMigrations } from './migrate.js'
import { createContainer } from './bootstrap/container.js'
import { startMessageSentConsumer } from './adapters/inbound/workers/message-sent-consumer.js'

loadEnv()
initDefaultTelemetry('svc-notify')

const PORT = getNumberEnv('PORT', 4005)
const HOST = process.env.HOST ?? '0.0.0.0'

try {
  await runMigrations()

  const kafkaConfig = buildKafkaConfigFromEnv({
    clientId: 'svc-notify'
  })

  if (kafkaConfig) {
    const container = createContainer()
    try {
      await startMessageSentConsumer(kafkaConfig, container.notify.workers.handleMessageSent)
    } catch (error) {
      console.error('Failed to start notify workers', error)
    }
  } else {
    console.warn('KAFKA_BROKERS not set; notify worker disabled')
  }

  const app = await buildServer()
  await app.listen({ port: PORT, host: HOST })
  console.log(`Notify service listening on ${HOST}:${PORT}`)
} catch (err) {
  console.error('Failed to start notify service', err)
  process.exit(1)
}
