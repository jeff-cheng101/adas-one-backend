import express from 'express';

import { authenticator } from '../middleware/route_middleware_util';
import authRouter from './auth';
import cloudflareRouter from './cloudflare_setting';
import usersRouter from './users';
import contractsRouter from './contracts';
import systemSettingRouter from './system_setting';
import f5SettingRouter from './f5_setting';
import catoSettingRouter from './cato_setting';
import ticketRouter from './ticket';
import elasticsearchRouter from './elasticsearch';

export const internal = express();

internal.use(authenticator);
internal.use('/auth', authRouter);
internal.use('/cloudflare_setting', cloudflareRouter);
internal.use('/users', usersRouter);
internal.use('/contracts', contractsRouter);
internal.use('/system_setting', systemSettingRouter);
internal.use('/f5_setting', f5SettingRouter);
internal.use('/cato_setting', catoSettingRouter);
internal.use('/ticket', ticketRouter);
internal.use('/elasticsearch', elasticsearchRouter);