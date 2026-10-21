export class AppError extends Error {
    readonly statusCode: number;
    readonly code: string;

    constructor(statusCode: number, message: string, code = 'APP_ERROR') {
        super(message);
        this.name = 'AppError';
        this.statusCode = statusCode;
        this.code = code;
    }
}
