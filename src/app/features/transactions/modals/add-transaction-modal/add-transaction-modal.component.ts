import { CommonModule } from '@angular/common';
import { Component, HostListener, computed, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { TranslationService } from '../../../../core/services/i18n/translation.service';
import { CategoryEditorModalComponent } from '../../../categories/modals/category-editor-modal/category-editor-modal.component';
import { formatMoney, parseMoneyInput } from '../../../shared/utils/money-format';
import { CalculatorComponent } from '../../../shared/modals/calculator-modal/calculator.component';
import { Account } from '../../../accounts/models/account.model';
import { AccountService, SelectableUser } from '../../../accounts/services/account.service';
import { canTransactFromAccount } from '../../../accounts/utils/account-access';
import { buildTransferTargetUsers, shouldShowMyAccountsSection, TransferTargetUser } from '../../../accounts/utils/transfer-targets';
import { TransactionCategory, TransactionOpenRequest } from '../../models/transaction.model';
import { TransactionDraftService } from '../../services/transaction-draft.service';
import { TransactionsService } from '../../services/transactions.service';

type ModalView = 'transaction' | 'category';
type CategoryMode = 'main' | 'sub';
type TransactionType = 'INCOME' | 'EXPENSE' | 'TRANSFER';
type CategoryEditorType = 'INCOME' | 'EXPENSE';
type CategoryGroup = 'FAMILY' | 'CHILD' | 'PARENT';
type TransferTargetKind = 'user' | 'account';

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

interface CategoryGroupOption {
  value: CategoryGroup;
  label: string;
}

interface TransferDestinationOption {
  accountId: number;
  value: string;
  label: string;
  groupKey: 'accounts.transferOwnAccounts' | 'accounts.transferOtherUsers';
}

interface SelectedTransferTarget {
  kind: TransferTargetKind;
  id: number;
}

@Component({
  selector: 'app-add-transaction-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CalculatorComponent, CategoryEditorModalComponent],
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
  readonly transferTargets = signal<SelectableUser[]>([]);
  readonly expandedTransferTargetUserId = signal<number | null>(null);
  readonly addCategoryValue = ADD_CATEGORY_VALUE;
  readonly isLoadingAccounts = signal(false);
  readonly isLoadingTransferTargets = signal(false);
  readonly isSubmitting = signal(false);
  readonly isSubmittingCategory = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');
  readonly isCategoryEditorOpen = signal(false);
  readonly categoryEditorMode = signal<'create-main' | 'create-sub'>('create-main');
  readonly categoryEditorParentCategory = signal<TransactionCategory | null>(null);
  readonly categoryEditorDefaultType = signal<CategoryEditorType>('EXPENSE');
  readonly categoryEditorDefaultGroup = signal<CategoryGroup>('FAMILY');
  readonly view = signal<ModalView>('transaction');
  readonly transactionType = signal<TransactionType>('EXPENSE');
  readonly categoryFormType = signal<TransactionType>('EXPENSE');
  readonly categoryGroupOptions = computed<CategoryGroupOption[]>(() => {
    const role = this.authService.getRole();
    const groups: CategoryGroup[] = role === 'ADMIN'
      ? ['FAMILY', 'CHILD', 'PARENT']
      : role === 'PARENT'
        ? ['FAMILY', 'PARENT']
        : ['CHILD'];

    return groups.map((value) => ({
      value,
      label: value === 'FAMILY'
        ? this.i18n.translate('categories.groupFamily')
        : value === 'CHILD'
          ? this.i18n.translate('categories.groupChild')
          : this.i18n.translate('categories.groupParent')
    }));
  });
  readonly selectedMainCategoryId = signal<number | null>(null);
  readonly selectedCategoryId = signal<number | null>(null);
  readonly selectedTransferFromAccountId = signal<number | null>(null);
  readonly selectedTransferToAccountId = signal<number | null>(null);
  readonly selectedTransferTarget = signal<SelectedTransferTarget | null>(null);
  readonly useMicroSavings = signal(false);
  readonly microSavingsMultiplier = signal<1 | 2>(1);
  readonly modalOffsetX = signal(0);
  readonly modalOffsetY = signal(0);
  readonly isCalculatorVisible = signal(false);
  readonly savingsAccountAvailable = computed(() =>
    this.accounts().some((account) => account.type === 'SAVINGS' && account.ownerId === this.authService.getUserId())
  );

  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragOriginX = 0;
  private dragOriginY = 0;
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
    reminderId: [''],
    mainCategoryId: ['', Validators.required],
    categoryId: ['', Validators.required],
    transactionDate: ['', Validators.required],
    amount: ['', Validators.required],
    comment: ['', [Validators.maxLength(500)]],
    useMicroSavings: [false],
    multiplier: [1 as 1 | 2]
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
    const currentUserId = this.authService.getUserId();
    if (currentUserId === null) {
      return [];
    }

    const filteredAccounts = [...this.accounts()]
      .filter((account) =>
        account.ownerId === currentUserId ||
        account.sharedUsers?.some((sharedUser) => sharedUser.userId === currentUserId && sharedUser.role === 'EDITOR')
      )
      .sort((left, right) => {
        const typeOrder: Record<Account['type'], number> = {
          MAIN: 0,
          SUB_ACCOUNT: 1,
          SAVINGS: 2,
          CASH: 3
        };

        if (left.type !== right.type) {
          return typeOrder[left.type] - typeOrder[right.type];
        }

        return left.name.localeCompare(right.name);
      });
    return filteredAccounts;
  });

  readonly expenseAccounts = computed(() => {
    const currentUserId = this.authService.getUserId();
    if (currentUserId === null) {
      return [];
    }

    const expenseAccounts = [...this.accounts()]
      .filter((account) =>
        account.ownerId === currentUserId ||
        account.sharedUsers?.some((sharedUser) => sharedUser.userId === currentUserId)
      )
      .sort((left, right) => {
        const typeOrder: Record<Account['type'], number> = {
          MAIN: 0,
          SUB_ACCOUNT: 1,
          SAVINGS: 2,
          CASH: 3
        };

        if (left.type !== right.type) {
          return typeOrder[left.type] - typeOrder[right.type];
        }

        return left.name.localeCompare(right.name);
      });

    return expenseAccounts;
  });

  readonly transferSourceAccounts = computed(() => this.ownAccounts());
  readonly transferTargetUsers = computed<TransferTargetUser[]>(() =>
    buildTransferTargetUsers(this.transferTargets(), this.accounts(), this.authService.getUserId())
  );
  readonly hasTransferDestinationTargets = computed(() =>
    this.transferTargetUsers().some((user) => !user.isCurrentUser || this.shouldShowMyAccountsSection(user))
  );
  readonly selectedTransferSourceAccount = computed(() => {
    const sourceAccountId = this.selectedTransferFromAccountId();
    if (sourceAccountId === null) {
      return null;
    }

    return this.transferSourceAccounts().find((account) => account.id === sourceAccountId) ?? null;
  });

  constructor() {
    this.restoreMicroSavingsPreference();
    this.patchFromDraft();
    this.initializeSignalsFromDraft();
    this.setupSubscriptions();
    this.setupOpenRequestEffect();
    this.loadAccounts();
    this.loadTransferTargets();
    this.ensureDefaultIncomeExpenseAccount();
    effect(() => {
      this.categories();
      if (this.view() === 'transaction') {
        this.syncIncomeExpenseSelection();
        this.ensureDefaultIncomeExpenseAccount();
      }
    });
    effect(() => {
      this.accounts();
      this.transferTargets();
      if (this.transactionType() === 'TRANSFER') {
        this.ensureDefaultTransferSelections();
      }
    }, { allowSignalWrites: true });
  }

  close(): void {
    this.isCalculatorVisible.set(false);
    this.isCategoryEditorOpen.set(false);
    this.closed.emit();
  }

  startDrag(event: PointerEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target || target.closest('button')) {
      return;
    }

    if (event.button !== 0) {
      return;
    }

    this.dragging = true;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.dragOriginX = this.modalOffsetX();
    this.dragOriginY = this.modalOffsetY();
  }

  @HostListener('document:pointermove', ['$event'])
  onDocumentPointerMove(event: PointerEvent): void {
    if (!this.dragging) {
      return;
    }

    this.modalOffsetX.set(this.dragOriginX + (event.clientX - this.dragStartX));
    this.modalOffsetY.set(this.dragOriginY + (event.clientY - this.dragStartY));
  }

  @HostListener('document:pointerup')
  @HostListener('document:pointercancel')
  endDrag(): void {
    this.dragging = false;
  }

  openCalculator(): void {
    this.isCalculatorVisible.set(true);
  }

  closeCalculator(): void {
    this.isCalculatorVisible.set(false);
  }

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    if (this.isCategoryEditorOpen()) {
      return;
    }

    if (this.isCalculatorVisible()) {
      return;
    }

    this.close();
  }

  openMainCategoryForm(): void {
    const fallbackType: CategoryEditorType = this.transactionType() === 'INCOME' ? 'INCOME' : 'EXPENSE';
    this.categoryEditorMode.set('create-main');
    this.categoryEditorParentCategory.set(null);
    this.categoryEditorDefaultType.set(fallbackType);
    this.categoryEditorDefaultGroup.set(this.getDefaultCategoryGroup());
    this.isCategoryEditorOpen.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
  }

  openSubcategoryForm(): void {
    const selectedMainCategory = this.selectedMainCategory();
    const fallbackType: CategoryEditorType = this.transactionType() === 'INCOME' ? 'INCOME' : 'EXPENSE';
    const selectedType: CategoryEditorType = selectedMainCategory?.type === 'INCOME' ? 'INCOME' : 'EXPENSE';

    this.categoryEditorMode.set('create-sub');
    this.categoryEditorParentCategory.set(selectedMainCategory);
    this.categoryEditorDefaultType.set(selectedMainCategory ? selectedType : fallbackType);
    this.categoryEditorDefaultGroup.set(this.getDefaultCategoryGroup());
    this.isCategoryEditorOpen.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
  }

  onTransactionTypeChange(value: string): void {
    const normalizedType = this.normalizeType(value);
    this.transactionForm.patchValue({ type: normalizedType }, { emitEvent: false });
    this.transactionType.set(normalizedType);
    this.categoryFormType.set(normalizedType === 'TRANSFER' ? 'EXPENSE' : normalizedType);
    this.errorMessage.set('');
    this.syncTransactionControlsForType(normalizedType);

    if (normalizedType === 'TRANSFER') {
      this.ensureDefaultTransferSelections();
      this.persistDraft();
      return;
    }

    this.syncIncomeExpenseSelection();
    this.ensureDefaultIncomeExpenseAccount();
    this.persistDraft();
  }

  onMicroSavingsToggle(value: boolean): void {
    this.useMicroSavings.set(value);
    this.persistMicroSavingsPreference();
  }

  onMicroSavingsMultiplierChange(value: string): void {
    this.microSavingsMultiplier.set(value === '2' ? 2 : 1);
    this.persistMicroSavingsPreference();
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
    const parsedValue = this.parseNumber(value);
    this.selectedTransferFromAccountId.set(parsedValue);
    const selectedTarget = this.selectedTransferTarget();
    if (parsedValue !== null && selectedTarget?.kind === 'account' && selectedTarget.id === parsedValue) {
      this.selectedTransferTarget.set(null);
      this.selectedTransferToAccountId.set(null);
      this.transactionForm.patchValue({ transferToAccountId: '' }, { emitEvent: false });
    }
    this.ensureDefaultTransferDestination();
    this.persistDraft();
  }

  onTransferToAccountChange(value: string): void {
    this.errorMessage.set('');
    this.transactionForm.patchValue({ transferToAccountId: value }, { emitEvent: false });
    const parsedValue = this.parseNumber(value);
    this.selectedTransferToAccountId.set(parsedValue);
    if (parsedValue !== null) {
      const currentSelection = this.selectedTransferTarget();
      this.selectedTransferTarget.set({
        kind: currentSelection?.id === parsedValue ? currentSelection.kind : this.resolveTransferTargetKind(parsedValue),
        id: parsedValue
      });
    } else {
      this.selectedTransferTarget.set(null);
    }
    if (parsedValue !== null && this.isOwnTransferTarget(parsedValue)) {
      this.expandedTransferTargetUserId.set(this.authService.getUserId());
    }
    this.persistDraft();
  }

  backToTransactionForm(): void {
    this.view.set('transaction');
    this.errorMessage.set('');
  }

  submitTransaction(): void {
    if (this.isSubmitting() || this.transactionForm.invalid) {
      this.transactionForm.markAllAsTouched();
      this.errorMessage.set(this.i18n.translate('transactions.fillRequiredFields'));
      return;
    }

    if (this.transactionType() === 'TRANSFER') {
      const { transferFromAccountId, transferToAccountId, transactionDate, amount, comment } = this.transactionForm.getRawValue();
      const parsedAmount = parseMoneyInput(amount);
      const trimmedComment = (comment || '').trim();
      const parsedFromAccountId = this.parseNumber(transferFromAccountId);
      const parsedToAccountId = this.parseNumber(transferToAccountId);
      const selectedTarget = this.selectedTransferTarget();
      const selectedTargetKind = selectedTarget?.id === parsedToAccountId || selectedTarget?.id === Math.abs(parsedToAccountId ?? 0)
        ? selectedTarget.kind
        : null;
      const targetUserId = selectedTargetKind === 'user' && parsedToAccountId !== null ? Math.abs(parsedToAccountId) : null;
      const targetAccountId = selectedTargetKind === 'account' ? parsedToAccountId : null;

      if (
        parsedFromAccountId === null ||
        parsedToAccountId === null ||
        !transactionDate ||
        !Number.isFinite(parsedAmount) ||
        parsedAmount <= 0
      ) {
        this.errorMessage.set(this.i18n.translate('transactions.fillRequiredFields'));
        return;
      }

      if (parsedFromAccountId === parsedToAccountId) {
        this.errorMessage.set(this.i18n.translate('transactions.transferSameAccount'));
        return;
      }

      if (parsedAmount > this.getSelectedAccountBalance(parsedFromAccountId)) {
        this.errorMessage.set(this.i18n.translate('transactions.balanceWouldGoNegative'));
        return;
      }

      this.errorMessage.set('');
      this.isSubmitting.set(true);

      this.accountService.createTransfer({
        amount: parsedAmount,
        fromAccountId: parsedFromAccountId,
        targetUserId,
        toAccountId: targetAccountId,
        transactionDate,
        comment: trimmedComment,
        reminderId: null
      }).pipe(
        finalize(() => this.isSubmitting.set(false))
      ).subscribe({
        next: () => {
          this.showSuccessMessage(this.i18n.translate('transaction.add.success'));
          this.draftService.update({
            type: 'TRANSFER',
            accountId: parsedFromAccountId,
            transferFromAccountId: parsedFromAccountId,
            transferToAccountId: parsedToAccountId,
            transactionDate,
            amount: String(parsedAmount),
            comment: trimmedComment
          });
          this.draftService.clearTransientFields();
          this.transactionForm.patchValue({
            amount: '',
            comment: '',
            reminderId: ''
          }, { emitEvent: false });
          this.loadAccounts();
          this.created.emit();
        },
        error: (error: { error?: { message?: string } }) => {
          this.errorMessage.set(this.resolveErrorMessage(error, 'accounts.transferFailed'));
        }
      });
      return;
    }

    const {
      type,
      accountId,
      mainCategoryId,
      categoryId,
      reminderId,
      transactionDate,
      amount,
      comment
    } = this.transactionForm.getRawValue();
    const parsedAmount = parseMoneyInput(amount);
    const trimmedComment = (comment || '').trim();
    const parsedReminderId = this.parseNumber(reminderId);

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

    const useMicroSavings = this.transactionType() === 'EXPENSE' && this.savingsAccountAvailable() && this.useMicroSavings();
    const multiplier = useMicroSavings ? this.microSavingsMultiplier() : null;

    const createTransaction = () => this.transactionsService.createTransaction({
      amount: parsedAmount,
      type,
      accountId: selectedAccountId,
      categoryId: parsedCategoryId,
      transactionDate,
      comment: trimmedComment,
      reminderId: parsedReminderId,
      useMicroSavings,
      multiplier
    });

    createTransaction().pipe(
      finalize(() => this.isSubmitting.set(false))
    ).subscribe({
      next: (response) => {
        this.showSuccessMessage(this.buildSuccessMessage(response.microSavingsAmount));
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
          comment: '',
          reminderId: ''
        }, { emitEvent: false });
        this.loadAccounts();
        this.created.emit();
      },
      error: (error: { error?: { message?: string } }) => {
        this.errorMessage.set(this.resolveErrorMessage(error, 'transactions.createFailed'));
      }
    });
  }

  onCategoryEditorClosed(): void {
    this.isCategoryEditorOpen.set(false);
  }

  onCategoryEditorSaved(category: TransactionCategory): void {
    const mode = this.categoryEditorMode();
    const parentCategory = this.categoryEditorParentCategory();
    this.isCategoryEditorOpen.set(false);

    if (mode === 'create-main') {
      this.transactionType.set(category.type);
      this.categoryFormType.set(category.type);
      this.selectedMainCategoryId.set(category.id);
      this.selectedCategoryId.set(null);
      this.transactionForm.patchValue({
        type: category.type,
        mainCategoryId: String(category.id),
        categoryId: ''
      }, { emitEvent: false });
      this.syncTransactionControlsForType(category.type);
      this.draftService.update({
        type: category.type,
        mainCategoryId: category.id,
        categoryId: null
      });
      this.ensureDefaultIncomeExpenseAccount();
      this.categoryCreated.emit(category);
      return;
    }

    const parentCategoryId = parentCategory?.id ?? null;
    this.setSelectedCategory(parentCategoryId ?? category.id, category.id, category.type);
    this.draftService.update({
      type: this.transactionType(),
      mainCategoryId: parentCategoryId,
      categoryId: category.id
    });
    this.ensureDefaultIncomeExpenseAccount();
    this.categoryCreated.emit(category);
  }

  getDefaultCategoryGroup(): CategoryGroup {
    const role = this.authService.getRole();
    if (role === 'ADMIN') {
      return 'FAMILY';
    }
    if (role === 'PARENT') {
      return 'PARENT';
    }
    return 'CHILD';
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

  trackByTransferUser(_index: number, user: SelectableUser): number {
    return user.id;
  }

  shouldShowMyAccountsSection(user: TransferTargetUser): boolean {
    return shouldShowMyAccountsSection(user, this.accounts(), this.authService.getUserId());
  }

  trackByAccountId(_index: number, account: Account): number {
    return account.id;
  }

  isExpenseAmountWithinBalance(): boolean {
    if (this.transactionType() !== 'EXPENSE') {
      return true;
    }

    const selectedAccountId = this.parseNumber(this.transactionForm.controls.accountId.getRawValue());
    const amount = parseMoneyInput(this.transactionForm.controls.amount.getRawValue());
    if (selectedAccountId === null || !Number.isFinite(amount) || amount <= 0) {
      return true;
    }

    return amount <= this.getSelectedAccountBalance(selectedAccountId);
  }

  isTransferAmountWithinBalance(): boolean {
    if (this.transactionType() !== 'TRANSFER') {
      return true;
    }

    const selectedAccountId = this.parseNumber(this.transactionForm.controls.transferFromAccountId.getRawValue());
    const amount = parseMoneyInput(this.transactionForm.controls.amount.getRawValue());
    if (selectedAccountId === null || !Number.isFinite(amount) || amount <= 0) {
      return true;
    }

    return amount <= this.getSelectedAccountBalance(selectedAccountId);
  }

  getAccountLabel(account: Account): string {
    return `${account.name} · ${account.ownerUsername}`;
  }

  getTransferAccountDetails(account: Account): string {
    return `${account.ownerUsername} · ${formatMoney(account.balance)}`;
  }

  getTransferSourceOptionLabel(account: Account): string {
    return `${account.name} · ${account.ownerUsername} · ${formatMoney(account.balance)}`;
  }

  getTransferTargetGroupLabel(user: TransferTargetUser): string {
    return user.isCurrentUser
      ? this.i18n.translate('accounts.myAccounts')
      : this.i18n.translate('accounts.otherUsers');
  }

  getTransferTargetAccountLabel(account: Account): string {
    return `${account.name} · ${account.ownerUsername} · ${formatMoney(account.balance)}`;
  }

  getTransferTargetPlaceholder(): string {
    switch (this.i18n.language()) {
      case 'et':
        return 'Vali kasutaja või konto';
      case 'fi':
        return 'Valitse käyttäjä tai tili';
      default:
        return 'Select user or account';
    }
  }

  normalizeMoneyInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (!input) {
      return;
    }

    const normalized = input.value.replace(/,/g, '.');
    if (input.value !== normalized) {
      input.value = normalized;
    }
  }

  isTransferSourceSelected(account: Account): boolean {
    return this.selectedTransferFromAccountId() === account.id;
  }

  isTargetSelected(id: number, kind: TransferTargetKind): boolean {
    const selected = this.selectedTransferTarget();
    return selected?.kind === kind && selected.id === id;
  }

  isExpandedTransferTarget(user: TransferTargetUser): boolean {
    return this.expandedTransferTargetUserId() === user.id;
  }

  toggleTransferTargetExpansion(user: TransferTargetUser): void {
    if (!user.isCurrentUser || !this.shouldShowMyAccountsSection(user)) {
      return;
    }

    this.expandedTransferTargetUserId.set(this.isExpandedTransferTarget(user) ? null : user.id);
  }

  selectTransferTarget(value: number, kind: TransferTargetKind): void {
    this.selectedTransferTarget.set({ kind, id: value });
    this.selectedTransferToAccountId.set(value);
    this.transactionForm.patchValue({ transferToAccountId: String(value) }, { emitEvent: false });
    this.persistDraft();
  }

  private resolveErrorMessage(
    error: { error?: { message?: string } },
    fallbackKey: 'transactions.createFailed' | 'accounts.transferFailed'
  ): string {
    const message = error.error?.message;
    if (
      message === 'Kontol ei ole piisavalt raha' ||
      message === 'Saldo ei tohi minna alla nulli!'
    ) {
      return this.i18n.translate('transactions.balanceWouldGoNegative');
    }

    if (message === 'Transfer accounts must differ') {
      return this.i18n.translate('transactions.transferSameAccount');
    }

    return message || this.i18n.translate(fallbackKey);
  }

  getModalTransform(): string {
    return `translate3d(${this.modalOffsetX()}px, ${this.modalOffsetY()}px, 0)`;
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
  }

  private loadAccounts(): void {
    this.isLoadingAccounts.set(true);

    this.accountService.getAccounts()
      .pipe(finalize(() => this.isLoadingAccounts.set(false)))
      .subscribe({
        next: (accounts) => {
          this.accounts.set(accounts);

          // Kontrollime, kas vorm on tühi (st tehing on just tehtud)
          // või on see modali esmakordne avamine.
          const amountValue = this.transactionForm.controls.amount.value;
          const isInitialLoad = !amountValue || amountValue === '';

          // Algseadistusi teeme AINULT siis, kui vorm on tühi/algseisus.
          // Kui kasutaja on juba midagi valinud, siis me ei vii teda "vaikimisi" kontole tagasi.
          if (isInitialLoad) {
            if (this.transactionType() === 'TRANSFER') {
              this.ensureDefaultTransferSelections();
            } else {
              this.syncIncomeExpenseSelection();
              this.ensureDefaultIncomeExpenseAccount();
            }
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

  private loadTransferTargets(): void {
    this.isLoadingTransferTargets.set(true);

    this.accountService.getTransferTargets()
      .pipe(finalize(() => this.isLoadingTransferTargets.set(false)))
      .subscribe({
        next: (targets) => {
          this.transferTargets.set(targets.users);
          this.ensureDefaultTransferSelections();
        },
        error: () => {
          this.transferTargets.set([]);
          this.ensureDefaultTransferSelections();
        }
      });
  }

  private applyOpenRequest(request: TransactionOpenRequest): boolean {
    if (request.categoryId === null || request.categoryId === undefined) {
      const resolvedType = this.normalizeType(request.type ?? this.transactionType());
      this.view.set('transaction');
      this.errorMessage.set('');
      this.successMessage.set('');

      this.transactionType.set(resolvedType);
      this.categoryFormType.set(resolvedType === 'TRANSFER' ? 'EXPENSE' : resolvedType);
      this.syncTransactionControlsForType(resolvedType);

      if (resolvedType === 'TRANSFER') {
        const preselectedFromAccount = request.preselectedFromAccount ?? request.accountId ?? null;
        if (preselectedFromAccount !== null) {
          this.transactionForm.patchValue({
            transferFromAccountId: String(preselectedFromAccount)
          }, { emitEvent: false });
          this.selectedTransferFromAccountId.set(preselectedFromAccount);
        }
        this.ensureDefaultTransferSelections();
      } else {
        const preselectedAccount = request.preselectedFromAccount ?? request.accountId ?? null;
        if (preselectedAccount !== null) {
          this.transactionForm.patchValue({
            accountId: String(preselectedAccount)
          }, { emitEvent: false });
        }
        this.ensureDefaultIncomeExpenseAccount();
      }

      this.persistDraft();
      return true;
    }

    const category = this.categories().find((item) => item.id === request.categoryId);
    if (!category) {
      return false;
    }

    const mainCategory = category.parentCategoryId !== null
      ? this.categories().find((item) => item.id === category.parentCategoryId) ?? null
      : category;

    const resolvedType = this.normalizeType(request.type ?? category.type);

    this.view.set('transaction');
    this.errorMessage.set('');
    this.successMessage.set('');

    this.transactionType.set(resolvedType);
    this.categoryFormType.set(resolvedType === 'TRANSFER' ? 'EXPENSE' : resolvedType);

    this.transactionForm.patchValue({
      type: resolvedType,
      accountId: request.accountId === null || request.accountId === undefined ? '' : String(request.accountId),
      transferFromAccountId: '',
      transferToAccountId: '',
      reminderId: request.reminderId === null || request.reminderId === undefined ? '' : String(request.reminderId),
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
    this.selectedTransferTarget.set(null);

    this.syncTransactionControlsForType(resolvedType);
    this.ensureDefaultIncomeExpenseAccount();
    this.persistDraft();
    return true;
  }

  private getTodayDate(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private getSelectedAccountBalance(accountId: number): number {
    return this.expenseAccounts().find((account) => account.id === accountId)?.balance ?? 0;
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
    if (currentAccountId !== null && this.expenseAccounts().some((account) => account.id === currentAccountId)) {
      return;
    }

    const draft = this.draftService.value();
    const preferredAccount = this.expenseAccounts().find((account) => account.id === draft.accountId)
      ?? this.expenseAccounts().find((account) => account.type === 'MAIN')
      ?? this.expenseAccounts()[0];

    if (preferredAccount) {
      this.transactionForm.patchValue({ accountId: String(preferredAccount.id) }, { emitEvent: false });
      this.persistDraft();
    }
  }

  private ensureDefaultTransferSelections(): void {
    if (this.transactionType() !== 'TRANSFER') {
      return;
    }

    if (this.transferSourceAccounts().length === 0 || this.transferTargetUsers().length === 0) {
      return;
    }

    const currentSourceAccountId = this.parseNumber(this.transactionForm.controls.transferFromAccountId.getRawValue());
    if (currentSourceAccountId !== null && this.transferSourceAccounts().some((account) => account.id === currentSourceAccountId)) {
      this.selectedTransferFromAccountId.set(currentSourceAccountId);
    }

    const currentDestinationAccountId = this.parseNumber(this.transactionForm.controls.transferToAccountId.getRawValue());
    if (currentDestinationAccountId !== null &&
      this.isValidTransferTargetValue(currentDestinationAccountId) &&
      currentDestinationAccountId !== currentSourceAccountId) {
      this.selectedTransferToAccountId.set(currentDestinationAccountId);
    } else if (currentDestinationAccountId !== null && currentDestinationAccountId === currentSourceAccountId) {
      this.ensureDefaultTransferDestination();
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
    const ownAccounts = this.transferSourceAccounts();

    const preferredAccount = ownAccounts.find((account) => account.id === draft.transferFromAccountId)
      ?? ownAccounts.find((account) => account.id === draft.accountId)
      ?? ownAccounts.find((account) => account.type === 'MAIN')
      ?? ownAccounts[0];

    if (preferredAccount) {
      this.transactionForm.patchValue({ transferFromAccountId: String(preferredAccount.id) }, { emitEvent: false });
      this.selectedTransferFromAccountId.set(preferredAccount.id);
      this.persistDraft();
    }
  }

  private ensureDefaultTransferDestination(): void {
    if (this.transactionType() !== 'TRANSFER') {
      return;
    }

    const destinationUsers = this.transferTargetUsers();
    if (destinationUsers.length === 0) {
      this.selectedTransferToAccountId.set(null);
      return;
    }

    const draft = this.draftService.value();
    const preferredAccountId = draft.transferToAccountId ?? draft.toAccountId;
    const preferredSelection = preferredAccountId !== null &&
      this.isValidTransferTargetValue(preferredAccountId) &&
      preferredAccountId !== this.selectedTransferSourceAccount()?.id
      ? preferredAccountId
      : null;

    if (preferredSelection !== null) {
      this.transactionForm.patchValue({ transferToAccountId: String(preferredSelection) }, { emitEvent: false });
      this.selectedTransferToAccountId.set(preferredSelection);
      this.selectedTransferTarget.set({ kind: this.resolveTransferTargetKind(preferredSelection), id: preferredSelection });
      this.persistDraft();
      return;
    }

    this.transactionForm.patchValue({ transferToAccountId: '' }, { emitEvent: false });
    this.selectedTransferToAccountId.set(null);
    this.selectedTransferTarget.set(null);
  }

  private syncTransactionControlsForType(type: TransactionType): void {
    const isTransfer = type === 'TRANSFER';

    const expenseControls: Array<'accountId' | 'mainCategoryId' | 'categoryId'> = ['accountId', 'mainCategoryId', 'categoryId'];
    const transferControls: Array<'transferFromAccountId' | 'transferToAccountId'> = ['transferFromAccountId', 'transferToAccountId'];

    for (const controlName of expenseControls) {
      const control = this.transactionForm.controls[controlName];
      if (isTransfer) {
        control.disable({ emitEvent: false });
      } else {
        control.enable({ emitEvent: false });
      }
    }

    for (const controlName of transferControls) {
      const control = this.transactionForm.controls[controlName];
      if (isTransfer) {
        control.enable({ emitEvent: false });
      } else {
        control.disable({ emitEvent: false });
      }
    }

    this.transactionForm.controls.transactionDate.enable({ emitEvent: false });
    this.transactionForm.controls.amount.enable({ emitEvent: false });
    this.transactionForm.controls.comment.enable({ emitEvent: false });
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
    this.syncTransactionControlsForType(type);
  }

  private patchFromDraft(): void {
    const draft = this.draftService.value();
    this.transactionForm.patchValue({
      type: draft.type,
      accountId: draft.accountId === null ? '' : String(draft.accountId),
      transferFromAccountId: draft.transferFromAccountId === null ? '' : String(draft.transferFromAccountId),
      transferToAccountId: draft.transferToAccountId === null ? '' : String(draft.transferToAccountId),
      reminderId: '',
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

  private canUseAccount(account: Account): boolean {
    return canTransactFromAccount(account, this.authService.getUserId(), this.authService.getRole());
  }

  private showSuccessMessage(message: string): void {
    this.successMessage.set(message);
    window.setTimeout(() => {
      this.successMessage.set('');
    }, 2500);
  }

  private buildSuccessMessage(savingsAmount: number): string {
    if (savingsAmount <= 0) {
      return this.i18n.translate('transaction.add.success');
    }

    const formattedSavings = formatMoney(savingsAmount);
    if (this.i18n.language() === 'et') {
      return `Kulu lisatud! Mikrokogumisega säästeti lisaks ${formattedSavings} €.`;
    }

    return `Expense added! You saved an extra ${formattedSavings} € via micro-savings.`;
  }

  private restoreMicroSavingsPreference(): void {
    this.microSavingsMultiplier.set(this.getStoredMicroSavingsMultiplier());
    this.useMicroSavings.set(this.getStoredMicroSavingsEnabled());
  }

  private getStoredMicroSavingsMultiplier(): 1 | 2 {
    return localStorage.getItem(this.getMicroSavingsStorageKey()) === '2' ? 2 : 1;
  }

  private persistMicroSavingsPreference(): void {
    localStorage.setItem(this.getMicroSavingsEnabledStorageKey(), String(this.useMicroSavings()));
    localStorage.setItem(this.getMicroSavingsStorageKey(), String(this.microSavingsMultiplier()));
  }

  private getMicroSavingsStorageKey(): string {
    const userId = this.authService.getUserId() ?? 'anonymous';
    return `family_budget_micro_savings_multiplier_${userId}`;
  }

  private getMicroSavingsEnabledStorageKey(): string {
    const userId = this.authService.getUserId() ?? 'anonymous';
    return `family_budget_micro_savings_enabled_${userId}`;
  }

  private getStoredMicroSavingsEnabled(): boolean {
    return localStorage.getItem(this.getMicroSavingsEnabledStorageKey()) === 'true';
  }

  private isValidTransferTargetValue(value: number): boolean {
    if (value < 0) {
      return this.transferTargetUsers().some((user) => !user.isCurrentUser && user.id === Math.abs(value));
    }

    if (this.isOwnTransferTarget(value)) {
      return true;
    }

    return this.transferTargetUsers().some((user) => !user.isCurrentUser && user.id === value);
  }

  private isOwnTransferTarget(value: number | null): boolean {
    if (value === null) {
      return false;
    }

    return this.transferTargetUsers().some((user) => user.isCurrentUser && user.accounts.some((account) => account.id === value));
  }

  private resolveTransferTargetKind(value: number): TransferTargetKind {
    if (value < 0) {
      return 'user';
    }

    const currentUserTarget = this.transferTargetUsers().find((user) => user.isCurrentUser) ?? null;
    if (currentUserTarget?.accounts.some((account) => account.id === value)) {
      return 'account';
    }

    return 'user';
  }

  private findFallbackTransferTargetValue(users: TransferTargetUser[]): number | null {
    const currentUserTarget = users.find((user) => user.isCurrentUser);
    const showMyAccounts = currentUserTarget !== undefined && this.shouldShowMyAccountsSection(currentUserTarget);
    const sourceAccountId = this.selectedTransferSourceAccount()?.id ?? null;

    if (!showMyAccounts) {
      return users.find((user) => !user.isCurrentUser)?.id ?? null;
    }

    if (currentUserTarget?.accounts.length) {
      const preferredOwnAccount = currentUserTarget.accounts.find((account) => account.id !== sourceAccountId) ?? null;
      if (preferredOwnAccount) {
        return preferredOwnAccount.id;
      }
    }

    return users.find((user) => !user.isCurrentUser)?.id ?? null;
  }
}
