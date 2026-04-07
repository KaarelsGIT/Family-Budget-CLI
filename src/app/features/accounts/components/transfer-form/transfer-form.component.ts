import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { formatEuroAmount } from '../../../../shared/utils/money-format';
import { TranslationService } from '../../../../i18n/translation.service';
import { Account } from '../../models/account.model';
import { AccountService, SelectableUser } from '../../services/account.service';

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
  readonly i18n = inject(TranslationService);

  readonly sourceAccount = input.required<Account>();
  readonly transferred = output<TransferSubmittedEvent>();
  readonly error = output<string>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');
  readonly transferTargets = signal<SelectableUser[]>([]);
  readonly hasTransferTargets = computed(() => this.transferTargets().length > 0);

  readonly form = this.formBuilder.nonNullable.group({
    amount: [0, [Validators.required, Validators.min(0.01)]],
    transactionDate: [this.getTodayDate(), Validators.required],
    comment: ['', [Validators.maxLength(500)]],
    toAccountId: ['', Validators.required]
  });

  constructor() {
    effect(() => {
      this.sourceAccount();
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
    const parsedToAccountId = Number.parseInt(toAccountId, 10);

    if (!Number.isFinite(parsedToAccountId) || parsedToAccountId < 1) {
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
      amount,
      fromAccountId: this.sourceAccount().id,
      targetUserId: parsedToAccountId,
      transactionDate,
      comment
    }).pipe(
      finalize(() => this.isSubmitting.set(false))
    ).subscribe({
      next: () => {
        this.transferred.emit({
          amount,
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

  isAmountWithinBalance(): boolean {
    const amount = Number(this.form.controls.amount.value);
    if (!Number.isFinite(amount) || amount <= 0) {
      return false;
    }

    return amount <= this.sourceAccount().balance;
  }

  getAccountLabel(account: Account): string {
    return `${account.name}`;
  }

  getAccountDetails(account: Account): string {
    return `${account.ownerUsername} · ${formatEuroAmount(account.balance, this.i18n.language())}`;
  }

  private ensureDefaultTargetAccountSelected(): void {
    const options = this.transferTargets();
    if (options.length === 0) {
      return;
    }

    const currentValue = this.form.controls.toAccountId.value;
    const isCurrentValueValid = options.some((option) => String(option.id) === currentValue);
    if (isCurrentValueValid) {
      return;
    }

    const fallback = options[0];
    if (fallback) {
      this.form.patchValue({ toAccountId: String(fallback.id) });
    }
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
