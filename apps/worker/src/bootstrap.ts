import { ShutdownSignal, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadWorkerConfig, type WorkerConfig } from '@vinops/config';
import { VinopsDatabase } from '@vinops/database';
import { ClamAvScanner, S3ObjectStorage } from '@vinops/file';
import { createLogger } from '@vinops/observability';
import { NestStructuredLogger } from './nest-logger.js';
import { createOutboxPoller, type OutboxPoller } from './outbox-poller.js';
import { createFileProcessingPoller, type FileProcessingPoller } from './file-processing-poller.js';
import { FileProcessingWorker } from './file-processing-worker.js';
import { createDocumentEventHandlers } from './document-event-handler.js';
import { createBimEventHandlers } from './bim/bim-event-handler.js';
import { DeterministicInProcessPublisher } from './outbox-publisher.js';
import { OutboxWorker } from './outbox-worker.js';
import { PostgreSqlOutboxStore } from './postgres-outbox-store.js';
import { WorkerLifecycle } from './worker-lifecycle.js';
import { WorkerModule } from './worker.module.js';
import { SlaMonitorWorker, PostgresSlaMonitorStore } from './sla/sla-monitor.js';
import { EscalationNotifier, LoggingEscalationSink } from './sla/escalation-notifier.js';
import { createSlaPoller, type SlaPoller } from './sla/sla-poller.js';
import {
  WeatherIngestionWorker,
  createWeatherPoller,
  type WeatherPoller,
} from './weather-ingestion-worker.js';
import { AsBuiltDossierBundler } from './as-built-dossier-bundler.js';

export type WorkerApplication = {
  app: INestApplicationContext;
  config: WorkerConfig;
  lifecycle: WorkerLifecycle;
  outboxEnabled: boolean;
  fileProcessingEnabled: boolean;
  shutdown: () => Promise<void>;
};

export function enableWorkerGracefulShutdown(
  application: Pick<INestApplicationContext, 'enableShutdownHooks'>,
): void {
  application.enableShutdownHooks([ShutdownSignal.SIGINT, ShutdownSignal.SIGTERM]);
}

function createOptionalWorkerRuntime(
  config: WorkerConfig,
  logger: ReturnType<typeof createLogger>,
):
  | {
      database: VinopsDatabase;
      appDatabase: VinopsDatabase;
      outboxPoller: OutboxPoller;
      slaPoller: SlaPoller;
      weatherPoller: WeatherPoller;
      weatherWorker: WeatherIngestionWorker;
      dossierBundler: AsBuiltDossierBundler;
      filePoller?: FileProcessingPoller;
    }
  | undefined {
  const connectionString = config.VINOPS_DATABASE_URL;
  if (connectionString === undefined) {
    return undefined;
  }

  const database = new VinopsDatabase({
    connectionString,
    applicationName: `vinops-worker:${config.VINOPS_WORKER_NAME}`,
    runtimeRole: 'vinops_worker',
  });
  const appDatabase = new VinopsDatabase({
    connectionString,
    applicationName: `vinops-worker-app:${config.VINOPS_WORKER_NAME}`,
    runtimeRole: 'vinops_app',
  });
  const documentHandlers = createDocumentEventHandlers(logger);
  const bimHandlers = createBimEventHandlers(database, undefined, logger);
  const worker = new OutboxWorker(
    new PostgreSqlOutboxStore(database),
    new DeterministicInProcessPublisher([documentHandlers.handler, bimHandlers.handler]),
    logger,
    { workerName: config.VINOPS_WORKER_NAME },
  );
  const hasFileRuntime =
    config.VINOPS_S3_ENDPOINT !== undefined &&
    config.VINOPS_S3_BUCKET !== undefined &&
    config.VINOPS_S3_ACCESS_KEY_ID !== undefined &&
    config.VINOPS_S3_SECRET_ACCESS_KEY !== undefined &&
    config.VINOPS_CLAMAV_HOST !== undefined;
  const filePoller = hasFileRuntime
    ? createFileProcessingPoller(
        new FileProcessingWorker(
          database,
          new S3ObjectStorage({
            endpoint: config.VINOPS_S3_ENDPOINT!,
            region: config.VINOPS_S3_REGION,
            bucket: config.VINOPS_S3_BUCKET!,
            accessKeyId: config.VINOPS_S3_ACCESS_KEY_ID!,
            secretAccessKey: config.VINOPS_S3_SECRET_ACCESS_KEY!,
          }),
          new ClamAvScanner({ host: config.VINOPS_CLAMAV_HOST!, port: config.VINOPS_CLAMAV_PORT }),
          logger,
          config.VINOPS_WORKER_NAME,
        ),
        logger,
        config.VINOPS_FILE_JOB_POLL_INTERVAL_MS,
      )
    : undefined;
  const slaPoller = createSlaPoller(
    new SlaMonitorWorker(
      new PostgresSlaMonitorStore(appDatabase),
      new EscalationNotifier(new LoggingEscalationSink(logger)),
      logger,
    ),
    logger,
    60_000,
  );

  const weatherWorker = new WeatherIngestionWorker(appDatabase, logger);
  const weatherPoller = createWeatherPoller(weatherWorker, logger, 300_000);
  const dossierBundler = new AsBuiltDossierBundler(appDatabase, logger);

  return {
    database,
    appDatabase,
    outboxPoller: createOutboxPoller(worker, logger, config.VINOPS_OUTBOX_POLL_INTERVAL_MS),
    slaPoller,
    weatherPoller,
    weatherWorker,
    dossierBundler,
    ...(filePoller === undefined ? {} : { filePoller }),
  };
}

export async function createWorkerApplication(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<WorkerApplication> {
  const config = loadWorkerConfig(environment);
  const logger = createLogger('vinops-worker', config.VINOPS_LOG_LEVEL);
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: false,
    logger: new NestStructuredLogger(logger),
  });
  enableWorkerGracefulShutdown(app);

  const lifecycle = app.get(WorkerLifecycle);
  const workerRuntime = createOptionalWorkerRuntime(config, logger);
  workerRuntime?.outboxPoller.start();
  workerRuntime?.filePoller?.start();
  workerRuntime?.slaPoller.start();
  workerRuntime?.weatherPoller.start();
  logger.info({ worker_name: config.VINOPS_WORKER_NAME }, 'worker application context started');
  if (workerRuntime === undefined) {
    logger.info(
      { worker_name: config.VINOPS_WORKER_NAME },
      'outbox runtime disabled because VINOPS_DATABASE_URL is not configured',
    );
  } else {
    logger.info(
      { worker_name: config.VINOPS_WORKER_NAME },
      'outbox runtime enabled using dedicated database worker role',
    );
  }

  return {
    app,
    config,
    lifecycle,
    outboxEnabled: workerRuntime !== undefined,
    fileProcessingEnabled: workerRuntime?.filePoller !== undefined,
    shutdown: async () => {
      logger.info(
        { worker_name: config.VINOPS_WORKER_NAME },
        'worker application context stopping',
      );
      await workerRuntime?.weatherPoller?.stop();
      await workerRuntime?.filePoller?.stop();
      await workerRuntime?.slaPoller?.stop();
      await workerRuntime?.outboxPoller.stop();
      await workerRuntime?.database.close();
      await workerRuntime?.appDatabase.close();
      await app.close();
    },
  };
}
