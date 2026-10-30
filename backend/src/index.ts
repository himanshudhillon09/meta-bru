import express, { type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { connectDB } from './config/db.js';
import { env } from './config/env.js';
import adminRoutes from './routes/adminRoutes.js';
import usageRoutes from './routes/usageRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import authRoutes from './routes/authRoutes.js';
import connectionRoutes from './routes/connectionRoutes.js';
import mediaRoutes from './routes/mediaRoutes.js';
import postRoutes from './routes/postRoutes.js';
import { errorHandler, notFound } from './middlewares/errorMiddleware.js';
import { schedulerStatus, startScheduler, stopScheduler } from './services/schedulerService.js';
import { migrateConnectionSchedules } from './services/scheduleSyncService.js';

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
            scheduler: env.scheduler.enabled,
            perUserCredentials: true,
        },
        // Shows whether queued posts are being checked (uptime monitors can
        // watch lastTickAt too).
        scheduler: schedulerStatus(),
    });
});

app.use('/api/auth', authRoutes);
app.use('/api/connections', connectionRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/usage', usageRoutes);

app.use(notFound);
app.use(errorHandler);

async function start(): Promise<void> {
    await connectDB();

    // Upgrade Page schedules before the scheduler reads them. A failure stops
    // start-up, like a database connection failure.
    const migration = await migrateConnectionSchedules();
    if (migration.copied > 0 || migration.rescheduled > 0) {
        console.log(
            `[schedule] Upgraded ${migration.copied} Page schedules; moved ${migration.rescheduled} Pages to their Profile timezone`
        );
    }

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
