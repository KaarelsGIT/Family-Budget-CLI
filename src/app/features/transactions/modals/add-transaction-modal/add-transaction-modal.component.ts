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
import { finalize, forkJoin } from 'rxjs';
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
import { CreateTransactionPayload, TransactionItem } from '../../models/transaction.model';
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

interface TransactionPayload {
  amount: number;
  type: TransactionType;
  accountId: number;
  categoryId: number | null;
  transactionDate: string;
  comment: string;
  reminderId: number | null;
  useMicroSavings: boolean;
  multiplier: 1 | 2 | null;
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
  readonly formatMoney = formatMoney;

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
  readonly isDuplicateConfirmOpen = signal(false);
  readonly duplicateMatches = signal<TransactionItem[]>([]);
  readonly pendingTransactionPayload = signal<TransactionPayload | null>(null);
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

  readonly expenseAccounts = computed(() => this.ownAccounts());

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
    this.ensureDefaultIncomeExpenseAccount();

    effect(() => {
      this.categories();
      if (this.view() === 'transaction' && this.transactionType() !== 'TRANSFER') {
        this.syncIncomeExpenseSelection();
        this.ensureDefaultIncomeExpenseAccount();
      }
    });

    effect(
      () => {
        this.accounts();
        this.transferTargets();
      },
    );

    effect(
      () => {
        if (this.transactionType() === 'TRANSFER') {
          this.ensureDefaultTransferDestination();
        }
      },
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

  @HostListener('document:keydown', ['$event'])
  handleTabShortcut(event: KeyboardEvent): void {
    if (!event.altKey || event.metaKey || event.ctrlKey) return;

    const key = event.key;
    if (key === '1') {
      event.preventDefault();
      this.setTransactionType('EXPENSE');
      return;
    }
    if (key === '2') {
      event.preventDefault();
      this.setTransactionType('INCOME');
      return;
    }
    if (key === '3') {
      event.preventDefault();
      this.setTransactionType('TRANSFER');
    }
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
    this.setTransactionType(value);
  }

  setTransactionType(value: string): void {
    const normalizedType = this.normalizeType(value);
    this.transactionForm.patchValue({ type: normalizedType }, { emitEvent: false });
    this.transactionType.set(normalizedType);
    this.categoryFormType.set(normalizedType === 'TRANSFER' ? 'EXPENSE' : normalizedType);
    this.updateValidatorsForType(normalizedType);
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
          : parsedToAccountId !== null && parsedToAccountId < 0
            ? 'user'
            : parsedToAccountId !== null
              ? 'account'
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

    const useMicroSavings =
      this.transactionType() === 'EXPENSE' &&
      this.savingsAccountAvailable() &&
      this.useMicroSavings();
    const multiplier = useMicroSavings ? this.microSavingsMultiplier() : null;

    const payload = {
      amount: parsedAmount,
      type,
      accountId: selectedAccountId,
      categoryId: parsedCategoryId,
      transactionDate,
      comment: trimmedComment,
      reminderId: parsedReminderId,
      useMicroSavings,
      multiplier,
    };

    this.isSubmitting.set(true);
    this.transactionsService
      .checkTransactionDuplicate(payload)
      .pipe(finalize(() => this.isSubmitting.set(false)))
      .subscribe({
        next: (duplicateResult) => {
          if (duplicateResult.duplicate) {
            this.duplicateMatches.set(duplicateResult.matches);
            this.pendingTransactionPayload.set(payload);
            this.isDuplicateConfirmOpen.set(true);
            return;
          }

          this.createTransaction(payload);
        },
        error: (error) =>
          this.errorMessage.set(this.resolveErrorMessage(error, 'transactions.createFailed')),
      });
  }

  onCategoryEditorClosed(): void {
    this.isCategoryEditorOpen.set(false);
  }

  onCategoryEditorSaved(category: TransactionCategory): void {
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

  confirmDuplicateTransaction(): void {
    const payload = this.pendingTransactionPayload();
    this.isDuplicateConfirmOpen.set(false);
    this.duplicateMatches.set([]);
    this.pendingTransactionPayload.set(null);
    if (payload) {
      this.createTransaction(payload);
    }
  }

  cancelDuplicateTransaction(): void {
    this.isDuplicateConfirmOpen.set(false);
    this.duplicateMatches.set([]);
    this.pendingTransactionPayload.set(null);
    this.errorMessage.set('');
  }

  formatTransactionDate(value: string | null | undefined): string {
    if (!value) return '—';

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat(this.i18n.language(), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(parsed);
  }

  getDuplicateAmountLabel(match: TransactionItem | null | undefined): string {
    if (!match) return '—';

    const isExpense = match.type === 'EXPENSE' || match.amount < 0;
    const prefix = isExpense ? '- ' : '+ ';
    return `${prefix}${formatMoney(Math.abs(match.amount))}`;
  }

  private buildTransactionPayload(): CreateTransactionPayload {
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
    const parsedCategoryId = this.parseNumber(categoryId);
    const selectedAccountId = this.parseNumber(accountId);
    const useMicroSavings =
      this.transactionType() === 'EXPENSE' &&
      this.savingsAccountAvailable() &&
      this.useMicroSavings();
    const multiplier = useMicroSavings ? this.microSavingsMultiplier() : null;

    if (selectedAccountId === null) {
      throw new Error('Account id is required');
    }

    return {
      amount: parsedAmount,
      type,
      accountId: selectedAccountId,
      categoryId: parsedCategoryId,
      transactionDate,
      comment: trimmedComment,
      reminderId: parsedReminderId,
      useMicroSavings,
      multiplier,
    };
  }

  private createTransaction(payload: CreateTransactionPayload): void {
    this.isSubmitting.set(true);
    this.transactionsService
      .createTransaction(payload)
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

  private getCurrentUserOwnAccounts(): Account[] {
    return this.ownAccounts();
  }

  private getDefaultOwnMainAccount(): Account | null {
    const currentUserId = this.authService.getUserId();
    if (currentUserId === null) return null;

    return (
      this.getCurrentUserOwnAccounts().find(
        (account) => account.type === 'MAIN' && account.ownerId === currentUserId,
      ) ?? this.getCurrentUserOwnAccounts().find((account) => account.type === 'MAIN') ?? null
    );
  }

  private getDefaultTransferFromAccount(): Account | null {
    const preselected = this.parseNumber(this.transactionForm.controls.transferFromAccountId.getRawValue());
    if (preselected !== null) {
      return this.getCurrentUserOwnAccounts().find((account) => account.id === preselected) ?? null;
    }

    return this.getDefaultOwnMainAccount() ?? this.getCurrentUserOwnAccounts()[0] ?? null;
  }

  private formatAccountBalance(account: Account): string {
    return formatMoney(account.balance);
  }

  private formatAccountDisplay(account: Account): string {
    return `${account.name} · ${this.formatAccountBalance(account)}`;
  }

  private formatTransferTargetAccountLabel(account: Account): string {
    return this.formatAccountDisplay(account);
  }

  private restoreMicroSavingsPreference(): void {
    const saved = window.localStorage.getItem('transactionMicroSavingsPreference');
    if (!saved) return;

    try {
      const parsed = JSON.parse(saved) as { enabled?: boolean; multiplier?: 1 | 2 } | null;
      if (!parsed) return;

      this.useMicroSavings.set(!!parsed.enabled);
      this.microSavingsMultiplier.set(parsed.multiplier === 2 ? 2 : 1);
    } catch {
      // Ignore malformed preference payloads.
    }
  }

  private patchFromDraft(): void {
    const draft = this.draftService.value();
    this.transactionForm.patchValue(
      {
        type: draft.type,
        accountId: draft.accountId === null ? '' : String(draft.accountId),
        transferFromAccountId:
          draft.transferFromAccountId === null ? '' : String(draft.transferFromAccountId),
        transferToAccountId:
          draft.transferToAccountId === null ? '' : String(draft.transferToAccountId),
        reminderId: '',
        mainCategoryId: draft.mainCategoryId === null ? '' : String(draft.mainCategoryId),
        categoryId: draft.categoryId === null ? '' : String(draft.categoryId),
        transactionDate: draft.transactionDate || this.getTodayDate(),
        amount: draft.amount,
        comment: draft.comment,
        useMicroSavings: this.useMicroSavings(),
        multiplier: this.microSavingsMultiplier(),
      },
      { emitEvent: false },
    );
  }

  private initializeSignalsFromDraft(): void {
    const draft = this.draftService.value();
    this.transactionType.set(draft.type);
    this.updateValidatorsForType(draft.type);
    this.selectedMainCategoryId.set(draft.mainCategoryId);
    this.selectedCategoryId.set(draft.categoryId);
  }

  private setupSubscriptions(): void {}
  private setupOpenRequestEffect(): void {
    effect(() => {
      const request = this.draftService.openTransactionRequest();
      if (!request) return;

      const transactionDate = request.transactionDate ?? this.getTodayDate();
      const type = request.type ?? 'EXPENSE';
      this.transactionType.set(type);
      this.categoryFormType.set(type === 'TRANSFER' ? 'EXPENSE' : type);
      this.updateValidatorsForType(type);
      this.transactionForm.patchValue(
        {
          type,
          accountId: request.accountId === null || request.accountId === undefined
            ? ''
            : String(request.accountId),
          transferFromAccountId:
            request.preselectedFromAccount === null || request.preselectedFromAccount === undefined
              ? ''
              : String(request.preselectedFromAccount),
          transferToAccountId: '',
          reminderId: request.reminderId === null || request.reminderId === undefined
            ? ''
            : String(request.reminderId),
          mainCategoryId: request.categoryId === null || request.categoryId === undefined
            ? ''
            : String(request.categoryId),
          categoryId: request.categoryId === null || request.categoryId === undefined
            ? ''
            : String(request.categoryId),
          transactionDate,
          amount: request.amount ?? '',
          comment: request.comment ?? '',
        },
        { emitEvent: false },
      );

      const requestedCategory = request.categoryId === null || request.categoryId === undefined
        ? null
        : this.allAvailableCategories().find((category) => category.id === request.categoryId) ?? null;
      this.selectedMainCategoryId.set(
        requestedCategory?.parentCategoryId ?? requestedCategory?.id ?? null,
      );
      this.selectedCategoryId.set(
        requestedCategory?.parentCategoryId ? requestedCategory.id : requestedCategory?.id ?? null,
      );

      if (type === 'TRANSFER') {
        this.ensureDefaultTransferSelections();
      } else {
        this.syncIncomeExpenseSelection();
        this.ensureDefaultIncomeExpenseAccount();
      }

      this.draftService.clearOpenRequest();
    }, { allowSignalWrites: true });
  }
  private loadAccounts(): void {
    this.isLoadingAccounts.set(true);
    forkJoin({
      accounts: this.accountService.getAccounts(),
      transferTargets: this.accountService.getTransferTargets(),
    })
      .pipe(finalize(() => this.isLoadingAccounts.set(false)))
      .subscribe({
        next: ({ accounts, transferTargets }) => {
          this.accounts.set(accounts);
          this.transferTargets.set(transferTargets.users);
          if (this.transactionType() === 'TRANSFER') {
            this.ensureDefaultTransferSelections();
          } else {
            this.syncIncomeExpenseSelection();
            this.ensureDefaultIncomeExpenseAccount();
          }
        },
        error: () => {
          this.accounts.set([]);
          this.transferTargets.set([]);
        },
      });
  }
  private loadTransferTargets(): void {
    this.isLoadingTransferTargets.set(true);
    this.accountService
      .getTransferTargets()
      .pipe(finalize(() => this.isLoadingTransferTargets.set(false)))
      .subscribe({
        next: (response) => {
          this.transferTargets.set(response.users);
        },
        error: () => {
          this.transferTargets.set([]);
        },
      });
  }
  private ensureDefaultIncomeExpenseAccount(): void {
    if (this.transactionType() === 'TRANSFER') return;

    const currentValue = this.parseNumber(this.transactionForm.controls.accountId.getRawValue());
    const availableAccounts = this.getCurrentUserOwnAccounts();
    if (availableAccounts.length === 0) return;

    const selectedAccount = currentValue === null ? null : availableAccounts.find((account) => account.id === currentValue) ?? null;
    const defaultAccount = selectedAccount ?? this.getDefaultOwnMainAccount() ?? availableAccounts[0];
    if (!defaultAccount) return;

    if (currentValue === defaultAccount.id) return;

    this.transactionForm.patchValue({ accountId: String(defaultAccount.id) }, { emitEvent: false });
  }

  private syncIncomeExpenseSelection(): void {
    if (this.transactionType() === 'TRANSFER') return;

    const selectedAccountId = this.parseNumber(this.transactionForm.controls.accountId.getRawValue());
    const availableAccounts = this.getCurrentUserOwnAccounts();
    if (availableAccounts.length === 0) return;

    if (selectedAccountId !== null && availableAccounts.some((account) => account.id === selectedAccountId)) {
      return;
    }

    this.ensureDefaultIncomeExpenseAccount();
  }

  private ensureDefaultTransferSelections(): void {
    if (this.transactionType() !== 'TRANSFER') return;

    const availableAccounts = this.transferSourceAccounts();
    if (availableAccounts.length === 0) return;

    const currentFromAccountId = this.parseNumber(this.transactionForm.controls.transferFromAccountId.getRawValue());
    const selectedFromAccount = currentFromAccountId === null
      ? null
      : availableAccounts.find((account) => account.id === currentFromAccountId) ?? null;
    const defaultFromAccount = selectedFromAccount ?? this.getDefaultTransferFromAccount() ?? availableAccounts[0];

    if (defaultFromAccount) {
      const currentFromAccountId = this.parseNumber(
        this.transactionForm.controls.transferFromAccountId.getRawValue(),
      );
      if (currentFromAccountId !== defaultFromAccount.id) {
        this.transactionForm.patchValue(
          { transferFromAccountId: String(defaultFromAccount.id) },
          { emitEvent: false },
        );
      }
      this.selectedTransferFromAccountId.set(defaultFromAccount.id);
    }

    this.ensureDefaultTransferDestination();
  }

  private ensureDefaultTransferDestination(): void {
    if (this.transactionType() !== 'TRANSFER') return;

    const fromAccountId = this.parseNumber(this.transactionForm.controls.transferFromAccountId.getRawValue());
    const currentTargetId = this.parseNumber(this.transactionForm.controls.transferToAccountId.getRawValue());
    if (fromAccountId === null) return;

    if (currentTargetId === null) {
      this.selectedTransferTarget.set(null);
      this.selectedTransferToAccountId.set(null);
      return;
    }

    const currentAccountTarget = this.accounts().find((account) => account.id === currentTargetId) ?? null;
    if (currentAccountTarget) {
      if (currentAccountTarget.id === fromAccountId) {
        this.transactionForm.patchValue({ transferToAccountId: '' }, { emitEvent: false });
        this.selectedTransferTarget.set(null);
        this.selectedTransferToAccountId.set(null);
      } else {
        this.selectedTransferTarget.set({ kind: 'account', id: currentAccountTarget.id });
        if (this.selectedTransferToAccountId() !== currentAccountTarget.id) {
          this.selectedTransferToAccountId.set(currentAccountTarget.id);
        }
      }
      return;
    }

    const selectedUser = this.transferTargets().find((user) => -user.id === currentTargetId) ?? null;
    if (selectedUser) {
      this.selectedTransferTarget.set({ kind: 'user', id: selectedUser.id });
      if (this.selectedTransferToAccountId() !== currentTargetId) {
        this.selectedTransferToAccountId.set(currentTargetId);
      }
    }
  }

  private syncTransactionControlsForType(type: TransactionType): void {
    if (type === 'TRANSFER') {
      this.transactionForm.patchValue(
        { accountId: '' },
        { emitEvent: false },
      );
      return;
    }

    this.transactionForm.patchValue(
      { transferFromAccountId: '', transferToAccountId: '' },
      { emitEvent: false },
    );
    this.selectedTransferFromAccountId.set(null);
    this.selectedTransferToAccountId.set(null);
    this.selectedTransferTarget.set(null);
  }

  private updateValidatorsForType(type: TransactionType): void {
    const accountControl = this.transactionForm.controls.accountId;
    const mainCategoryControl = this.transactionForm.controls.mainCategoryId;
    const categoryControl = this.transactionForm.controls.categoryId;

    if (type === 'TRANSFER') {
      accountControl.clearValidators();
      mainCategoryControl.clearValidators();
      categoryControl.clearValidators();
    } else {
      accountControl.setValidators(Validators.required);
      mainCategoryControl.setValidators(Validators.required);
      categoryControl.setValidators(Validators.required);
    }

    accountControl.updateValueAndValidity({ emitEvent: false });
    mainCategoryControl.updateValueAndValidity({ emitEvent: false });
    categoryControl.updateValueAndValidity({ emitEvent: false });
  }
  private persistDraft(): void {
    const raw = this.transactionForm.getRawValue();
    this.draftService.update({
      type: raw.type,
      accountId: this.parseNumber(raw.accountId),
      transferFromAccountId: this.parseNumber(raw.transferFromAccountId),
      transferToAccountId: this.parseNumber(raw.transferToAccountId),
      toAccountId: null,
      mainCategoryId: this.parseNumber(raw.mainCategoryId),
      categoryId: this.parseNumber(raw.categoryId),
      transactionDate: raw.transactionDate || this.getTodayDate(),
      amount: raw.amount,
      comment: raw.comment,
    });
  }
  private persistMicroSavingsPreference(): void {
    window.localStorage.setItem(
      'transactionMicroSavingsPreference',
      JSON.stringify({
        enabled: this.useMicroSavings(),
        multiplier: this.microSavingsMultiplier(),
      }),
    );
  }
  private getTodayDate(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  getAccountLabel(a: Account): string {
    return this.formatAccountDisplay(a);
  }
  getTransferSourceOptionLabel(a: Account): string {
    return this.formatAccountDisplay(a);
  }
  getTransferTargetPlaceholder(): string {
    return this.i18n.translate('transactions.selectAccount');
  }
  getTransferTargetAccountLabel(a: Account): string {
    return this.formatTransferTargetAccountLabel(a);
  }
  normalizeMoneyInput(e: Event): void {
    const input = e.target as HTMLInputElement | null;
    if (!input) return;

    const normalized = input.value.replace(/,/g, '.');
    if (input.value !== normalized) {
      input.value = normalized;
    }
  }
}
