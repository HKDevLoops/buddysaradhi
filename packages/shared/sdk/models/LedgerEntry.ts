/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type LedgerEntry = {
    id: string;
    tutorId: string;
    studentId: string;
    batchId?: string;
    kind: LedgerEntry.kind;
    amountPaise: number;
    reversesEntryId?: string;
    notes?: string;
    createdAt: string;
};
export namespace LedgerEntry {
    export enum kind {
        FEE_DUE = 'fee_due',
        FEE_PAID = 'fee_paid',
        DISCOUNT = 'discount',
        REFUND = 'refund',
        VOID = 'void',
    }
}

