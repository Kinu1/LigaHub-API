import { createHttpApplication } from './bootstrap.js';

const app = await createHttpApplication();
await app.listen(process.env.PORT ?? 3000);
