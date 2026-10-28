import type { Request } from 'express';
import type { z } from 'zod';
import { AppError } from './errors.js';

export function parseBody<T extends z.ZodTypeAny>(schema: T, req: Request): z.infer<T> {
    const result = schema.safeParse(req.body);
    if (!result.success) {
        const message = result.error.issues
            .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
            .join('; ');
        throw new AppError(400, message, 'VALIDATION_ERROR');
    }
    return result.data;
}

export function parseQuery<T extends z.ZodTypeAny>(schema: T, req: Request): z.infer<T> {
    const result = schema.safeParse(req.query);
    if (!result.success) {
        const message = result.error.issues
            .map((issue) => `${issue.path.join('.') || 'query'}: ${issue.message}`)
            .join('; ');
        throw new AppError(400, message, 'VALIDATION_ERROR');
    }
    return result.data;
}
