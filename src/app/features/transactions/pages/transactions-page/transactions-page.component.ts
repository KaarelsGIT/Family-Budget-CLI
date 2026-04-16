import { CommonModule } from '@angular/common';
import { Component, HostListener, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../../../../auth/auth.service';
import { TranslationService } from '../../../../i18n/translation.service';
import { Account } from '../../../accounts/models/account.model';
import { AccountService } from '../../../accounts/services/account.service';
import { canTransactFromAccount } from '../../../accounts/utils/account-access';
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
import { formatMoney } from '../../../../shared/utils/money-format';

type SortField = 'transactionDate' | 'createdAt' | 'amount' | 'category.name' | 'fromAccount.name' | 'createdBy.username' | 'comment' | 'id' | 'type';
type SortDirection = 'asc' | 'desc';
interface SortConfigItem {
  field: SortField;
  direction: SortDirection;
}
type TransactionFilterType = TransactionItem['type'] | null;
interface CategoryFilterOption {
  id: number;
  label: string;
}

@Component({
  selector: 'app-transactions-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, AddTransactionModalComponent, EditTransactionModalComponent],
  templateUrl: './transactions-page.component.html',
  styleUrl: './transactions-page.component.css'
})
export class TransactionsPageComponent {
  private readonly transactionsService = inject(TransactionsService);
  private readonly transactionDraftService = inject(TransactionDraftService);
  private readonly accountService = inject(AccountService);
  private readonly authService = inject(AuthService);
  readonly i18n = inject(TranslationService);

  readonly currentUserId = this.authService.getUserId();
  readonly currentUserRole = this.authService.getRole();

  readonly transactions = signal<TransactionItem[]>([]);
  readonly categories = signal<TransactionCategory[]>([]);
  readonly users = signal<TransactionUserOption[]>([]);
  readonly accounts = signal<Account[]>([]);
  readonly isLoading = signal(false);
  readonly isLoadingFilters = signal(false);
  readonly isAddTransactionModalOpen = signal(false);
  readonly selectedTransactionToEdit = signal<TransactionItem | null>(null);
  readonly pendingDeleteTransaction = signal<TransactionItem | null>(null);
  readonly isDeleting = signal(false);
  readonly errorMessage = signal('');
  readonly totalItems = signal(0);
  readonly sortConfig = signal<SortConfigItem[]>(this.loadSortConfig());
  readonly isTransactionsMenuOpen = signal(false);

  readonly filters = signal({
    page: 0,
    size: 25,
    userId: this.currentUserId,
    type: null as TransactionFilterType,
    mainCategoryId: null as number | null,
    subCategoryId: null as number | null,
    fromDate: '',
    toDate: ''
  });

  readonly filterUsers = computed(() => this.buildUserFilterOptions(this.users()));

  readonly categoryFilterOptions = computed<CategoryFilterOption[]>(() =>
    this.buildMainCategoryOptions(this.categories(), this.filters().type)
  );

  readonly subCategoryFilterOptions = computed<CategoryFilterOption[]>(() =>
    this.buildSubCategoryOptions(this.categories(), this.filters().type, this.filters().mainCategoryId)
  );

  readonly pageCount = computed(() => {
    const size = this.filters().size;
    return size > 0 ? Math.max(1, Math.ceil(this.totalItems() / size)) : 1;
  });

  readonly periodNetBalance = computed(() =>
    this.transactions().reduce((sum, transaction) => {
      if (this.filters().type === 'TRANSFER') {
        return sum + transaction.amount;
      }

      if (transaction.type === 'INCOME') {
        return sum + transaction.amount;
      }
      if (transaction.type === 'EXPENSE') {
        return sum - transaction.amount;
      }
      return sum;
    }, 0)
  );

  readonly hasPreviousPage = computed(() => this.filters().page > 0);
  readonly hasNextPage = computed(() => this.filters().page + 1 < this.pageCount());

  constructor() {
    this.loadFilterOptions();
    this.loadAccounts();
    this.loadTransactions();
    effect(() => {
      if (this.transactionDraftService.openTransactionRequest()) {
        this.isAddTransactionModalOpen.set(true);
      }
    });
  }

  @HostListener('document:click', ['$event'])
  handleDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target?.closest('.transactions-menu')) {
      this.closeTransactionsMenu();
    }
  }

  openTransactionModal(request: { type: 'INCOME' | 'EXPENSE' | 'TRANSFER'; preselectedFromAccount?: number | null }): void {
    this.selectedTransactionToEdit.set(null);
    this.transactionDraftService.openTransactionModal(request);
    this.isAddTransactionModalOpen.set(true);
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

    this.pendingDeleteTransaction.set(transaction);
  }

  closeDeleteConfirmation(): void {
    this.pendingDeleteTransaction.set(null);
  }

  confirmDeleteTransaction(): void {
    const transaction = this.pendingDeleteTransaction();
    if (!transaction || this.isDeleting()) {
      return;
    }

    this.isDeleting.set(true);

    this.transactionsService.deleteTransaction(transaction.id).pipe(
      finalize(() => this.isDeleting.set(false))
    ).subscribe({
      next: () => {
        this.closeDeleteConfirmation();
        this.filters.update((state) => ({
          ...state,
          page: 0
        }));
        this.loadTransactions();
      },
      error: (error: { error?: { message?: string } }) => {
        this.errorMessage.set(error.error?.message || this.i18n.translate('transactions.deleteFailed'));
        this.closeDeleteConfirmation();
      }
    });
  }

  onUserChange(value: number | null): void {
    this.filters.update((state) => ({
      ...state,
      page: 0,
      userId: value
    }));
    this.loadTransactions();
  }

  onTypeChange(value: TransactionFilterType): void {
    this.filters.update((state) => ({
      ...state,
      page: 0,
      type: value,
      mainCategoryId: null,
      subCategoryId: null
    }));
    this.loadTransactions();
  }

  toggleTransactionsMenu(): void {
    this.isTransactionsMenuOpen.update((state) => !state);
  }

  closeTransactionsMenu(): void {
    this.isTransactionsMenuOpen.set(false);
  }

  onMainCategoryChange(value: number | null): void {
    this.filters.update((state) => ({
      ...state,
      page: 0,
      mainCategoryId: value,
      subCategoryId: null
    }));
    this.loadTransactions();
  }

  onSubCategoryChange(value: number | null): void {
    this.filters.update((state) => ({
      ...state,
      page: 0,
      subCategoryId: value
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
      size: 25,
      userId: this.currentUserId,
      type: null,
      mainCategoryId: null,
      subCategoryId: null,
      fromDate: '',
      toDate: ''
    });
    this.sortConfig.set(this.loadSortConfig(true));
    this.loadTransactions();
  }

  setSort(field: SortField, event?: MouseEvent): void {
    const isShift = !!event?.shiftKey;
    this.sortConfig.update((current) => this.updateSortConfig(current, field, isShift));
    this.persistSortConfig();
    this.filters.update((state) => ({
      ...state,
      page: 0
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
    return formatMoney(value);
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
    return this.sortConfig().some((item) => item.field === field);
  }

  getSortMeta(field: SortField): { direction: SortDirection; priority: number } | null {
    const index = this.sortConfig().findIndex((item) => item.field === field);
    if (index < 0) {
      return null;
    }

    const item = this.sortConfig()[index];
    return {
      direction: item.direction,
      priority: index + 1
    };
  }

  getSortClass(field: SortField): string {
    return this.isSortedBy(field) ? 'sorted' : '';
  }

  trackByTransactionId(_index: number, transaction: TransactionItem): number {
    return transaction.id;
  }

  trackByCategoryId(_index: number, category: CategoryFilterOption): number {
    return category.id;
  }

  canModifyTransaction(transaction: TransactionItem): boolean {
    if (this.currentUserRole === 'ADMIN') {
      return true;
    }

    if (transaction.type !== 'TRANSFER') {
      return transaction.createdById === this.currentUserId;
    }

    if (transaction.createdById === this.currentUserId) {
      return true;
    }

    const sourceAccount = this.accounts().find((account) => account.id === transaction.fromAccountId);
    if (!sourceAccount) {
      return false;
    }

    return canTransactFromAccount(sourceAccount, this.currentUserId, this.currentUserRole);
  }

  getDeleteConfirmationMessage(transaction: TransactionItem): string {
    return transaction.type === 'TRANSFER'
      ? this.i18n.translate('transactions.deleteTransferConfirm')
      : this.i18n.translate('transactions.deleteConfirm');
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

  private loadAccounts(): void {
    this.accountService.getAccounts().subscribe({
      next: (accounts) => {
        this.accounts.set(accounts);
      },
      error: () => {
        this.accounts.set([]);
      }
    });
  }

  private buildQuery(): TransactionQuery {
    const filters = this.filters();
    const sort = this.sortConfig().map((item) => `${item.field}:${item.direction}`).join(',');

    return {
      page: filters.page,
      size: filters.size,
      sort,
      userId: filters.userId ?? this.currentUserId,
      type: filters.type,
      mainCategoryId: filters.mainCategoryId,
      subCategoryId: filters.subCategoryId,
      from: filters.fromDate || null,
      to: filters.toDate || null
    };
  }

  private updateSortConfig(current: SortConfigItem[], field: SortField, isShift: boolean): SortConfigItem[] {
    const existingIndex = current.findIndex((item) => item.field === field);
    const existing = existingIndex >= 0 ? current[existingIndex] : null;

    if (!isShift) {
      if (!existing) {
        return [{ field, direction: 'asc' }];
      }

      return [{ field, direction: existing.direction === 'asc' ? 'desc' : 'asc' }];
    }

    const next = [...current];
    if (!existing) {
      next.push({ field, direction: 'asc' });
      return next;
    }

    if (existing.direction === 'asc') {
      next[existingIndex] = { field, direction: 'desc' };
      return next;
    }

    next.splice(existingIndex, 1);
    return next;
  }

  private loadSortConfig(resetToDefault = false): SortConfigItem[] {
    if (resetToDefault) {
      return [
        { field: 'transactionDate', direction: 'desc' },
        { field: 'id', direction: 'desc' }
      ];
    }

    const raw = localStorage.getItem('budget_sort_pref');
    if (!raw) {
      return [
        { field: 'transactionDate', direction: 'desc' },
        { field: 'id', direction: 'desc' }
      ];
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error('Invalid sort config');
      }

      const allowedFields: SortField[] = ['transactionDate', 'amount', 'category.name', 'fromAccount.name', 'createdBy.username', 'comment', 'id'];
      const config = parsed
        .filter((item): item is SortConfigItem => {
          return !!item && typeof item === 'object'
            && 'field' in item && 'direction' in item
            && allowedFields.includes((item as SortConfigItem).field)
            && (((item as SortConfigItem).direction === 'asc') || ((item as SortConfigItem).direction === 'desc'));
        })
        .slice(0, 4);

      if (config.length === 0) {
        throw new Error('Empty sort config');
      }

      return config;
    } catch {
      return [
        { field: 'transactionDate', direction: 'desc' },
        { field: 'id', direction: 'desc' }
      ];
    }
  }

  private persistSortConfig(): void {
    localStorage.setItem('budget_sort_pref', JSON.stringify(this.sortConfig()));
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

  private buildMainCategoryOptions(categories: TransactionCategory[], type: TransactionFilterType): CategoryFilterOption[] {
    if (type === 'TRANSFER') {
      return [];
    }

    return categories
      .filter((category) => category.parentCategoryId === null)
      .filter((category) => category.type !== 'TRANSFER')
      .filter((category) => type === null || category.type === type)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((category) => ({
        id: category.id,
        label: category.name
      }));
  }

  private buildSubCategoryOptions(
    categories: TransactionCategory[],
    type: TransactionFilterType,
    mainCategoryId: number | null
  ): CategoryFilterOption[] {
    if (type === 'TRANSFER' || mainCategoryId === null) {
      return [];
    }

    const mainCategory = categories.find((category) => category.id === mainCategoryId && category.parentCategoryId === null);
    if (!mainCategory) {
      return [];
    }

    return categories
      .filter((category) => category.parentCategoryId === mainCategoryId)
      .filter((category) => category.type !== 'TRANSFER')
      .filter((category) => type === null || category.type === type)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((category) => ({
        id: category.id,
        label: category.name
      }));
  }
}
