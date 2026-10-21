import express, { type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { connectDB } from './config/db.js';
import {
    env,
    isCloudinaryConfigured,
    isGeminiConfigured,
    isMetaConfigured,
} from './config/env.js';
import adminRoutes from './routes/adminRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import authRoutes from './routes/authRoutes.js';
import connectionRoutes from './routes/connectionRoutes.js';
import mediaRoutes from './routes/mediaRoutes.js';
import postRoutes from './routes/postRoutes.js';
import { errorHandler, notFound } from './middlewares/errorMiddleware.js';
import { startScheduler, stopScheduler } from './services/schedulerService.js';

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(
    cors({
        origin(origin, callback) {
            if (!origin) {
                callback(null, true);
                return;
            }
            const normalized = origin.replace(/\/$/, '');
            callback(null, env.clientUrls.includes(normalized));
        },
    })
);
app.use(express.json({ limit: '1mb' }));

app.get('/', (_req: Request, res: Response) => {
    res.json({ message: 'Welcome to the Meta-Bru API' });
});

app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        features: {
            meta: isMetaConfigured,
            media: isCloudinaryConfigured,
            ai: isGeminiConfigured,
            scheduler: env.scheduler.enabled,
        },
    });
});

app.use('/api/auth', authRoutes);
app.use('/api/connections', connectionRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/admin', adminRoutes);

app.use(notFound);
app.use(errorHandler);

async function start(): Promise<void> {
    await connectDB();

    app.listen(env.port, () => {
        console.log(`Server is running on http://localhost:${env.port}`);
        startScheduler();
    });
}

function shutdown(signal: string): void {
    console.log(`Received ${signal}, shutting down`);
    stopScheduler();
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

void start().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
