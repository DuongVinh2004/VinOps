export type CompletedPart = {
    partNumber: number;
    etag: string;
};
export type StoredObjectMetadata = {
    sizeBytes: number;
    etag: string | null;
    mediaType: string | null;
};
export interface ObjectStorage {
    createMultipartUpload(key: string, mediaType: string): Promise<string>;
    authorizeUploadPart(key: string, uploadId: string, partNumber: number, expiresSeconds: number): Promise<string>;
    completeMultipartUpload(key: string, uploadId: string, parts: readonly CompletedPart[]): Promise<void>;
    headObject(key: string): Promise<StoredObjectMetadata>;
    getObject(key: string): Promise<Uint8Array>;
    putObject(key: string, bytes: Uint8Array, mediaType: string): Promise<void>;
    copyObject(sourceKey: string, destinationKey: string, mediaType: string): Promise<void>;
    authorizeGet(key: string, expiresSeconds: number, filename?: string): Promise<string>;
}
export type S3ObjectStorageOptions = {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    clock?: () => Date;
    fetcher?: typeof fetch;
};
export declare function assertObjectKey(key: string): void;
export declare class S3ObjectStorage implements ObjectStorage {
    private readonly options;
    private readonly endpoint;
    private readonly clock;
    private readonly fetcher;
    constructor(options: S3ObjectStorageOptions);
    createMultipartUpload(key: string, mediaType: string): Promise<string>;
    authorizeUploadPart(key: string, uploadId: string, partNumber: number, expiresSeconds: number): Promise<string>;
    completeMultipartUpload(key: string, uploadId: string, parts: readonly CompletedPart[]): Promise<void>;
    headObject(key: string): Promise<StoredObjectMetadata>;
    getObject(key: string): Promise<Uint8Array>;
    putObject(key: string, bytes: Uint8Array, mediaType: string): Promise<void>;
    copyObject(sourceKey: string, destinationKey: string, mediaType: string): Promise<void>;
    authorizeGet(key: string, expiresSeconds: number, filename?: string): Promise<string>;
    private objectUrl;
    private signatureKey;
    private requestDate;
    private send;
    private presign;
}
//# sourceMappingURL=object-storage.d.ts.map