import './config/load-env.js';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';

// Same codebase as the API, no HTTP server: image libraries are only ever loaded here.
const app = await NestFactory.createApplicationContext(WorkerModule);
app.enableShutdownHooks();
new Logger('Worker').log('Media worker ready');
