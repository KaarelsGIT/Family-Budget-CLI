import { CommonModule } from '@angular/common';
import {
  Component,
  HostListener,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { TranslationService } from '../../../../core/services/i18n/translation.service';
import { CategoryDropdownComponent } from '../../../categories/components/category-dropdown/category-dropdown.component';
import { CategoryEditorModalComponent } from '../../../categories/modals/category-editor-modal/category-editor-modal.component';
import { formatMoney, parseMoneyInput } from '../../../shared/utils/money-format';
import { CalculatorComponent } from '../../../shared/modals/calculator-modal/calculator.component';
import { Account } from '../../../accounts/models/account.model';
import { AccountService, SelectableUser } from '../../../accounts/services/account.service';
import {
  buildTransferTargetUsers,
  shouldShowMyAccountsSection,
  TransferTargetUser,
} from '../../../accounts/utils/transfer-targets';
import { TransactionCategory } from '../../models/transaction.model';
import { TransactionDraftService } from '../../services/transaction-draft.service';
import { TransactionsService } from '../../services/transactions.service';

type ModalView = 'transaction' | 'category';
type TransactionType = 'INCOME' | 'EXPENSE' | 'TRANSFER';
type CategoryEditorType = 'INCOME' | 'EXPENSE';
type CategoryGroup = 'FAMILY' | 'CHILD' | 'PARENT';
type TransferTargetKind = 'user' | 'account';

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

interface SelectedTransferTarget {
  kind: TransferTargetKind;
  id: number;
}

@Component({
  selector: 'app-add-transaction-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CalculatorComponent,
    CategoryEditorModalComponent,
    CategoryDropdownComponent,
  ],
  templateUrl: './add-transaction-modal.component.html',
  styleUrl: './add-transaction-modal.component.css',
})
export class AddTransactionModalComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly accountService = inject(AccountService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly draftService = inject(TransactionDraftService);
  private readonly authService = inject(AuthService);
  readonly i18n = inject(TranslationService);

  readonly categories = input<TransactionCategory[]>([]);
  readonly localNewCategories = signal<TransactionCategory[]>([]);
  readonly allAvailableCategories = computed(() => [
    ...this.categories(),
    ...this.localNewCategories(),
  ]);
  readonly closed = output<void>();
  readonly created = output<void>();
  readonly categoryCreated = output<TransactionCategory>();

  readonly accounts = signal<Account[]>([]);
  readonly transferTargets = signal<SelectableUser[]>([]);
  readonly expandedTransferTargetUserId = signal<number | null>(null);
  readonly isLoadingAccounts = signal(false);
  readonly isLoadingTransferTargets = signal(false);
  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');
  readonly isCategoryEditorOpen = signal(false);
  readonly isSubcategoryConfirmOpen = signal(false);
  readonly lastCreatedMainCategory = signal<TransactionCategory | null>(null);
  readonly categoryEditorMode = signal<'create-main' | 'create-sub'>('create-main');
  readonly categoryEditorParentCategory = signal<TransactionCategory | null>(null);
  readonly categoryEditorDefaultType = signal<CategoryEditorType>('EXPENSE');
  readonly categoryEditorDefaultGroup = signal<CategoryGroup>('FAMILY');
  readonly view = signal<ModalView>('transaction');
  readonly transactionType = signal<TransactionType>('EXPENSE');
  readonly categoryFormType = signal<TransactionType>('EXPENSE');

  readonly categoryGroupOptions = computed<CategoryGroupOption[]>(() => {
    const role = this.authService.getRole();
    const groups: CategoryGroup[] =
      role === 'ADMIN'
        ? ['FAMILY', 'CHILD', 'PARENT']
        : role === 'PARENT'
          ? ['FAMILY', 'PARENT']
          : ['CHILD'];

    return groups.map((value) => ({
      value,
      label:
        value === 'FAMILY'
          ? this.i18n.translate('categories.groupFamily')
          : value === 'CHILD'
            ? this.i18n.translate('categories.groupChild')
            : this.i18n.translate('categories.groupParent'),
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
    this.accounts().some(
      (account) => account.type === 'SAVINGS' && account.ownerId === this.authService.getUserId(),
    ),
  );

  selectCategory(mainId: number | null, subId: number | null): void {
    if (mainId === null) {
      this.transactionForm.patchValue({
        mainCategoryId: '',
        categoryId: '',
      });
      this.selectedMainCategoryId.set(null);
      this.selectedCategoryId.set(null);
    } else {
      this.transactionForm.patchValue({
        mainCategoryId: String(mainId),
        categoryId: subId ? String(subId) : String(mainId),
      });
      this.selectedMainCategoryId.set(mainId);
      this.selectedCategoryId.set(subId ?? mainId);
    }
    this.transactionForm.controls.mainCategoryId.markAsTouched();
    this.transactionForm.controls.categoryId.markAsTouched();
    this.persistDraft();
  }

  openCategoryEditorFromMenu(
    event: Event | null,
    mode: 'create-main' | 'create-sub',
    mainCat?: TransactionCategory,
  ): void {
    if (event) event.stopPropagation();
    if (mode === 'create-main') {
      this.openMainCategoryForm();
    } else if (mainCat) {
      this.categoryEditorMode.set('create-sub');
      this.categoryEditorParentCategory.set(mainCat);
      this.categoryEditorDefaultType.set(mainCat.type as CategoryEditorType);
      this.isCategoryEditorOpen.set(true);
    }
  }

  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragOriginX = 0;
  private dragOriginY = 0;

  readonly transactionTypeOptions = computed<TypeOption[]>(() => {
    const collator = new Intl.Collator(this.i18n.language(), { sensitivity: 'base' });
    return [
      { value: 'INCOME' as TransactionType, label: this.i18n.translate('transactions.typeIncome') },
      {
        value: 'EXPENSE' as TransactionType,
        label: this.i18n.translate('transactions.typeExpense'),
      },
      {
        value: 'TRANSFER' as TransactionType,
        label: this.i18n.translate('transactions.typeTransfer'),
      },
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
    multiplier: [1 as 1 | 2],
  });

  readonly mainCategoryOptions = computed(() =>
    this.allAvailableCategories()
      .filter(
        (category) =>
          category.type === this.transactionType() && category.parentCategoryId === null,
      )
      .sort((left, right) => left.name.localeCompare(right.name)),
  );

  readonly selectedMainCategory = computed(
    () =>
      this.mainCategoryOptions().find(
        (category) => category.id === this.selectedMainCategoryId(),
      ) ?? null,
  );

  readonly categoryAddLabel = computed(() => this.i18n.translate('transactions.addCategoryOption'));
  readonly mainCategoryPlaceholder = computed(() =>
    this.i18n.translate('transactions.selectCategory'),
  );
  readonly subCategoryPlaceholder = computed(() =>
    this.i18n.translate('transactions.selectSubCategory'),
  );

  readonly ownAccounts = computed(() => {
    const currentUserId = this.authService.getUserId();
    if (currentUserId === null) return [];

    return [...this.accounts()]
      .filter(
        (account) =>
          account.ownerId === currentUserId ||
          account.sharedUsers?.some(
            (sharedUser) => sharedUser.userId === currentUserId && sharedUser.role === 'EDITOR',
          ),
      )
      .sort((left, right) => {
        const typeOrder: Record<Account['type'], number> = {
          MAIN: 0,
          SUB_ACCOUNT: 1,
          SAVINGS: 2,
          CASH: 3,
        };
        if (left.type !== right.type) return typeOrder[left.type] - typeOrder[right.type];
        return left.name.localeCompare(right.name);
      });
  });

  readonly expenseAccounts = computed(() => {
    const currentUserId = this.authService.getUserId();
    if (currentUserId === null) return [];

    return [...this.accounts()]
      .filter(
        (account) =>
          account.ownerId === currentUserId ||
          account.sharedUsers?.some((sharedUser) => sharedUser.userId === currentUserId),
      )
      .sort((left, right) => {
        const typeOrder: Record<Account['type'], number> = {
          MAIN: 0,
          SUB_ACCOUNT: 1,
          SAVINGS: 2,
          CASH: 3,
        };
        if (left.type !== right.type) return typeOrder[left.type] - typeOrder[right.type];
        return left.name.localeCompare(right.name);
      });
  });

  readonly transferSourceAccounts = computed(() => this.ownAccounts());
  readonly transferTargetUsers = computed<TransferTargetUser[]>(() =>
    buildTransferTargetUsers(this.transferTargets(), this.accounts(), this.authService.getUserId()),
  );
  readonly hasTransferDestinationTargets = computed(() =>
    this.transferTargetUsers().some(
      (user) => !user.isCurrentUser || this.shouldShowMyAccountsSection(user),
    ),
  );
  readonly selectedTransferSourceAccount = computed(() => {
    const sourceAccountId = this.selectedTransferFromAccountId();
    if (sourceAccountId === null) return null;
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

    effect(
      () => {
        this.accounts();
        this.transferTargets();
        if (this.transactionType() === 'TRANSFER') {
          this.ensureDefaultTransferSelections();
        }
      },
      { allowSignalWrites: true },
    );
  }

  close(): void {
    this.isCalculatorVisible.set(false);
    this.isCategoryEditorOpen.set(false);
    this.closed.emit();
  }

  getModalTransform(): string {
    return `translate(${this.modalOffsetX()}px, ${this.modalOffsetY()}px)`;
  }

  startDrag(event: PointerEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target || target.closest('button') || target.closest('select') || target.closest('input'))
      return;
    if (event.button !== 0) return;

    this.dragging = true;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.dragOriginX = this.modalOffsetX();
    this.dragOriginY = this.modalOffsetY();
  }

  @HostListener('document:pointermove', ['$event'])
  onDocumentPointerMove(event: PointerEvent): void {
    if (!this.dragging) return;
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
    if (this.isCategoryEditorOpen() || this.isCalculatorVisible()) return;
    this.close();
  }

  openMainCategoryForm(): void {
    const fallbackType: CategoryEditorType =
      this.transactionType() === 'INCOME' ? 'INCOME' : 'EXPENSE';
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
    const fallbackType: CategoryEditorType =
      this.transactionType() === 'INCOME' ? 'INCOME' : 'EXPENSE';
    const selectedType: CategoryEditorType =
      selectedMainCategory?.type === 'INCOME' ? 'INCOME' : 'EXPENSE';

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
    if (
      parsedValue !== null &&
      selectedTarget?.kind === 'account' &&
      selectedTarget.id === parsedValue
    ) {
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
        kind:
          currentSelection?.id === parsedValue
            ? currentSelection.kind
            : this.resolveTransferTargetKind(parsedValue),
        id: parsedValue,
      });
    } else {
      this.selectedTransferTarget.set(null);
    }
    if (parsedValue !== null && this.isOwnTransferTarget(parsedValue)) {
      this.expandedTransferTargetUserId.set(this.authService.getUserId());
    }
    this.persistDraft();
  }

  submitTransaction(): void {
    if (this.isSubmitting() || this.transactionForm.invalid) {
      this.transactionForm.markAllAsTouched();
      this.errorMessage.set(this.i18n.translate('transactions.fillRequiredFields'));
      return;
    }

    if (this.transactionType() === 'TRANSFER') {
      const { transferFromAccountId, transferToAccountId, transactionDate, amount, comment } =
        this.transactionForm.getRawValue();
      const parsedAmount = parseMoneyInput(amount);
      const trimmedComment = (comment || '').trim();
      const parsedFromAccountId = this.parseNumber(transferFromAccountId);
      const parsedToAccountId = this.parseNumber(transferToAccountId);
      const selectedTarget = this.selectedTransferTarget();

      const selectedTargetKind =
        selectedTarget?.id === parsedToAccountId ||
        selectedTarget?.id === Math.abs(parsedToAccountId ?? 0)
          ? selectedTarget.kind
          : null;
      const targetUserId =
        selectedTargetKind === 'user' && parsedToAccountId !== null
          ? Math.abs(parsedToAccountId)
          : null;
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

      this.accountService
        .createTransfer({
          amount: parsedAmount,
          fromAccountId: parsedFromAccountId,
          targetUserId,
          toAccountId: targetAccountId,
          transactionDate,
          comment: trimmedComment,
          reminderId: null,
        })
        .pipe(finalize(() => this.isSubmitting.set(false)))
        .subscribe({
          next: () => {
            this.showSuccessMessage(this.i18n.translate('transaction.add.success'));
            this.transactionForm.patchValue(
              { amount: '', comment: '', reminderId: '' },
              { emitEvent: false },
            );
            this.loadAccounts();
            this.created.emit();
          },
          error: (error) =>
            this.errorMessage.set(this.resolveErrorMessage(error, 'accounts.transferFailed')),
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
      comment,
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

    const useMicroSavings =
      this.transactionType() === 'EXPENSE' &&
      this.savingsAccountAvailable() &&
      this.useMicroSavings();
    const multiplier = useMicroSavings ? this.microSavingsMultiplier() : null;

    this.transactionsService
      .createTransaction({
        amount: parsedAmount,
        type,
        accountId: selectedAccountId,
        categoryId: parsedCategoryId,
        transactionDate,
        comment: trimmedComment,
        reminderId: parsedReminderId,
        useMicroSavings,
        multiplier,
      })
      .pipe(finalize(() => this.isSubmitting.set(false)))
      .subscribe({
        next: (response) => {
          this.showSuccessMessage(this.buildSuccessMessage(response.microSavingsAmount));
          this.transactionForm.patchValue(
            { amount: null as unknown as string, comment: '', reminderId: '' },
            { emitEvent: false },
          );
          this.loadAccounts();
          this.created.emit();
        },
        error: (error) =>
          this.errorMessage.set(this.resolveErrorMessage(error, 'transactions.createFailed')),
      });
  }

  onCategoryEditorClosed(): void {
    this.isCategoryEditorOpen.set(false);
  }

  onCategoryEditorSaved(category: TransactionCategory): void {
    this.localNewCategories.update((cats) => [...cats, category]);
    this.categoryCreated.emit(category);
    this.isCategoryEditorOpen.set(false);

    const parentId = category.parentCategoryId ?? category.id;
    const subId = category.parentCategoryId ? category.id : null;

    setTimeout(() => {
      this.selectCategory(parentId, subId);
    }, 0);

    if (!category.parentCategoryId) {
      this.lastCreatedMainCategory.set(category);
      this.isSubcategoryConfirmOpen.set(true);
    }
  }

  confirmAddSubcategory(): void {
    const mainCategory = this.lastCreatedMainCategory();
    this.isSubcategoryConfirmOpen.set(false);
    if (mainCategory) this.openSubcategoryFormWithMain(mainCategory);
  }

  cancelAddSubcategory(): void {
    const mainCategory = this.lastCreatedMainCategory();
    this.isSubcategoryConfirmOpen.set(false);
    if (mainCategory) {
      this.transactionType.set(mainCategory.type);
      this.categoryFormType.set(mainCategory.type);
      this.selectedMainCategoryId.set(mainCategory.id);
      this.selectedCategoryId.set(null);
      this.transactionForm.patchValue(
        {
          type: mainCategory.type,
          mainCategoryId: String(mainCategory.id),
          categoryId: '',
        },
        { emitEvent: false },
      );
      this.syncTransactionControlsForType(mainCategory.type);
      this.ensureDefaultIncomeExpenseAccount();
    }
    this.lastCreatedMainCategory.set(null);
  }

  private openSubcategoryFormWithMain(mainCategory: TransactionCategory): void {
    this.categoryEditorMode.set('create-sub');
    this.categoryEditorParentCategory.set(mainCategory);
    this.categoryEditorDefaultType.set(mainCategory.type as CategoryEditorType);
    this.categoryEditorDefaultGroup.set(mainCategory.group as CategoryGroup);
    this.isCategoryEditorOpen.set(true);
  }

  getDefaultCategoryGroup(): CategoryGroup {
    const role = this.authService.getRole();
    if (role === 'ADMIN') return 'FAMILY';
    if (role === 'PARENT') return 'PARENT';
    return 'CHILD';
  }

  getModalTitle(): string {
    if (this.view() === 'category') return this.i18n.translate('transactions.addCategoryTitle');
    if (this.transactionType() === 'TRANSFER') return this.i18n.translate('accounts.transferTitle');
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

  trackByCategoryId(_index: number, item: { id: number }): number {
    return item.id;
  }
  trackByTransactionType(_index: number, option: TypeOption): TransactionType {
    return option.value;
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
    if (this.transactionType() !== 'EXPENSE') return true;
    const selectedAccountId = this.parseNumber(
      this.transactionForm.controls.accountId.getRawValue(),
    );
    const amount = parseMoneyInput(this.transactionForm.controls.amount.getRawValue());
    if (selectedAccountId === null || !Number.isFinite(amount) || amount <= 0) return true;
    return amount <= this.getSelectedAccountBalance(selectedAccountId);
  }

  isTransferAmountWithinBalance(): boolean {
    if (this.transactionType() !== 'TRANSFER') return true;
    const fromAccountId = this.parseNumber(
      this.transactionForm.controls.transferFromAccountId.getRawValue(),
    );
    const amount = parseMoneyInput(this.transactionForm.controls.amount.getRawValue());
    if (fromAccountId === null || !Number.isFinite(amount) || amount <= 0) return true;
    return amount <= this.getSelectedAccountBalance(fromAccountId);
  }

  private parseNumber(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isNaN(n) ? null : n;
  }

  private getSelectedAccountBalance(accountId: number): number {
    return this.accounts().find((a) => a.id === accountId)?.balance ?? 0;
  }
  private normalizeType(type: string): TransactionType {
    return type === 'INCOME' || type === 'TRANSFER' ? type : 'EXPENSE';
  }
  private resolveTransferTargetKind(id: number): TransferTargetKind {
    return id > 0 ? 'account' : 'user';
  }
  private isOwnTransferTarget(id: number): boolean {
    return this.accounts().some((a) => a.id === id && a.ownerId === this.authService.getUserId());
  }
  private showSuccessMessage(msg: string): void {
    this.successMessage.set(msg);
    setTimeout(() => this.successMessage.set(''), 5000);
  }

  private buildSuccessMessage(microSavings?: number): string {
    const base = this.i18n.translate('transaction.add.success');
    if (microSavings && microSavings > 0)
      return `${base} (${this.i18n.translate('transactions.microSavingsSaved')}: ${formatMoney(microSavings)})`;
    return base;
  }

  private resolveErrorMessage(
    err: any,
    fallbackKey: 'transactions.createFailed' | 'accounts.transferFailed'
  ): string {
    return err?.error?.message || this.i18n.translate(fallbackKey);
  }

  private restoreMicroSavingsPreference(): void {}
  private patchFromDraft(): void {}
  private initializeSignalsFromDraft(): void {}
  private setupSubscriptions(): void {}
  private setupOpenRequestEffect(): void {}
  private loadAccounts(): void {}
  private loadTransferTargets(): void {}
  private ensureDefaultIncomeExpenseAccount(): void {}
  private syncIncomeExpenseSelection(): void {}
  private ensureDefaultTransferSelections(): void {}
  private ensureDefaultTransferDestination(): void {}
  private syncTransactionControlsForType(type: TransactionType): void {}
  private persistDraft(): void {}
  private persistMicroSavingsPreference(): void {}
  getAccountLabel(a: Account): string {
    return a.name;
  }
  getTransferSourceOptionLabel(a: Account): string {
    return a.name;
  }
  getTransferTargetPlaceholder(): string {
    return '';
  }
  getTransferTargetAccountLabel(a: Account): string {
    return a.name;
  }
  normalizeMoneyInput(e: Event): void {}
}
