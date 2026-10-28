/**
 * Start the TSight server from environment variables. Used by Docker and
 * `npm start`; the tsight command line calls createServer directly.
 *
 *   PORT                    default 3001
 *   HOST                    default 127.0.0.1
 *   TSIGHT_WORKSPACE_ROOT   only folders inside it can be analyzed
 *   TSIGHT_ALLOWED_HOSTS    extra host names, comma separated
 *   TSIGHT_CORS_ORIGIN      allowed origins, comma separated
 *   TSIGHT_WEB_DIR          folder with the built web UI
 */
import 'dotenv/config';
import { pathToFileURL } from 'url';
import { createServer } from './server.js';

export { createServer, type ServerOptions } from './server.js';

const list = (v: string | undefined) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain || process.env.TSIGHT_START === '1') {
  const server = createServer({
    port: Number(process.env.PORT) || 3001,
    host: process.env.HOST || '127.0.0.1',
    workspaceRoot: process.env.TSIGHT_WORKSPACE_ROOT || null,
    allowedHosts: list(process.env.TSIGHT_ALLOWED_HOSTS),
    allowedOrigins: list(process.env.TSIGHT_CORS_ORIGIN),
    webDir: process.env.TSIGHT_WEB_DIR || undefined,
  });
  server.start().then(({ url }) => {
    console.log(`TSight running at ${url}`);
    if (process.env.TSIGHT_WORKSPACE_ROOT) console.log(`Only folders inside ${process.env.TSIGHT_WORKSPACE_ROOT} can be analyzed`);
  });
}
