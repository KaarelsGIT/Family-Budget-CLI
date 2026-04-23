import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';
import { TransactionDraft, TransactionOpenRequest } from '../models/transaction.model';

@Injectable({
  providedIn: 'root'
})
export class TransactionDraftService {
  private readonly authService = inject(AuthService);
  private readonly draft = signal<TransactionDraft>(this.createEmptyDraft());
  private readonly openRequest = signal<TransactionOpenRequest | null>(null);
  private lastUserId: number | null = this.authService.getUserId();

  readonly value = computed(() => this.draft());
  readonly openTransactionRequest = computed(() => this.openRequest());

  constructor() {
    effect(() => {
      const userId = this.authService.getUserId();
      if (userId !== this.lastUserId) {
        this.lastUserId = userId;
        this.reset();
      }
    });
  }

  update(patch: Partial<TransactionDraft>): void {
    this.draft.update((state) => ({
      ...state,
      ...patch
    }));
  }

  requestOpen(request: TransactionOpenRequest): void {
    this.openRequest.set({
      ...request,
      amount: request.amount ?? null,
      transactionDate: request.transactionDate ?? this.getTodayDate(),
      comment: request.comment ?? '',
      reminderId: request.reminderId ?? null
    });
  }

  openTransactionModal(request: {
    type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
    preselectedFromAccount?: number | null;
  }): void {
    this.openRequest.set({
      type: request.type,
      categoryId: null,
      preselectedFromAccount: request.preselectedFromAccount ?? null,
      amount: null,
      transactionDate: this.getTodayDate(),
      comment: '',
      reminderId: null
    });
  }

  clearOpenRequest(): void {
    this.openRequest.set(null);
  }

  reset(): void {
    this.draft.set(this.createEmptyDraft());
  }

  clearTransientFields(): void {
    this.draft.update((state) => ({
      ...state,
      amount: '',
      comment: ''
    }));
  }

  private createEmptyDraft(): TransactionDraft {
    return {
      type: 'EXPENSE',
      accountId: null,
      transferFromAccountId: null,
      transferToAccountId: null,
      toAccountId: null,
      mainCategoryId: null,
      categoryId: null,
      transactionDate: this.getTodayDate(),
      amount: '',
      comment: ''
    };
  }

  private getTodayDate(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
