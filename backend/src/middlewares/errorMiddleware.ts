import type { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';
import { AppError } from '../utils/errors.js';

export function notFound(req: Request, res: Response): void {
    res.status(404).json({
        success: false,
        message: `Route not found: ${req.method} ${req.originalUrl}`,
    });
}

export function errorHandler(
    err: unknown,
    req: Request,
    res: Response,
    _next: NextFunction
): void {
    if (err instanceof MulterError) {
        const message =
            err.code === 'LIMIT_FILE_SIZE'
                ? 'Image is too large. Maximum size is 10 MB.'
                : `Upload failed: ${err.message}`;
        res.status(400).json({ success: false, message });
        return;
    }

    const candidateStatus =
        err instanceof AppError
            ? err.statusCode
            : typeof err === 'object' && err !== null && 'statusCode' in err
              ? Number((err as { statusCode: unknown }).statusCode)
              : 500;
    const statusCode =
        Number.isInteger(candidateStatus) &&
        candidateStatus >= 400 &&
        candidateStatus <= 599
            ? candidateStatus
            : 500;

    // Unexpected server errors may contain internal details; only expose
    // messages we deliberately wrapped as AppError.
    const message =
        err instanceof AppError
            ? err.message
            : 'An unexpected server error occurred';

    if (statusCode >= 500) {
        console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
    }

    res.status(statusCode).json({
        success: false,
        message,
        ...(err instanceof AppError ? { code: err.code } : {}),
    });
}
