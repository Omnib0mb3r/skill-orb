import Fastify from 'fastify';
import { loadConfig } from './config.js';

const config = loadConfig();

const app = Fastify({ logger: true });

app.get('/health', async () => {
  return { status: 'ok' };
});

app.listen({ host: '127.0.0.1', port: config.port }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`Server listening at ${address}`);
});
