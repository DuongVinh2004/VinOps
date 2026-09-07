import 'reflect-metadata';
import { createApiApplication } from './bootstrap.js';

const { app, config } = await createApiApplication();
await app.listen(config.VINOPS_API_PORT, config.VINOPS_API_HOST);
