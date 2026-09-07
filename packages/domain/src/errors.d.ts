export declare class DomainError extends Error {
    readonly code: string;
    readonly retryable: boolean;
    constructor(code: string, message: string, retryable?: boolean);
}
//# sourceMappingURL=errors.d.ts.map