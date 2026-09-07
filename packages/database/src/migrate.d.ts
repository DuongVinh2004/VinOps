export type AppliedMigration = {
    name: string;
    checksum: string;
};
export declare function verifyMigrations(connectionString: string): Promise<readonly AppliedMigration[]>;
export declare function runMigrations(connectionString: string): Promise<readonly AppliedMigration[]>;
//# sourceMappingURL=migrate.d.ts.map