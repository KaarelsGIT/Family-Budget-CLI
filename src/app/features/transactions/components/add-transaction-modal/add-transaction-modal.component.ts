import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { AuthService } from '../../../../auth/auth.service';
import { TranslationService } from '../../../../i18n/translation.service';
import { Account } from '../../../accounts/models/account.model';
import { AccountService, SelectableUser } from '../../../accounts/services/account.service';
import { TransferFormComponent, TransferSubmittedEvent } from '../../../accounts/components/transfer-form/transfer-form.component';
import { TransactionCategory, TransactionOpenRequest } from '../../models/transaction.model';
import { TransactionDraftService } from '../../services/transaction-draft.service';
import { TransactionsService } from '../../services/transactions.service';

type ModalView = 'transaction' | 'category';
type CategoryMode = 'main' | 'sub';
type TransactionType = 'INCOME' | 'EXPENSE' | 'TRANSFER';

const ADD_CATEGORY_VALUE = '__add_category__';

interface CategoryOption {
  id: number;
  label: string;
  type: TransactionType;
  parentCategoryId: number | null;
}

interface TypeOption {
  value: TransactionType;
  label: string;
}

interface TransferDestinationOption {
  accountId: number;
  value: string;
  label: string;
  groupKey: 'accounts.transferOwnAccounts' | 'accounts.transferOtherUsers';
}

@Component({
  selector: 'app-add-transaction-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, TransferFormComponent],
  templateUrl: './add-transaction-modal.component.html',
  styleUrl: './add-transaction-modal.component.css'
})
export class AddTransactionModalComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly accountService = inject(AccountService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly draftService = inject(TransactionDraftService);
  private readonly authService = inject(AuthService);
  readonly i18n = inject(TranslationService);

  readonly categories = input<TransactionCategory[]>([]);
  readonly closed = output<void>();
  readonly created = output<void>();
  readonly categoryCreated = output<TransactionCategory>();

  readonly accounts = signal<Account[]>([]);
  readonly selectableUsers = signal<SelectableUser[]>([]);
  readonly addCategoryValue = ADD_CATEGORY_VALUE;
  readonly isLoadingAccounts = signal(false);
  readonly isSubmitting = signal(false);
  readonly isSubmittingCategory = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');
  readonly categoryErrorMessage = signal('');
  readonly view = signal<ModalView>('transaction');
  readonly categoryMode = signal<CategoryMode>('main');
  readonly transactionType = signal<TransactionType>('EXPENSE');
  readonly categoryFormType = signal<TransactionType>('EXPENSE');
  readonly selectedMainCategoryId = signal<number | null>(null);
  readonly selectedCategoryId = signal<number | null>(null);
  readonly selectedTransferFromAccountId = signal<number | null>(null);
  readonly selectedTransferToAccountId = signal<number | null>(null);
  readonly transactionTypeOptions = computed<TypeOption[]>(() => {
    const collator = new Intl.Collator(this.i18n.language(), { sensitivity: 'base' });
    return [
      { value: 'INCOME' as TransactionType, label: this.i18n.translate('transactions.typeIncome') },
      { value: 'EXPENSE' as TransactionType, label: this.i18n.translate('transactions.typeExpense') },
      { value: 'TRANSFER' as TransactionType, label: this.i18n.translate('transactions.typeTransfer') }
    ].sort((left, right) => collator.compare(left.label, right.label));
  });

  readonly transactionForm = this.formBuilder.nonNullable.group({
    type: ['EXPENSE' as TransactionType],
    accountId: [''],
    transferFromAccountId: [''],
    transferToAccountId: [''],
    mainCategoryId: ['', Validators.required],
    categoryId: ['', Validators.required],
    transactionDate: ['', Validators.required],
    amount: ['', Validators.required],
    comment: ['', [Validators.maxLength(500)]]
  });

  readonly categoryForm = this.formBuilder.nonNullable.group({
    type: ['EXPENSE' as TransactionType, Validators.required],
    name: ['', [Validators.required, Validators.maxLength(120)]],
    parentCategoryId: [''],
    isRecurring: [false],
    dueDayOfMonth: ['']
  });

  readonly mainCategoryOptions = computed(() =>
    this.getCategoriesForType(this.transactionType())
      .filter((category) => category.parentCategoryId === null)
      .sort((left, right) => left.name.localeCompare(right.name))
  );

  readonly selectedMainCategory = computed(() =>
    this.mainCategoryOptions().find((category) => category.id === this.selectedMainCategoryId()) ?? null
  );

  readonly subCategoryOptions = computed<CategoryOption[]>(() =>
    this.buildSubCategoryOptions(this.selectedMainCategory())
  );

  readonly selectedCategory = computed(() =>
    this.getCategoriesForType(this.transactionType()).find((category) => category.id === this.selectedCategoryId()) ?? null
  );

  readonly categoryParentOptions = computed(() =>
    this.getCategoriesForType(this.categoryFormType())
      .filter((category) => category.parentCategoryId === null)
      .sort((left, right) => left.name.localeCompare(right.name))
  );
  readonly categoryAddLabel = computed(() => this.i18n.translate('transactions.addCategoryOption'));
  readonly mainCategoryPlaceholder = computed(() => this.i18n.translate('transactions.selectCategory'));
  readonly subCategoryPlaceholder = computed(() => this.i18n.translate('transactions.selectSubCategory'));

  readonly ownAccounts = computed(() => {
    const userId = this.authService.getUserId();
    if (userId === null) {
      return [];
    }

    return [...this.accounts()]
      .filter((account) => account.ownerId === userId)
      .sort((left, right) => {
        const typeOrder: Record<Account['type'], number> = {
          MAIN: 0,
          GOAL: 1,
          SAVINGS: 2,
          CASH: 3
        };

        if (left.type !== right.type) {
          return typeOrder[left.type] - typeOrder[right.type];
        }

        return left.name.localeCompare(right.name);
      });
  });

  readonly transferDestinationOptions = computed(() => this.buildTransferDestinationOptions());
  readonly transferOwnDestinationOptions = computed(() =>
    this.transferDestinationOptions().filter((option) => option.groupKey === 'accounts.transferOwnAccounts')
  );
  readonly transferOtherDestinationOptions = computed(() =>
    this.transferDestinationOptions().filter((option) => option.groupKey === 'accounts.transferOtherUsers')
  );
  readonly hasTransferDestinations = computed(() => this.transferDestinationOptions().length > 0);
  readonly selectedTransferSourceAccount = computed(() => {
    const sourceAccountId = this.selectedTransferFromAccountId();
    if (sourceAccountId === null) {
      return null;
    }

    return this.ownAccounts().find((account) => account.id === sourceAccountId) ?? null;
  });

  constructor() {
    this.patchFromDraft();
    this.initializeSignalsFromDraft();
    this.setupSubscriptions();
    this.setupOpenRequestEffect();
    this.loadAccounts();
    this.ensureDefaultIncomeExpenseAccount();
    this.syncRecurringControls();
    effect(() => {
      this.categories();
      if (this.view() === 'transaction') {
        this.syncIncomeExpenseSelection();
        this.ensureDefaultIncomeExpenseAccount();
      }
    });
  }

  close(): void {
    this.closed.emit();
  }

  openMainCategoryForm(): void {
    this.categoryMode.set('main');
    this.categoryErrorMessage.set('');
    this.errorMessage.set('');
    this.successMessage.set('');

    const fallbackType = this.transactionType() === 'TRANSFER' ? 'EXPENSE' : this.transactionType();
    this.categoryFormType.set(fallbackType);
    this.categoryForm.patchValue({
      type: fallbackType,
      name: '',
      parentCategoryId: '',
      isRecurring: false,
      dueDayOfMonth: ''
    }, { emitEvent: false });
    this.syncRecurringControls();

    this.view.set('category');
  }

  openSubcategoryForm(): void {
    const selectedMainCategory = this.selectedMainCategory();
    const fallbackType = this.transactionType() === 'TRANSFER' ? 'EXPENSE' : this.transactionType();

    this.categoryMode.set('sub');
    this.categoryErrorMessage.set('');
    this.errorMessage.set('');
    this.successMessage.set('');
    this.categoryFormType.set(selectedMainCategory?.type ?? fallbackType);
    this.categoryForm.patchValue({
      type: selectedMainCategory?.type ?? fallbackType,
      name: '',
      parentCategoryId: selectedMainCategory ? String(selectedMainCategory.id) : '',
      isRecurring: false,
      dueDayOfMonth: ''
    }, { emitEvent: false });
    this.syncRecurringControls();

    this.view.set('category');
  }

  onTransactionTypeChange(value: string): void {
    const normalizedType = this.normalizeType(value);
    this.transactionForm.patchValue({ type: normalizedType }, { emitEvent: false });
    this.transactionType.set(normalizedType);
    this.categoryFormType.set(normalizedType === 'TRANSFER' ? 'EXPENSE' : normalizedType);
    this.errorMessage.set('');
    this.syncRecurringControls();

    if (normalizedType === 'TRANSFER') {
      this.transactionForm.patchValue({
        mainCategoryId: '',
        categoryId: ''
      }, { emitEvent: false });
      this.selectedMainCategoryId.set(null);
      this.selectedCategoryId.set(null);
      this.ensureDefaultTransferSelections();
      return;
    }

    this.syncIncomeExpenseSelection();
    this.ensureDefaultIncomeExpenseAccount();
  }

  onMainCategoryChange(value: string): void {
    this.errorMessage.set('');

    if (value === ADD_CATEGORY_VALUE) {
      this.transactionForm.patchValue({ mainCategoryId: '' }, { emitEvent: false });
      this.selectedMainCategoryId.set(null);
      this.openMainCategoryForm();
      return;
    }

    const mainCategoryId = this.parseNumber(value);
    if (mainCategoryId === null) {
      this.transactionForm.patchValue({
        mainCategoryId: '',
        categoryId: ''
      }, { emitEvent: false });
      this.selectedMainCategoryId.set(null);
      this.selectedCategoryId.set(null);
      return;
    }

    this.applyMainCategorySelection(mainCategoryId);
  }

  onSubCategoryChange(value: string): void {
    this.errorMessage.set('');

    if (value === ADD_CATEGORY_VALUE) {
      this.transactionForm.patchValue({ categoryId: '' }, { emitEvent: false });
      this.selectedCategoryId.set(null);
      this.openSubcategoryForm();
      return;
    }

    const categoryId = this.parseNumber(value);
    if (categoryId === null) {
      this.transactionForm.patchValue({ categoryId: '' }, { emitEvent: false });
      this.selectedCategoryId.set(null);
      return;
    }

    this.transactionForm.patchValue({ categoryId: value }, { emitEvent: false });
    this.selectedCategoryId.set(categoryId);
    this.persistDraft();
  }

  onAccountChange(value: string): void {
    this.errorMessage.set('');
    this.transactionForm.patchValue({ accountId: value }, { emitEvent: false });
    this.persistDraft();
  }

  onTransferFromAccountChange(value: string): void {
    this.errorMessage.set('');
    this.transactionForm.patchValue({ transferFromAccountId: value }, { emitEvent: false });
    this.selectedTransferFromAccountId.set(this.parseNumber(value));
    this.ensureDefaultTransferDestination();
    this.persistDraft();
  }

  onTransferToAccountChange(value: string): void {
    this.errorMessage.set('');
    this.transactionForm.patchValue({ transferToAccountId: value }, { emitEvent: false });
    this.selectedTransferToAccountId.set(this.parseNumber(value));
    this.persistDraft();
  }

  backToTransactionForm(): void {
    this.view.set('transaction');
    this.categoryErrorMessage.set('');
    this.errorMessage.set('');
  }

  submitTransaction(): void {
    if (this.transactionType() === 'TRANSFER') {
      return;
    }

    if (this.isSubmitting() || this.transactionForm.invalid) {
      this.transactionForm.markAllAsTouched();
      this.errorMessage.set(this.i18n.translate('transactions.fillRequiredFields'));
      return;
    }

    const {
      type,
      accountId,
      mainCategoryId,
      categoryId,
      transactionDate,
      amount,
      comment
    } = this.transactionForm.getRawValue();
    const parsedAmount = Number(amount);
    const trimmedComment = (comment || '').trim();

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      this.errorMessage.set(this.i18n.translate('transactions.fillRequiredFields'));
      return;
    }

    const parsedMainCategoryId = this.parseNumber(mainCategoryId);
    const parsedCategoryId = this.parseNumber(categoryId);
    const selectedAccountId = this.parseNumber(accountId);

    if (
      selectedAccountId === null ||
      parsedMainCategoryId === null ||
      parsedCategoryId === null ||
      !transactionDate
    ) {
      this.errorMessage.set(this.i18n.translate('transactions.fillRequiredFields'));
      return;
    }

    if (type === 'EXPENSE' && parsedAmount > this.getSelectedAccountBalance(selectedAccountId)) {
      this.errorMessage.set(this.i18n.translate('transactions.balanceWouldGoNegative'));
      return;
    }

    this.errorMessage.set('');
    this.isSubmitting.set(true);

    this.transactionsService.createTransaction({
      amount: parsedAmount,
      type,
      accountId: selectedAccountId,
      categoryId: parsedCategoryId,
      transactionDate,
      comment: trimmedComment
    }).pipe(
      finalize(() => this.isSubmitting.set(false))
    ).subscribe({
      next: () => {
        this.showSuccessMessage(this.i18n.translate('transaction.add.success'));
        this.draftService.update({
          type,
          accountId: selectedAccountId,
          mainCategoryId: parsedMainCategoryId,
          categoryId: parsedCategoryId,
          transactionDate
        });
        this.draftService.clearTransientFields();
        this.transactionForm.patchValue({
          amount: null as unknown as string,
          comment: ''
        }, { emitEvent: false });
        this.created.emit();
      },
      error: (error: { error?: { message?: string } }) => {
        this.errorMessage.set(error.error?.message || this.i18n.translate('transactions.createFailed'));
      }
    });
  }

  onTransferCreated(event: TransferSubmittedEvent): void {
    this.errorMessage.set('');
    this.showSuccessMessage(this.i18n.translate('transaction.add.success'));
    this.draftService.update({
      type: 'TRANSFER',
      accountId: event.fromAccountId,
      transferFromAccountId: event.fromAccountId,
      transferToAccountId: event.toAccountId,
      toAccountId: event.toAccountId,
      transactionDate: event.transactionDate,
      amount: String(event.amount),
      comment: event.comment
    });
    this.draftService.clearTransientFields();
    this.transactionForm.patchValue({
      transferFromAccountId: String(event.fromAccountId),
      transferToAccountId: String(event.toAccountId),
      amount: '',
      comment: ''
    }, { emitEvent: false });
    this.created.emit();
  }

  submitCategory(): void {
    if (this.categoryForm.invalid || this.isSubmittingCategory()) {
      this.categoryForm.markAllAsTouched();
      const dueDayControl = this.categoryForm.controls.dueDayOfMonth;
      if (this.shouldAllowRecurring() && this.categoryForm.controls.isRecurring.value && dueDayControl.invalid) {
        this.categoryErrorMessage.set(this.i18n.translate('recurring.dueDateInvalid'));
      } else {
        this.categoryErrorMessage.set(this.i18n.translate('transactions.fillRequiredFields'));
      }
      return;
    }

    const { name, parentCategoryId } = this.categoryForm.getRawValue();
    const trimmedName = name.trim();
    const categoryType = this.normalizeType(this.categoryForm.controls.type.getRawValue());
    const parsedParentCategoryId = this.categoryMode() === 'sub' ? this.parseNumber(parentCategoryId) : null;
    const isRecurring = this.shouldAllowRecurring() && this.categoryForm.controls.isRecurring.value;
    const dueDayOfMonth = this.getRecurringDueDay();

    if (!trimmedName) {
      this.categoryErrorMessage.set(this.i18n.translate('transactions.fillRequiredFields'));
      return;
    }

    if (this.categoryMode() === 'sub' && parsedParentCategoryId === null) {
      this.categoryErrorMessage.set(this.i18n.translate('transactions.selectMainCategoryFirst'));
      return;
    }

    if (isRecurring && dueDayOfMonth === null) {
      this.categoryErrorMessage.set(this.i18n.translate('recurring.dueDateInvalid'));
      return;
    }

    this.categoryErrorMessage.set('');
    this.isSubmittingCategory.set(true);

    this.transactionsService.createCategory({
      name: trimmedName,
      type: categoryType,
      parentCategoryId: parsedParentCategoryId,
      group: this.authService.getRole() === 'CHILD' ? 'CHILD' : 'FAMILY',
      isRecurring,
      dueDayOfMonth
    }).pipe(
      finalize(() => this.isSubmittingCategory.set(false))
    ).subscribe({
      next: (category) => {
        if (this.categoryMode() === 'main') {
          this.transactionType.set(category.type);
          this.categoryFormType.set(category.type);
          this.selectedMainCategoryId.set(category.id);
          this.selectedCategoryId.set(null);
          this.transactionForm.patchValue({
            type: category.type,
            mainCategoryId: String(category.id),
            categoryId: ''
          }, { emitEvent: false });
          this.draftService.update({
            type: category.type,
            mainCategoryId: category.id,
            categoryId: null
          });
          this.backToTransactionForm();
          this.ensureDefaultIncomeExpenseAccount();
          this.categoryCreated.emit(category);
          return;
        }

        this.setSelectedCategory(parsedParentCategoryId ?? category.id, category.id, category.type);
        this.draftService.update({
          type: this.transactionType(),
          mainCategoryId: parsedParentCategoryId,
          categoryId: category.id
        });
        this.backToTransactionForm();
        this.ensureDefaultIncomeExpenseAccount();
        this.categoryCreated.emit(category);
      },
      error: (error: { error?: { message?: string } }) => {
        this.categoryErrorMessage.set(error.error?.message || this.i18n.translate('transactions.categoryCreateFailed'));
      }
    });
  }

  getModalTitle(): string {
    if (this.view() === 'category') {
      return this.i18n.translate('transactions.addCategoryTitle');
    }

    if (this.transactionType() === 'TRANSFER') {
      return this.i18n.translate('accounts.transferTitle');
    }

    return this.i18n.translate('transactions.addTitle');
  }

  getSubmitButtonLabel(): string {
    return this.transactionType() === 'TRANSFER'
      ? this.i18n.translate('accounts.transferCreate')
      : this.i18n.translate('transactions.addAction');
  }

  getSubmittingLabel(): string {
    return this.transactionType() === 'TRANSFER'
      ? this.i18n.translate('accounts.processing')
      : this.i18n.translate('transactions.creating');
  }

  getAccountFieldLabel(): string {
    return this.transactionType() === 'INCOME'
      ? this.i18n.translate('transactions.incomeAccount')
      : this.i18n.translate('transactions.expenseAccount');
  }

  getCategoryAddLabel(): string {
    return this.categoryAddLabel();
  }

  getMainCategoryPlaceholder(): string {
    return this.mainCategoryPlaceholder();
  }

  getSubCategoryPlaceholder(): string {
    return this.subCategoryPlaceholder();
  }

  trackByCategoryId(_index: number, item: { id: number }): number {
    return item.id;
  }

  trackByTransactionType(_index: number, option: TypeOption): TransactionType {
    return option.value;
  }

  trackByTransferOption(_index: number, option: TransferDestinationOption): number {
    return option.accountId;
  }

  trackByAccountId(_index: number, account: Account): number {
    return account.id;
  }

  isExpenseAmountWithinBalance(): boolean {
    if (this.transactionType() !== 'EXPENSE') {
      return true;
    }

    const selectedAccountId = this.parseNumber(this.transactionForm.controls.accountId.getRawValue());
    const amount = Number(this.transactionForm.controls.amount.getRawValue());
    if (selectedAccountId === null || !Number.isFinite(amount) || amount <= 0) {
      return true;
    }

    return amount <= this.getSelectedAccountBalance(selectedAccountId);
  }

  getAccountLabel(account: Account): string {
    return `${account.name} · ${account.ownerUsername}`;
  }

  private initializeSignalsFromDraft(): void {
    const draft = this.draftService.value();
    const type = this.normalizeType(draft.type);

    this.transactionType.set(type);
    this.categoryFormType.set(type === 'TRANSFER' ? 'EXPENSE' : type);
    this.selectedMainCategoryId.set(draft.mainCategoryId);
    this.selectedCategoryId.set(draft.categoryId);
    this.selectedTransferFromAccountId.set(draft.transferFromAccountId ?? draft.accountId);
    this.selectedTransferToAccountId.set(draft.transferToAccountId ?? draft.toAccountId);
  }

  private setupSubscriptions(): void {
    this.transactionForm.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        this.persistDraft();
      });

    this.transactionForm.controls.accountId.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((value) => {
        this.onAccountChange(value ?? '');
      });

    this.transactionForm.controls.transferFromAccountId.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((value) => {
        this.onTransferFromAccountChange(value ?? '');
      });

    this.transactionForm.controls.transferToAccountId.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((value) => {
        this.onTransferToAccountChange(value ?? '');
      });

    this.transactionForm.controls.mainCategoryId.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((value) => {
        this.onMainCategoryChange(value ?? '');
      });

    this.transactionForm.controls.categoryId.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((value) => {
        this.onSubCategoryChange(value ?? '');
      });

    this.transactionForm.controls.type.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((type) => {
        this.onTransactionTypeChange(type);
      });

    this.categoryForm.controls.type.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((type) => {
        const normalizedType = this.normalizeType(type);
        this.categoryFormType.set(normalizedType);
        this.categoryForm.patchValue({
          parentCategoryId: '',
          isRecurring: false,
          dueDayOfMonth: ''
        }, { emitEvent: false });
        this.syncRecurringControls();
      });

    this.categoryForm.controls.isRecurring.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((isRecurring) => {
        if (!isRecurring) {
          this.categoryForm.patchValue({ dueDayOfMonth: '' }, { emitEvent: false });
        }
        this.syncRecurringControls();
      });
  }

  private loadAccounts(): void {
    this.isLoadingAccounts.set(true);

    this.accountService.getAccounts()
      .pipe(finalize(() => this.isLoadingAccounts.set(false)))
      .subscribe({
        next: (accounts) => {
          this.accounts.set(accounts);
          if (this.transactionType() === 'TRANSFER') {
            this.ensureDefaultTransferSelections();
          } else {
            this.syncIncomeExpenseSelection();
            this.ensureDefaultIncomeExpenseAccount();
          }
        },
        error: (error: { error?: { message?: string } }) => {
          this.errorMessage.set(error.error?.message || this.i18n.translate('transactions.accountsLoadFailed'));
        }
      });
  }

  private setupOpenRequestEffect(): void {
    effect(() => {
      const request = this.draftService.openTransactionRequest();
      if (!request) {
        return;
      }

      if (this.applyOpenRequest(request)) {
        this.draftService.clearOpenRequest();
      }
    });
  }

  private applyOpenRequest(request: TransactionOpenRequest): boolean {
    const category = this.categories().find((item) => item.id === request.categoryId);
    if (!category) {
      return false;
    }

    const mainCategory = category.parentCategoryId !== null
      ? this.categories().find((item) => item.id === category.parentCategoryId) ?? null
      : category;

    const resolvedType = category.type === 'TRANSFER' ? 'EXPENSE' : category.type;

    this.view.set('transaction');
    this.categoryErrorMessage.set('');
    this.errorMessage.set('');
    this.successMessage.set('');

    this.transactionType.set(resolvedType);
    this.categoryFormType.set(resolvedType);
    this.categoryMode.set(category.parentCategoryId === null ? 'main' : 'sub');

    this.transactionForm.patchValue({
      type: resolvedType,
      accountId: request.accountId === null || request.accountId === undefined ? '' : String(request.accountId),
      transferFromAccountId: '',
      transferToAccountId: '',
      mainCategoryId: mainCategory ? String(mainCategory.id) : '',
      categoryId: String(category.id),
      transactionDate: request.transactionDate ?? this.getTodayDate(),
      amount: request.amount ?? '',
      comment: request.comment ?? ''
    }, { emitEvent: false });

    this.selectedMainCategoryId.set(mainCategory?.id ?? category.id);
    this.selectedCategoryId.set(category.id);
    this.selectedTransferFromAccountId.set(null);
    this.selectedTransferToAccountId.set(null);

    this.syncRecurringControls();
    this.ensureDefaultIncomeExpenseAccount();
    this.persistDraft();
    return true;
  }

  private syncRecurringControls(): void {
    const allowRecurring = this.shouldAllowRecurring();
    const recurringControl = this.categoryForm.controls.isRecurring;
    const dueDayControl = this.categoryForm.controls.dueDayOfMonth;

    if (!allowRecurring) {
      if (recurringControl.value) {
        recurringControl.setValue(false, { emitEvent: false });
      }

      dueDayControl.clearValidators();
      if (dueDayControl.value) {
        dueDayControl.setValue('', { emitEvent: false });
      }
      dueDayControl.updateValueAndValidity({ emitEvent: false });
      return;
    }

    dueDayControl.setValidators(recurringControl.value
      ? [Validators.required, Validators.min(1), Validators.max(31)]
      : [Validators.min(1), Validators.max(31)]);
    dueDayControl.updateValueAndValidity({ emitEvent: false });
  }

  shouldAllowRecurring(): boolean {
    return this.categoryMode() === 'sub' && this.categoryFormType() === 'EXPENSE';
  }

  private getRecurringDueDay(): number | null {
    if (!this.shouldAllowRecurring() || !this.categoryForm.controls.isRecurring.value) {
      return null;
    }

    const dueDay = this.parseNumber(this.categoryForm.controls.dueDayOfMonth.getRawValue());
    if (dueDay === null || dueDay < 1 || dueDay > 31) {
      return null;
    }

    return dueDay;
  }

  private getTodayDate(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private getSelectedAccountBalance(accountId: number): number {
    return this.ownAccounts().find((account) => account.id === accountId)?.balance ?? 0;
  }

  private syncIncomeExpenseSelection(): void {
    const mainOptions = this.mainCategoryOptions();
    if (mainOptions.length === 0) {
      this.transactionForm.patchValue({
        mainCategoryId: '',
        categoryId: ''
      }, { emitEvent: false });
      this.selectedMainCategoryId.set(null);
      this.selectedCategoryId.set(null);
      return;
    }

    const draft = this.draftService.value();
    const currentMainId = this.parseNumber(this.transactionForm.controls.mainCategoryId.getRawValue());
    const currentCategoryId = this.parseNumber(this.transactionForm.controls.categoryId.getRawValue());

    const selectedMainId = currentMainId !== null && mainOptions.some((category) => category.id === currentMainId)
      ? currentMainId
      : (draft.mainCategoryId !== null && mainOptions.some((category) => category.id === draft.mainCategoryId)
        ? draft.mainCategoryId
        : null);

    if (selectedMainId === null) {
      this.transactionForm.patchValue({
        mainCategoryId: '',
        categoryId: ''
      }, { emitEvent: false });
      this.selectedMainCategoryId.set(null);
      this.selectedCategoryId.set(null);
      return;
    }

    this.selectedMainCategoryId.set(selectedMainId);
    this.transactionForm.patchValue({ mainCategoryId: String(selectedMainId) }, { emitEvent: false });

    const subOptions = this.buildSubCategoryOptions(mainOptions.find((category) => category.id === selectedMainId) ?? null);
    const validCategoryId = currentCategoryId !== null && subOptions.some((category) => category.id === currentCategoryId)
      ? currentCategoryId
      : (draft.categoryId !== null && subOptions.some((category) => category.id === draft.categoryId)
        ? draft.categoryId
        : null);

    if (validCategoryId === null) {
      this.selectedCategoryId.set(null);
      this.transactionForm.patchValue({ categoryId: '' }, { emitEvent: false });
      return;
    }

    this.selectedCategoryId.set(validCategoryId);
    this.transactionForm.patchValue({ categoryId: String(validCategoryId) }, { emitEvent: false });
  }

  private ensureDefaultIncomeExpenseAccount(): void {
    if (this.transactionType() === 'TRANSFER') {
      return;
    }

    const currentAccountId = this.parseNumber(this.transactionForm.controls.accountId.getRawValue());
    if (currentAccountId !== null && this.ownAccounts().some((account) => account.id === currentAccountId)) {
      return;
    }

    const draft = this.draftService.value();
    const preferredAccount = this.ownAccounts().find((account) => account.id === draft.accountId)
      ?? this.ownAccounts().find((account) => account.type === 'MAIN')
      ?? this.ownAccounts()[0];

    if (preferredAccount) {
      this.transactionForm.patchValue({ accountId: String(preferredAccount.id) }, { emitEvent: false });
      this.persistDraft();
    }
  }

  private ensureDefaultTransferSelections(): void {
    const currentSourceAccountId = this.parseNumber(this.transactionForm.controls.transferFromAccountId.getRawValue());
    if (currentSourceAccountId !== null && this.ownAccounts().some((account) => account.id === currentSourceAccountId)) {
      this.selectedTransferFromAccountId.set(currentSourceAccountId);
    }

    const currentDestinationAccountId = this.parseNumber(this.transactionForm.controls.transferToAccountId.getRawValue());
    if (currentDestinationAccountId !== null && this.transferDestinationOptions().some((option) => option.accountId === currentDestinationAccountId)) {
      this.selectedTransferToAccountId.set(currentDestinationAccountId);
    }

    if (this.selectedTransferFromAccountId() === null) {
      this.ensureDefaultTransferSource();
    }

    if (this.selectedTransferToAccountId() === null) {
      this.ensureDefaultTransferDestination();
    }
  }

  private ensureDefaultTransferSource(): void {
    const draft = this.draftService.value();
    const ownAccounts = this.ownAccounts();

    const preferredAccount = ownAccounts.find((account) => account.id === draft.transferFromAccountId)
      ?? ownAccounts.find((account) => account.id === draft.accountId)
      ?? ownAccounts.find((account) => account.type === 'MAIN')
      ?? ownAccounts[0];

    if (preferredAccount) {
      this.transactionForm.patchValue({ transferFromAccountId: String(preferredAccount.id) }, { emitEvent: false });
      this.selectedTransferFromAccountId.set(preferredAccount.id);
    }
  }

  private ensureDefaultTransferDestination(): void {
    if (this.transactionType() !== 'TRANSFER') {
      return;
    }

    const sourceAccountId = this.selectedTransferFromAccountId();
    const destinationOptions = this.transferDestinationOptions();
    if (destinationOptions.length === 0) {
      this.selectedTransferToAccountId.set(null);
      return;
    }

    const draft = this.draftService.value();
    const preferredAccountId = draft.transferToAccountId ?? draft.toAccountId;
    const preferredOption = preferredAccountId !== null
      ? destinationOptions.find((option) => option.accountId === preferredAccountId && option.accountId !== sourceAccountId)
      : null;
    const fallbackOption = destinationOptions.find((option) => option.accountId !== sourceAccountId) ?? destinationOptions[0];
    const selectedOption = preferredOption ?? fallbackOption;

    if (selectedOption) {
      this.transactionForm.patchValue({ transferToAccountId: String(selectedOption.accountId) }, { emitEvent: false });
      this.selectedTransferToAccountId.set(selectedOption.accountId);
    }
  }

  private applyMainCategorySelection(mainCategoryId: number): void {
    const selectedMainCategory = this.mainCategoryOptions().find((category) => category.id === mainCategoryId) ?? null;
    if (!selectedMainCategory) {
      return;
    }

    const subOptions = this.buildSubCategoryOptions(selectedMainCategory);
    const currentCategoryId = this.parseNumber(this.transactionForm.controls.categoryId.getRawValue());
    const currentValidSubCategory = currentCategoryId !== null && subOptions.some((category) => category.id === currentCategoryId)
      ? currentCategoryId
      : null;

    this.selectedMainCategoryId.set(mainCategoryId);
    this.selectedCategoryId.set(currentValidSubCategory);
    this.transactionForm.patchValue({
      mainCategoryId: String(mainCategoryId),
      categoryId: currentValidSubCategory === null ? '' : String(currentValidSubCategory)
    }, { emitEvent: false });
    this.persistDraft();
  }

  private setSelectedCategory(mainCategoryId: number, categoryId: number, type: TransactionType): void {
    this.transactionType.set(type);
    this.categoryFormType.set(type === 'TRANSFER' ? 'EXPENSE' : type);
    this.selectedMainCategoryId.set(mainCategoryId);
    this.selectedCategoryId.set(categoryId);
    this.transactionForm.patchValue({
      type,
      mainCategoryId: String(mainCategoryId),
      categoryId: String(categoryId)
    }, { emitEvent: false });
  }

  private patchFromDraft(): void {
    const draft = this.draftService.value();
    this.transactionForm.patchValue({
      type: draft.type,
      accountId: draft.accountId === null ? '' : String(draft.accountId),
      transferFromAccountId: draft.transferFromAccountId === null ? '' : String(draft.transferFromAccountId),
      transferToAccountId: draft.transferToAccountId === null ? '' : String(draft.transferToAccountId),
      mainCategoryId: draft.mainCategoryId === null ? '' : String(draft.mainCategoryId),
      categoryId: draft.categoryId === null ? '' : String(draft.categoryId),
      transactionDate: draft.transactionDate,
      amount: draft.amount ?? '',
      comment: draft.comment ?? ''
    }, { emitEvent: false });
  }

  private persistDraft(): void {
    const value = this.transactionForm.getRawValue();
    const type = this.normalizeType(value.type);

    this.draftService.update({
      type,
      accountId: type === 'TRANSFER'
        ? this.parseNumber(value.transferFromAccountId) ?? this.parseNumber(value.accountId)
        : this.parseNumber(value.accountId),
      transferFromAccountId: this.parseNumber(value.transferFromAccountId),
      transferToAccountId: this.parseNumber(value.transferToAccountId),
      toAccountId: type === 'TRANSFER' ? this.parseNumber(value.transferToAccountId) : null,
      mainCategoryId: this.parseNumber(value.mainCategoryId),
      categoryId: this.parseNumber(value.categoryId),
      transactionDate: value.transactionDate,
      amount: value.amount ?? '',
      comment: value.comment ?? ''
    });
  }

  private parseNumber(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private normalizeType(value: string | TransactionType): TransactionType {
    if (value === 'INCOME' || value === 'EXPENSE' || value === 'TRANSFER') {
      return value;
    }

    return 'EXPENSE';
  }

  private getCategoriesForType(type: TransactionType): TransactionCategory[] {
    if (type === 'TRANSFER') {
      return [];
    }

    return this.categories().filter((category) => category.type === type);
  }

  private buildSubCategoryOptions(mainCategory: TransactionCategory | null): CategoryOption[] {
    if (!mainCategory) {
      return [];
    }

    const children = this.getCategoriesForType(mainCategory.type)
      .filter((category) => category.parentCategoryId === mainCategory.id)
      .sort((left, right) => left.name.localeCompare(right.name));

    if (children.length === 0) {
      return [{
        id: mainCategory.id,
        label: this.i18n.translate('transactions.noSubcategory'),
        type: mainCategory.type,
        parentCategoryId: mainCategory.id
      }];
    }

    return children.map((child) => ({
      id: child.id,
      label: child.name,
      type: child.type,
      parentCategoryId: child.parentCategoryId
    }));
  }

  private buildTransferDestinationOptions(): TransferDestinationOption[] {
    const sourceAccountId = this.selectedTransferFromAccountId();
    const ownAccountOptions = this.ownAccounts()
      .filter((account) => account.id !== sourceAccountId)
      .map((account) => ({
        accountId: account.id,
        value: String(account.id),
        label: account.name,
        groupKey: 'accounts.transferOwnAccounts' as const
      }));

    const otherUserOptions = this.selectableUsers()
      .filter((user) => user.id !== this.authService.getUserId())
      .filter((user) => typeof user.defaultMainAccountId === 'number' && user.defaultMainAccountId > 0)
      .map((user) => ({
        accountId: user.defaultMainAccountId as number,
        value: String(user.defaultMainAccountId),
        label: user.username,
        groupKey: 'accounts.transferOtherUsers' as const
      }));

    return [...ownAccountOptions, ...otherUserOptions];
  }

  private showSuccessMessage(message: string): void {
    this.successMessage.set(message);
    window.setTimeout(() => {
      this.successMessage.set('');
    }, 2500);
  }
}
