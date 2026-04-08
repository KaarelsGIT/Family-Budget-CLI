import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { AuthService } from '../../../../auth/auth.service';
import { formatMoney, parseMoneyInput } from '../../../../shared/utils/money-format';
import { TranslationService } from '../../../../i18n/translation.service';
import { Account } from '../../models/account.model';
import { AccountService, SelectableUser } from '../../services/account.service';
import { buildTransferTargetUsers, shouldShowMyAccountsSection, TransferTargetUser } from '../../utils/transfer-targets';

export interface TransferSubmittedEvent {
  amount: number;
  transactionDate: string;
  comment: string;
  fromAccountId: number;
  toAccountId: number;
}

@Component({
  selector: 'app-transfer-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './transfer-form.component.html',
  styleUrl: './transfer-form.component.css'
})
export class TransferFormComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly accountService = inject(AccountService);
  private readonly authService = inject(AuthService);
  readonly i18n = inject(TranslationService);

  readonly sourceAccount = input.required<Account>();
  readonly accounts = input<Account[] | null>(null);
  readonly transferred = output<TransferSubmittedEvent>();
  readonly error = output<string>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');
  readonly transferTargets = signal<SelectableUser[]>([]);
  readonly expandedTargetUserId = signal<number | null>(null);
  readonly transferTargetUsers = computed<TransferTargetUser[]>(() =>
    buildTransferTargetUsers(this.transferTargets(), this.accounts() ?? [], this.sourceAccount().ownerId)
  );
  readonly hasTransferTargets = computed(() =>
    this.transferTargetUsers().some((user) => !user.isCurrentUser || this.shouldShowMyAccountsSection(user))
  );

  readonly form = this.formBuilder.nonNullable.group({
    amount: [0, [Validators.required, Validators.min(0.01)]],
    transactionDate: [this.getTodayDate(), Validators.required],
    comment: ['', [Validators.maxLength(500)]],
    toAccountId: ['', Validators.required]
  });

  constructor() {
    effect(() => {
      this.sourceAccount();
      this.accounts();
      this.ensureDefaultTargetAccountSelected();
    }, { allowSignalWrites: true });

    this.loadTransferTargetAccounts();
  }

  submit(): void {
    if (this.form.invalid || this.isSubmitting() || !this.hasTransferTargets()) {
      if (!this.hasTransferTargets()) {
        this.setError(this.i18n.translate('accounts.noTransferTargets'));
      } else if (!this.form.controls.toAccountId.value) {
        this.setError(this.i18n.translate('accounts.transferTo'));
      } else if (!this.isAmountWithinBalance()) {
        this.setError(this.i18n.translate('transactions.balanceWouldGoNegative'));
      }
      this.form.markAllAsTouched();
      return;
    }

    const { amount, comment, transactionDate, toAccountId } = this.form.getRawValue();
    const parsedAmount = parseMoneyInput(amount);
    const parsedToAccountId = Number.parseInt(toAccountId, 10);
    const selectedCurrentUser = this.transferTargetUsers().find((user) => user.isCurrentUser) ?? null;
    const selectedOwnAccount = selectedCurrentUser?.accounts.find((account) => account.id === parsedToAccountId) ?? null;

    if (!Number.isFinite(parsedToAccountId) || parsedToAccountId < 1) {
      this.setError(this.i18n.translate('accounts.transferTo'));
      this.form.markAllAsTouched();
      return;
    }

    if (!Number.isFinite(parsedAmount)) {
      this.setError(this.i18n.translate('accounts.transferTo'));
      this.form.markAllAsTouched();
      return;
    }

    if (!this.isAmountWithinBalance()) {
      this.setError(this.i18n.translate('transactions.balanceWouldGoNegative'));
      this.form.markAllAsTouched();
      return;
    }

    this.errorMessage.set('');
    this.isSubmitting.set(true);

    this.accountService.createTransfer({
      amount: parsedAmount,
      fromAccountId: this.sourceAccount().id,
      targetUserId: selectedOwnAccount ? null : parsedToAccountId,
      toAccountId: selectedOwnAccount ? parsedToAccountId : null,
      transactionDate,
      comment
    }).pipe(
      finalize(() => this.isSubmitting.set(false))
    ).subscribe({
      next: () => {
        this.transferred.emit({
          amount: parsedAmount,
          transactionDate,
          comment,
          fromAccountId: this.sourceAccount().id,
          toAccountId: parsedToAccountId
        });
      },
      error: (error: { error?: { message?: string } }) => {
        this.setError(this.resolveErrorMessage(error, 'accounts.transferFailed'));
      }
    });
  }

  trackByAccountId(_index: number, account: Account): number {
    return account.id;
  }

  trackByTransferTargetUser(_index: number, user: SelectableUser): number {
    return user.id;
  }

  isCurrentUserTarget(user: TransferTargetUser): boolean {
    return user.isCurrentUser;
  }

  shouldShowMyAccountsSection(user: TransferTargetUser): boolean {
    return shouldShowMyAccountsSection(user, this.accounts() ?? [], this.authService.getUserId());
  }

  isExpandedTarget(user: TransferTargetUser): boolean {
    return this.expandedTargetUserId() === user.id;
  }

  toggleTargetExpansion(user: TransferTargetUser): void {
    if (!user.isCurrentUser || !this.shouldShowMyAccountsSection(user)) {
      return;
    }

    this.expandedTargetUserId.set(this.isExpandedTarget(user) ? null : user.id);
  }

  selectTransferTarget(value: number): void {
    this.form.patchValue({ toAccountId: String(value) });
  }

  isAmountWithinBalance(): boolean {
    const amount = parseMoneyInput(this.form.controls.amount.value);
    if (!Number.isFinite(amount) || amount <= 0) {
      return false;
    }

    return amount <= this.sourceAccount().balance;
  }

  getAccountLabel(account: Account): string {
    return `${account.name}`;
  }

  getAccountDetails(account: Account): string {
    return `${account.ownerUsername} · ${formatMoney(account.balance)}`;
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

  private ensureDefaultTargetAccountSelected(): void {
    const options = this.transferTargetUsers();
    if (options.length === 0) {
      return;
    }

    const currentValue = this.form.controls.toAccountId.value;
    const isCurrentValueValid = options.some((option) =>
      option.isCurrentUser
        ? option.accounts.some((account) => String(account.id) === currentValue)
        : String(option.id) === currentValue
    );
    if (isCurrentValueValid) {
      return;
    }

    const fallback = this.findFallbackTarget(options);
    if (fallback) {
      this.form.patchValue({ toAccountId: String(fallback) });
    }
  }

  private findFallbackTarget(options: TransferTargetUser[]): number | null {
    const currentUserTarget = options.find((option) => option.isCurrentUser);
    const showMyAccounts = currentUserTarget !== undefined && this.shouldShowMyAccountsSection(currentUserTarget);

    if (!showMyAccounts) {
      return options.find((option) => !option.isCurrentUser)?.id ?? null;
    }

    if (currentUserTarget?.accounts.length) {
      const sourceAccountId = this.sourceAccount().id;
      const preferredOwnAccount = currentUserTarget.accounts.find((account) => account.id !== sourceAccountId)
        ?? currentUserTarget.accounts[0];
      if (preferredOwnAccount) {
        return preferredOwnAccount.id;
      }
    }

    return options.find((option) => !option.isCurrentUser)?.id ?? null;
  }

  private getTodayDate(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private setError(message: string): void {
    this.errorMessage.set(message);
    this.error.emit(message);
  }

  private resolveErrorMessage(
    error: { error?: { message?: string } },
    fallbackKey: 'accounts.transferFailed'
  ): string {
    const message = error.error?.message;
    if (
      message === 'Kontol ei ole piisavalt raha' ||
      message === 'Saldo ei tohi minna alla nulli!'
    ) {
      return this.i18n.translate('transactions.balanceWouldGoNegative');
    }

    return message || this.i18n.translate(fallbackKey);
  }

  private loadTransferTargetAccounts(): void {
    this.accountService.getTransferTargets().subscribe({
      next: (targets) => {
        this.transferTargets.set(targets.users);
        this.ensureDefaultTargetAccountSelected();
      },
      error: () => {
        this.transferTargets.set([]);
        this.ensureDefaultTargetAccountSelected();
      }
    });
  }
}
