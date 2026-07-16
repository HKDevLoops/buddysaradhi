/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ApiError = {
    code: ApiError.code;
    message: string;
    retryAfterMs?: number;
    operationId: string;
    traceId: string;
};
export namespace ApiError {
    export enum code {
        UNAUTHENTICATED = 'unauthenticated',
        FORBIDDEN = 'forbidden',
        CONTRACT_VIOLATION = 'contract_violation',
        NOT_FOUND = 'not_found',
        CONFLICT = 'conflict',
        RATE_LIMITED = 'rate_limited',
        STORAGE_UNAVAILABLE = 'storage_unavailable',
        UPSTREAM_VIOLATION = 'upstream_violation',
        INTERNAL = 'internal',
    }
}

