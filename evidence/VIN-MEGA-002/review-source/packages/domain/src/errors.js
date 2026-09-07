export class DomainError extends Error {
    constructor(code, message, retryable = false) {
        super(message);
        this.name = 'DomainError';
        this.code = code;
        this.retryable = retryable;
    }
}
//# sourceMappingURL=errors.js.map