import { CommonModule } from '@angular/common';
import { Component, HostListener, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize, forkJoin } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { TranslationService } from '../../../../core/services/i18n/translation.service';
import { Account } from '../../../accounts/models/account.model';
import { AccountService, SelectableUser } from '../../../accounts/services/account.service';
import { canTransactFromAccount } from '../../../accounts/utils/account-access';
import { buildTransferTargetUsers, shouldShowMyAccountsSection, TransferTargetUser } from '../../../accounts/utils/transfer-targets';
import { formatMoney, parseMoneyInput } from '../../../shared/utils/money-format';
import { TransactionItem, UpdateTransactionPayload } from '../../models/transaction.model';
import { TransactionsService } from '../../services/transactions.service';

@Component({
  selector: 'app-edit-transaction-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './edit-transaction-modal.component.html',
  styleUrl: './edit-transaction-modal.component.css'
})
export class EditTransactionModalComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly transactionsService = inject(TransactionsService);
  private readonly accountService = inject(AccountService);
  private readonly authService = inject(AuthService);
  readonly i18n = inject(TranslationService);

  readonly transaction = input.required<TransactionItem>();
  readonly closed = output<void>();
  readonly updated = output<void>();
  readonly deleted = output<void>();

  readonly isSubmitting = signal(false);
  readonly isLoadingAccounts = signal(false);
  readonly errorMessage = signal('');
  readonly accounts = signal<Account[]>([]);
  readonly transferTargets = signal<SelectableUser[]>([]);
  readonly expandedTransferTargetUserId = signal<number | null>(null);
  readonly modalOffsetX = signal(0);
  readonly modalOffsetY = signal(0);

  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragOriginX = 0;
  private dragOriginY = 0;

  private readonly currentUserId = this.authService.getUserId();
  private readonly currentUserRole = this.authService.getRole();

  readonly form = this.formBuilder.nonNullable.group({
    amount: [0, [Validators.required, Validators.min(0.01)]],
    fromAccountId: [''],
    toAccountId: [''],
    transactionDate: ['', Validators.required],
    comment: ['', [Validators.maxLength(500)]]
  });

  readonly ownAccounts = computed(() => {
    const currentUserId = this.currentUserId;
    if (currentUserId === null) {
      return [];
    }

    return [...this.accounts()]
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
  });

  readonly isTransfer = computed(() => this.transaction().type === 'TRANSFER');

  readonly transferSourceOptions = computed(() => this.ownAccounts());
  readonly selectedTransferSourceAccount = computed(() => {
    const sourceAccountId = this.parseNumber(this.form.controls.fromAccountId.getRawValue()) ?? this.transaction().fromAccountId;
    if (sourceAccountId === null) {
      return null;
    }

    return this.transferSourceOptions().find((account) => account.id === sourceAccountId) ?? null;
  });

  readonly transferTargetUsers = computed<TransferTargetUser[]>(() =>
    buildTransferTargetUsers(this.transferTargets(), this.accounts(), this.currentUserId)
  );

  readonly hasTransferTargets = computed(() =>
    this.transferTargetUsers().some((user) => !user.isCurrentUser || this.shouldShowMyAccountsSection(user))
  );

  constructor() {
    this.loadAccounts();

    effect(() => {
      const transaction = this.transaction();
      this.form.patchValue({
        amount: transaction.amount,
        fromAccountId: transaction.type === 'TRANSFER' ? String(transaction.fromAccountId ?? '') : '',
        toAccountId: transaction.type === 'TRANSFER' ? String(transaction.toAccountId ?? '') : '',
        transactionDate: this.normalizeDateValue(transaction.transactionDate),
        comment: transaction.comment ?? ''
      }, { emitEvent: false });
      this.errorMessage.set('');
    });
  }

  close(): void {
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

  submit(): void {
    if (this.form.invalid || this.isSubmitting()) {
      this.form.markAllAsTouched();
      this.errorMessage.set(this.i18n.translate('transactions.fillRequiredFields'));
      return;
    }

    const { amount, fromAccountId, toAccountId, transactionDate, comment } = this.form.getRawValue();
    const parsedAmount = parseMoneyInput(amount);
    const trimmedComment = (comment || '').trim();

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      this.errorMessage.set(this.i18n.translate('transactions.fillRequiredFields'));
      return;
    }

    if (this.transaction().type === 'EXPENSE' && !this.isExpenseAmountWithinBalance(parsedAmount)) {
      this.errorMessage.set(this.i18n.translate('transactions.balanceWouldGoNegative'));
      return;
    }

    const payload: UpdateTransactionPayload = {
      amount: parsedAmount,
      transactionDate,
      comment: trimmedComment
    };

    if (this.isTransfer()) {
      const parsedFromAccountId = this.parseNumber(fromAccountId);
      const parsedToAccountId = this.parseNumber(toAccountId);

      if (parsedFromAccountId === null || parsedToAccountId === null) {
        this.errorMessage.set(this.i18n.translate('transactions.fillRequiredFields'));
        return;
      }

      if (!this.isTransferAmountWithinBalance(parsedFromAccountId, parsedAmount)) {
        this.errorMessage.set(this.i18n.translate('transactions.balanceWouldGoNegative'));
        return;
      }

      payload.fromAccountId = parsedFromAccountId;
      const selectedOwnAccount = this.isOwnTransferTarget(parsedToAccountId);
      payload.targetUserId = selectedOwnAccount ? null : parsedToAccountId;
      payload.toAccountId = selectedOwnAccount ? parsedToAccountId : null;
    }

    this.errorMessage.set('');
    this.isSubmitting.set(true);

    this.transactionsService.updateTransaction(this.transaction().id, payload).pipe(
      finalize(() => this.isSubmitting.set(false))
    ).subscribe({
      next: () => {
        this.updated.emit();
        this.closed.emit();
      },
      error: (error: { error?: { message?: string } }) => {
        this.errorMessage.set(this.resolveErrorMessage(error));
      }
    });
  }

  getTypeLabel(): string {
    switch (this.transaction().type) {
      case 'INCOME':
        return this.i18n.translate('transactions.typeIncome');
      case 'EXPENSE':
        return this.i18n.translate('transactions.typeExpense');
      default:
        return this.i18n.translate('transactions.typeTransfer');
    }
  }

  getAccountLabel(): string {
    const transaction = this.transaction();
    if (transaction.type === 'INCOME') {
      return transaction.toAccountName ?? '—';
    }
    if (transaction.type === 'TRANSFER') {
      return `${transaction.fromAccountName ?? '—'} -> ${transaction.toAccountName ?? '—'}`;
    }
    return transaction.fromAccountName ?? '—';
  }

  getCurrentTransferSourceLabel(): string {
    return this.selectedTransferSourceAccount()?.name ?? this.transaction().fromAccountName ?? '—';
  }

  getCurrentTransferDestinationLabel(): string {
    return this.getSelectedTransferDestinationLabel();
  }

  formatCurrentAmount(): string {
    return formatMoney(this.transaction().amount);
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

  getModalTransform(): string {
    return `translate3d(${this.modalOffsetX()}px, ${this.modalOffsetY()}px, 0)`;
  }

  trackByAccountId(_index: number, account: Account): number {
    return account.id;
  }

  trackByTransferTargetUser(_index: number, user: TransferTargetUser): number {
    return user.id;
  }

  getTransferAccountDetails(account: Account): string {
    return `${account.ownerUsername} · ${formatMoney(account.balance)}`;
  }

  isExpenseAmountWithinBalance(amount?: number): boolean {
    if (this.transaction().type !== 'EXPENSE') {
      return true;
    }

    const parsedAmount = amount ?? parseMoneyInput(this.form.controls.amount.getRawValue());
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return true;
    }

    const sourceAccountId = this.transaction().fromAccountId;
    if (sourceAccountId === null) {
      return true;
    }

    const sourceAccount = this.accounts().find((account) => account.id === sourceAccountId);
    if (!sourceAccount) {
      return true;
    }

    return parsedAmount <= sourceAccount.balance + this.transaction().amount;
  }

  private loadAccounts(): void {
    this.isLoadingAccounts.set(true);

    forkJoin({
      accounts: this.accountService.getAccounts(),
      transferTargets: this.accountService.getTransferTargets()
    }).pipe(
      finalize(() => this.isLoadingAccounts.set(false))
    ).subscribe({
      next: ({ accounts, transferTargets }) => {
        this.accounts.set(accounts);
        this.transferTargets.set(transferTargets.users);
        this.ensureValidTransferSelection();
      },
      error: () => {
        this.accounts.set([]);
        this.transferTargets.set([]);
      }
    });
  }

  private ensureValidTransferSelection(): void {
    if (!this.isTransfer()) {
      return;
    }

    const options = this.transferTargetUsers();
    if (options.length === 0) {
      return;
    }

    const currentFromAccountId = this.parseNumber(this.form.controls.fromAccountId.getRawValue()) ?? this.transaction().fromAccountId;
    if (currentFromAccountId === null) {
      this.form.patchValue({ fromAccountId: String(this.transaction().fromAccountId ?? '') }, { emitEvent: false });
      return;
    }

    const currentToAccountId = this.parseNumber(this.form.controls.toAccountId.getRawValue()) ?? this.resolveTransactionDestinationUserId();
    const validSource = this.transferSourceOptions().some((account) => account.id === currentFromAccountId);
    const validDestination = currentToAccountId !== null && this.isValidTransferTargetValue(currentToAccountId);

    if (!validSource) {
      const sourceAccount = this.transferSourceOptions().find((account) => account.id === this.transaction().fromAccountId)
        ?? this.transferSourceOptions()[0];
      if (sourceAccount) {
        this.form.patchValue({ fromAccountId: String(sourceAccount.id) }, { emitEvent: false });
      }
    }

    if (!validDestination) {
      const destination = this.findFallbackTransferTarget(options);
      if (destination) {
        this.form.patchValue({ toAccountId: String(destination) }, { emitEvent: false });
      }
    }
  }

  private isTransferAmountWithinBalance(sourceAccountId: number, amount: number): boolean {
    const sourceAccount = this.transferSourceOptions().find((account) => account.id === sourceAccountId);
    if (!sourceAccount) {
      return false;
    }

    if (this.transaction().fromAccountId === sourceAccountId) {
      return amount <= sourceAccount.balance + this.transaction().amount;
    }

    if (this.transaction().toAccountId === sourceAccountId) {
      return amount <= Math.max(0, sourceAccount.balance - this.transaction().amount);
    }

    return amount <= sourceAccount.balance && canTransactFromAccount(sourceAccount, this.currentUserId, this.currentUserRole);
  }

  private selectedSourceAccountId(): number | null {
    return this.parseNumber(this.form.controls.fromAccountId.getRawValue()) ?? this.transaction().fromAccountId;
  }

  private getSelectedTransferDestinationLabel(): string {
    const selectedTargetId = this.parseNumber(this.form.controls.toAccountId.getRawValue()) ?? this.resolveTransactionDestinationUserId();
    if (selectedTargetId === null) {
      return this.transaction().toAccountName ?? '—';
    }

    const ownAccount = this.transferTargetUsers()
      .find((user) => user.isCurrentUser)
      ?.accounts.find((account) => account.id === selectedTargetId);
    if (ownAccount) {
      return ownAccount.name;
    }

    return this.transferTargetUsers().find((user) => user.id === selectedTargetId)?.username
      ?? this.transaction().toAccountName
      ?? '—';
  }

  private resolveTransactionDestinationUserId(): number | null {
    const destinationAccountId = this.transaction().toAccountId;
    if (destinationAccountId === null) {
      return null;
    }

    if (this.isOwnTransferTarget(destinationAccountId)) {
      return destinationAccountId;
    }

    return this.transferTargetUsers().find((user) => user.defaultMainAccountId === destinationAccountId)?.id ?? null;
  }

  shouldShowMyAccountsSection(user: TransferTargetUser): boolean {
    return shouldShowMyAccountsSection(user, this.accounts(), this.currentUserId);
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

  selectTransferTarget(value: number): void {
    this.form.patchValue({ toAccountId: String(value) }, { emitEvent: false });
  }

  private isOwnTransferTarget(value: number | null): boolean {
    if (value === null) {
      return false;
    }

    return this.transferTargetUsers().some((user) => user.isCurrentUser && user.accounts.some((account) => account.id === value));
  }

  private isValidTransferTargetValue(value: number): boolean {
    return this.isOwnTransferTarget(value) || this.transferTargetUsers().some((user) => !user.isCurrentUser && user.id === value);
  }

  private findFallbackTransferTarget(users: TransferTargetUser[]): number | null {
    const currentUserTarget = users.find((user) => user.isCurrentUser);
    const showMyAccounts = currentUserTarget !== undefined && this.shouldShowMyAccountsSection(currentUserTarget);

    if (!showMyAccounts) {
      return users.find((user) => !user.isCurrentUser)?.id ?? null;
    }

    if (currentUserTarget?.accounts.length) {
      const sourceAccountId = this.selectedTransferSourceAccount()?.id ?? this.transaction().fromAccountId;
      const preferredOwnAccount = currentUserTarget.accounts.find((account) => account.id !== sourceAccountId)
        ?? currentUserTarget.accounts[0];
      if (preferredOwnAccount) {
        return preferredOwnAccount.id;
      }
    }

    return users.find((user) => !user.isCurrentUser)?.id ?? null;
  }

  private normalizeDateValue(value: string | null | undefined): string {
    if (!value) {
      return '';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private resolveErrorMessage(error: { error?: { message?: string } }): string {
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

    return message || this.i18n.translate('transactions.editFailed');
  }

  private parseNumber(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
}
