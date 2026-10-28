# @tsight/api

The server behind [TSight](https://github.com/challaravinath/TSight). It runs the analysis from `@tsight/core` in a worker thread, so the page stays responsive on large projects, and serves a built web UI from `webDir` when you give it one. The `tsight` command ships the UI and does this for you.

Most people want the `tsight` command instead. Use this package to embed the server in your own tooling.

```ts
import { createServer } from '@tsight/api';

const server = createServer({ port: 4300, initialPath: '/path/to/project', webDir: '/path/to/built/ui' });
const { url } = await server.start();
console.log(`TSight is running at ${url}`);
```

It listens on 127.0.0.1 by default and checks the Host header, so other machines and web pages can't reach it. Set `workspaceRoot` to limit which folders can be analyzed.

Documentation: [github.com/challaravinath/TSight](https://github.com/challaravinath/TSight/tree/main/docs). MIT licensed.
