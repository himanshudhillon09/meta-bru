declare global {
    namespace Express {
        interface Request {
            user?: any;
            /** `iat` of the verified JWT, in seconds. Set by `protect`. */
            tokenIssuedAt?: number;
        }
    }
}

export {};
