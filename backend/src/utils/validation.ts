import type { Request } from 'express';
import { z } from 'zod';
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

/** Where the photo sits in a post image (see renderPostImage). */
export const textAreaSchema = z.object({
    left: z.number().finite().min(0),
    top: z.number().finite().min(0),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    radius: z.number().finite().min(0),
});
