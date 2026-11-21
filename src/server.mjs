import { createServer } from 'node:http';
import { appFor } from './app.mjs';

const port = Number(process.env.PORT ?? 4721);
const info = { env: process.env.APP_ENV, sha: process.env.APP_SHA };
createServer(appFor(info)).listen(port, '127.0.0.1', () => console.log(`catalog-api on http://127.0.0.1:${port} (${info.env ?? 'dev'} ${info.sha?.slice(0, 7) ?? ''})`));
