import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await NestFactory.create(AppModule.with(config));
configureApp(app, config);
await app.listen(config.PORT);
console.log(`TeeMate API listening on :${config.PORT}`);
