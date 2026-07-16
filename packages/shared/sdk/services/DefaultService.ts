/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiError } from '../models/ApiError';
import type { LedgerEntry } from '../models/LedgerEntry';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class DefaultService {
    constructor(public readonly httpRequest: BaseHttpRequest) {}
    /**
     * Get ledger entries
     * @param tutorId
     * @param since
     * @returns LedgerEntry A list of ledger entries
     * @returns ApiError Standard error
     * @throws ApiError
     */
    public ledgerListEntries(
        tutorId: string,
        since?: string,
    ): CancelablePromise<Array<LedgerEntry> | ApiError> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/ledger',
            query: {
                'tutorId': tutorId,
                'since': since,
            },
        });
    }
    /**
     * Post a new ledger entry
     * @param requestBody
     * @returns LedgerEntry Created ledger entry
     * @returns ApiError Standard error
     * @throws ApiError
     */
    public ledgerPostEntry(
        requestBody: {
            tutorId: string;
            studentId: string;
            batchId?: string;
            kind: 'fee_due' | 'fee_paid' | 'discount' | 'refund';
            /**
             * Amount in integer paise
             */
            amountPaise: number;
            notes?: string;
        },
    ): CancelablePromise<LedgerEntry | ApiError> {
        return this.httpRequest.request({
            method: 'POST',
            url: '/ledger',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Void a ledger entry (creates a reversing entry)
     * @param id
     * @param requestBody
     * @returns LedgerEntry The reversing entry
     * @returns ApiError Standard error
     * @throws ApiError
     */
    public ledgerVoidEntry(
        id: string,
        requestBody: {
            tutorId: string;
            reason: string;
        },
    ): CancelablePromise<LedgerEntry | ApiError> {
        return this.httpRequest.request({
            method: 'POST',
            url: '/ledger/{id}/void',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get the balance for a student
     * @param tutorId
     * @param studentId
     * @returns any The balance
     * @returns ApiError Standard error
     * @throws ApiError
     */
    public ledgerComputeBalance(
        tutorId: string,
        studentId: string,
    ): CancelablePromise<{
        balancePaise: number;
    } | ApiError> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/ledger/balance',
            query: {
                'tutorId': tutorId,
                'studentId': studentId,
            },
        });
    }
    /**
     * Securely erase all tutor data
     * @param requestBody
     * @returns any Data erased successfully
     * @returns ApiError Standard error
     * @throws ApiError
     */
    public secureErase(
        requestBody: {
            tutorId: string;
            confirm: string;
        },
    ): CancelablePromise<{
        success?: boolean;
    } | ApiError> {
        return this.httpRequest.request({
            method: 'POST',
            url: '/security/erase',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
}
