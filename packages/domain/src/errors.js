export class DomainError extends Error {
    code;
    retryable;
    constructor(code, message, retryable = false) {
        super(message);
        this.name = 'DomainError';
        this.code = code;
        this.retryable = retryable;
    }
}
