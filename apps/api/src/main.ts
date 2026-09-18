import './config/load-env.js';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';
import { AppConfig } from './config/app-config.js';

const app = await NestFactory.create(AppModule);
configureApp(app);
await app.listen(app.get(AppConfig).env.API_PORT, '0.0.0.0');
