import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { AuthService } from '../../../../auth/auth.service';
import { TranslationService } from '../../../../i18n/translation.service';
import { AddTransactionModalComponent } from '../../components/add-transaction-modal/add-transaction-modal.component';
import { EditTransactionModalComponent } from '../../components/edit-transaction-modal/edit-transaction-modal.component';
import {
  TransactionCategory,
  TransactionItem,
  TransactionQuery,
  TransactionUserOption
} from '../../models/transaction.model';
import { TransactionDraftService } from '../../services/transaction-draft.service';
import { TransactionsService } from '../../services/transactions.service';
import { formatEuroAmount } from '../../../../shared/utils/money-format';

type SortField = 'transactionDate' | 'createdAt' | 'amount' | 'createdBy.username' | 'category.name' | 'type';
interface CategoryFilterOption {
  id: number;
  label: string;
}

@Component({
  selector: 'app-transactions-page',
  standalone: true,
  imports: [CommonModule, FormsModule, AddTransactionModalComponent, EditTransactionModalComponent],
  templateUrl: './transactions-page.component.html',
  styleUrl: './transactions-page.component.css'
})
export class TransactionsPageComponent {
  private readonly transactionsService = inject(TransactionsService);
  private readonly transactionDraftService = inject(TransactionDraftService);
  private readonly authService = inject(AuthService);
  readonly i18n = inject(TranslationService);

  readonly currentUserId = this.authService.getUserId();
  readonly currentUserRole = this.authService.getRole();

  readonly transactions = signal<TransactionItem[]>([]);
  readonly categories = signal<TransactionCategory[]>([]);
  readonly users = signal<TransactionUserOption[]>([]);
  readonly isLoading = signal(false);
  readonly isLoadingFilters = signal(false);
  readonly isAddTransactionModalOpen = signal(false);
  readonly selectedTransactionToEdit = signal<TransactionItem | null>(null);
  readonly errorMessage = signal('');
  readonly totalItems = signal(0);

  readonly filters = signal({
    page: 0,
    size: 10,
    sortBy: 'transactionDate' as SortField,
    sortOrder: 'desc' as 'asc' | 'desc',
    userId: this.currentUserId,
    categoryId: null as number | null,
    fromDate: '',
    toDate: ''
  });

  readonly filterUsers = computed(() => this.buildUserFilterOptions(this.users()));

  readonly categoryFilterOptions = computed<CategoryFilterOption[]>(() =>
    this.buildCategoryFilterOptions(this.categories())
  );

  readonly pageCount = computed(() => {
    const size = this.filters().size;
    return size > 0 ? Math.max(1, Math.ceil(this.totalItems() / size)) : 1;
  });

  readonly hasPreviousPage = computed(() => this.filters().page > 0);
  readonly hasNextPage = computed(() => this.filters().page + 1 < this.pageCount());

  constructor() {
    this.loadFilterOptions();
    this.loadTransactions();
    effect(() => {
      if (this.transactionDraftService.openTransactionRequest()) {
        this.isAddTransactionModalOpen.set(true);
      }
    });
  }

  openAddTransactionModal(): void {
    console.log('[TransactionsPage] openAddTransactionModal() clicked');

    try {
      this.selectedTransactionToEdit.set(null);
      this.isAddTransactionModalOpen.set(true);
      console.log('[TransactionsPage] AddTransactionModal open state set to true');
    } catch (error) {
      console.error('[TransactionsPage] Failed to open AddTransactionModal', error);
    }
  }

  closeAddTransactionModal(): void {
    this.isAddTransactionModalOpen.set(false);
    this.transactionDraftService.reset();
    this.transactionDraftService.clearOpenRequest();
  }

  openEditTransactionModal(transaction: TransactionItem): void {
    if (!this.canModifyTransaction(transaction)) {
      return;
    }

    this.isAddTransactionModalOpen.set(false);
    this.selectedTransactionToEdit.set(transaction);
  }

  closeEditTransactionModal(): void {
    this.selectedTransactionToEdit.set(null);
  }

  handleTransactionCreated(): void {
    this.filters.update((state) => ({
      ...state,
      page: 0
    }));
    this.closeAddTransactionModal();
    this.loadTransactions();
  }

  handleTransactionUpdated(): void {
    this.filters.update((state) => ({
      ...state,
      page: 0
    }));
    this.selectedTransactionToEdit.set(null);
    this.loadTransactions();
  }

  handleCategoryCreated(category: TransactionCategory): void {
    this.categories.update((categories) => {
      if (categories.some(({ id }) => id === category.id)) {
        return [...categories];
      }

      return [...categories, category];
    });
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

  deleteTransaction(transaction: TransactionItem): void {
    if (!this.canModifyTransaction(transaction)) {
      return;
    }

    const confirmed = window.confirm(this.i18n.translate('transactions.deleteConfirm'));
    if (!confirmed) {
      return;
    }

    this.transactionsService.deleteTransaction(transaction.id).subscribe({
      next: () => {
        this.filters.update((state) => ({
          ...state,
          page: 0
        }));
        this.loadTransactions();
      },
      error: (error: { error?: { message?: string } }) => {
        this.errorMessage.set(error.error?.message || this.i18n.translate('transactions.deleteFailed'));
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
      categoryId: value ? Number(value) : null
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
      userId: this.currentUserId,
      categoryId: null,
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
    return formatEuroAmount(value, this.i18n.language());
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
    if (!category) {
      return transaction.categoryName ?? this.i18n.translate('transactions.noCategory');
    }

    if (category.parentCategoryName) {
      return `${category.parentCategoryName} / ${category.name}`;
    }

    return category.name;
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

  canModifyTransaction(transaction: TransactionItem): boolean {
    return transaction.type !== 'TRANSFER' && transaction.createdById === this.currentUserId;
  }

  private loadFilterOptions(): void {
    this.isLoadingFilters.set(true);

    this.loadCategories();

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

  private loadCategories(): void {
    this.transactionsService.getCategories().subscribe({
      next: (categories) => {
        this.categories.set(categories);
      },
      error: () => {
        this.categories.set([]);
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
      userId: filters.userId ?? this.currentUserId,
      categoryId: filters.categoryId,
      from: filters.fromDate || null,
      to: filters.toDate || null
    };
  }

  private buildUserFilterOptions(users: TransactionUserOption[]): TransactionUserOption[] {
    if (this.currentUserId === null) {
      return users;
    }

    if (this.currentUserRole === 'CHILD') {
      return users.filter((user) => user.id === this.currentUserId);
    }

    return users;
  }

  private buildCategoryFilterOptions(categories: TransactionCategory[]): CategoryFilterOption[] {
    const childrenByParent = new Map<number, TransactionCategory[]>();
    for (const category of categories) {
      if (category.parentCategoryId === null) {
        continue;
      }
      const list = childrenByParent.get(category.parentCategoryId) ?? [];
      list.push(category);
      childrenByParent.set(category.parentCategoryId, list);
    }

    const rootCategories = categories
      .filter((category) => category.parentCategoryId === null)
      .sort((a, b) => a.name.localeCompare(b.name));

    return rootCategories.flatMap((parent) => {
      const children = childrenByParent.get(parent.id) ?? [];
      if (children.length === 0) {
        return [{ id: parent.id, label: parent.name }];
      }

      return children
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((child) => ({
          id: child.id,
          label: `${parent.name} / ${child.name}`
        }));
    });
  }
}
