import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { TranslationService } from '../../../i18n/translation.service';
import {
  TransactionCategory,
  TransactionItem,
  TransactionQuery,
  TransactionUserOption
} from '../models/transaction.model';
import { TransactionsService } from '../services/transactions.service';

type SortField = 'transactionDate' | 'createdAt' | 'amount' | 'createdBy.username' | 'category.name' | 'type';

@Component({
  selector: 'app-transactions-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './transactions-page.component.html',
  styleUrl: './transactions-page.component.css'
})
export class TransactionsPageComponent {
  private readonly transactionsService = inject(TransactionsService);
  readonly i18n = inject(TranslationService);

  readonly transactions = signal<TransactionItem[]>([]);
  readonly categories = signal<TransactionCategory[]>([]);
  readonly users = signal<TransactionUserOption[]>([]);
  readonly isLoading = signal(false);
  readonly isLoadingFilters = signal(false);
  readonly errorMessage = signal('');
  readonly totalItems = signal(0);

  readonly filters = signal({
    page: 0,
    size: 10,
    sortBy: 'transactionDate' as SortField,
    sortOrder: 'desc' as 'asc' | 'desc',
    userId: null as number | null,
    categoryId: null as number | null,
    subcategoryId: null as number | null,
    fromDate: '',
    toDate: ''
  });

  readonly mainCategories = computed(() =>
    this.categories()
      .filter((category) => category.parentCategoryId === null)
      .sort((left, right) => left.name.localeCompare(right.name))
  );

  readonly subcategories = computed(() => {
    const categoryId = this.filters().categoryId;
    if (categoryId === null) {
      return [];
    }

    return this.categories()
      .filter((category) => category.parentCategoryId === categoryId)
      .sort((left, right) => left.name.localeCompare(right.name));
  });

  readonly pageCount = computed(() => {
    const size = this.filters().size;
    return size > 0 ? Math.max(1, Math.ceil(this.totalItems() / size)) : 1;
  });

  readonly hasPreviousPage = computed(() => this.filters().page > 0);
  readonly hasNextPage = computed(() => this.filters().page + 1 < this.pageCount());

  constructor() {
    this.loadFilterOptions();
    this.loadTransactions();
  }

  loadTransactions(): void {
    this.isLoading.set(true);
    this.errorMessage.set('');

    this.transactionsService.getTransactions(this.buildQuery())
      .pipe(finalize(() => {
        this.isLoading.set(false);
      }))
      .subscribe({
        next: (response) => {
          this.transactions.set(response.data);
          this.totalItems.set(response.total);
        },
        error: (error: { error?: { message?: string } }) => {
          this.transactions.set([]);
          this.totalItems.set(0);
          this.errorMessage.set(error.error?.message || this.i18n.translate('transactions.loadFailed'));
        }
      });
  }

  onUserChange(value: string): void {
    this.filters.update((state) => ({
      ...state,
      page: 0,
      userId: value ? Number(value) : null
    }));
    this.loadTransactions();
  }

  onCategoryChange(value: string): void {
    this.filters.update((state) => ({
      ...state,
      page: 0,
      categoryId: value ? Number(value) : null,
      subcategoryId: null
    }));
    this.loadTransactions();
  }

  onSubcategoryChange(value: string): void {
    this.filters.update((state) => ({
      ...state,
      page: 0,
      subcategoryId: value ? Number(value) : null
    }));
    this.loadTransactions();
  }

  onDateChange(field: 'fromDate' | 'toDate', value: string): void {
    this.filters.update((state) => ({
      ...state,
      page: 0,
      [field]: value
    }));
    this.loadTransactions();
  }

  clearFilters(): void {
    this.filters.set({
      page: 0,
      size: 10,
      sortBy: 'transactionDate',
      sortOrder: 'desc',
      userId: null,
      categoryId: null,
      subcategoryId: null,
      fromDate: '',
      toDate: ''
    });
    this.loadTransactions();
  }

  setSort(field: SortField): void {
    this.filters.update((state) => ({
      ...state,
      page: 0,
      sortBy: field,
      sortOrder: state.sortBy === field && state.sortOrder === 'asc' ? 'desc' : 'asc'
    }));
    this.loadTransactions();
  }

  changePage(direction: -1 | 1): void {
    const nextPage = this.filters().page + direction;
    if (nextPage < 0 || nextPage >= this.pageCount()) {
      return;
    }

    this.filters.update((state) => ({
      ...state,
      page: nextPage
    }));
    this.loadTransactions();
  }

  onPageSizeChange(value: string): void {
    this.filters.update((state) => ({
      ...state,
      page: 0,
      size: Number(value)
    }));
    this.loadTransactions();
  }

  formatAmount(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  }

  formatDate(value: string): string {
    const [year, month, day] = value.split('-').map(Number);
    return new Intl.DateTimeFormat(this.i18n.language(), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(year, (month || 1) - 1, day || 1));
  }

  formatCreatedAt(value: string): string {
    return new Intl.DateTimeFormat(this.i18n.language(), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value));
  }

  getCategoryLabel(transaction: TransactionItem): string {
    if (!transaction.categoryId) {
      return this.i18n.translate('transactions.typeTransfer');
    }

    const category = this.categories().find(({ id }) => id === transaction.categoryId);
    if (category?.parentCategoryName) {
      return `${category.parentCategoryName} / ${category.name}`;
    }

    return transaction.categoryName ?? this.i18n.translate('transactions.noCategory');
  }

  getAccountFlow(transaction: TransactionItem): string {
    if (transaction.type === 'INCOME') {
      return transaction.toAccountName ?? '—';
    }
    if (transaction.type === 'EXPENSE') {
      return transaction.fromAccountName ?? '—';
    }

    return `${transaction.fromAccountName ?? '—'} -> ${transaction.toAccountName ?? '—'}`;
  }

  getTypeLabel(type: TransactionItem['type']): string {
    switch (type) {
      case 'INCOME':
        return this.i18n.translate('transactions.typeIncome');
      case 'EXPENSE':
        return this.i18n.translate('transactions.typeExpense');
      default:
        return this.i18n.translate('transactions.typeTransfer');
    }
  }

  isSortedBy(field: SortField): boolean {
    return this.filters().sortBy === field;
  }

  trackByTransactionId(_index: number, transaction: TransactionItem): number {
    return transaction.id;
  }

  private loadFilterOptions(): void {
    this.isLoadingFilters.set(true);

    this.transactionsService.getCategories().subscribe({
      next: (categories) => {
        this.categories.set(categories);
      },
      error: () => {
        this.categories.set([]);
      }
    });

    this.transactionsService.getUsers()
      .pipe(finalize(() => {
        this.isLoadingFilters.set(false);
      }))
      .subscribe({
        next: (users) => {
          this.users.set(users);
        },
        error: () => {
          this.users.set([]);
        }
      });
  }

  private buildQuery(): TransactionQuery {
    const filters = this.filters();

    return {
      page: filters.page,
      size: filters.size,
      sortBy: filters.sortBy,
      sortOrder: filters.sortOrder,
      userId: filters.userId,
      categoryId: filters.categoryId,
      subcategoryId: filters.subcategoryId,
      from: filters.fromDate || null,
      to: filters.toDate || null
    };
  }
}
