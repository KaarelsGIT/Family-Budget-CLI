import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { TranslationService } from '../../../../i18n/translation.service';
import { Account } from '../../models/account.model';
import { AccountService, SelectableUser } from '../../services/account.service';

interface TransferDestinationOption {
  accountId: number;
  value: string;
  label: string;
  groupKey: 'accounts.transferOwnAccounts' | 'accounts.transferOtherUsers';
}

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
export class TransferFormComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly accountService = inject(AccountService);
  readonly i18n = inject(TranslationService);

  readonly sourceAccount = input.required<Account>();
  readonly accounts = input.required<Account[]>();
  readonly transferred = output<TransferSubmittedEvent>();
  readonly error = output<string>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');
  readonly selectableUsers = signal<SelectableUser[]>([]);

  readonly form = this.formBuilder.nonNullable.group({
    amount: [0, [Validators.required, Validators.min(0.01)]],
    transactionDate: [this.getTodayDate(), Validators.required],
    comment: ['', [Validators.maxLength(500)]],
    transferToAccountId: ['', Validators.required]
  });

  readonly ownDestinationOptions = computed(() =>
    this.destinationOptions().filter((option) => option.groupKey === 'accounts.transferOwnAccounts')
  );

  readonly otherUserDestinationOptions = computed(() =>
    this.destinationOptions().filter((option) => option.groupKey === 'accounts.transferOtherUsers')
  );

  readonly hasDestinations = computed(() => this.destinationOptions().length > 0);

  constructor() {
    effect(() => {
      this.sourceAccount();
      this.accounts();
      this.selectableUsers();
      this.ensureDefaultDestinationSelected();
    }, { allowSignalWrites: true });
  }

  ngOnInit(): void {
    this.accountService.getSelectableUsers().subscribe({
      next: (users) => {
        this.selectableUsers.set(users);
      },
      error: (error: { error?: { message?: string } }) => {
        this.setError(error.error?.message || this.i18n.translate('accounts.loadFailed'));
        this.selectableUsers.set([]);
      }
    });
  }

  submit(): void {
    if (this.form.invalid || this.isSubmitting() || !this.hasDestinations()) {
      if (!this.hasDestinations()) {
        this.setError(this.i18n.translate('accounts.noSectionAccounts'));
      } else if (!this.form.controls.transferToAccountId.value) {
        this.setError(this.i18n.translate('accounts.transferTo'));
      } else if (!this.isAmountWithinBalance()) {
        this.setError(this.i18n.translate('transactions.balanceWouldGoNegative'));
      }
      this.form.markAllAsTouched();
      return;
    }

    const { amount, comment, transactionDate, transferToAccountId } = this.form.getRawValue();
    const parsedToAccountId = Number.parseInt(transferToAccountId, 10);

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
      toAccountId: parsedToAccountId,
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
        this.setError(error.error?.message || this.i18n.translate('accounts.transferFailed'));
      }
    });
  }

  trackByTransferOption(_index: number, option: TransferDestinationOption): number {
    return option.accountId;
  }

  isAmountWithinBalance(): boolean {
    const amount = Number(this.form.controls.amount.value);
    if (!Number.isFinite(amount) || amount <= 0) {
      return false;
    }

    return amount <= this.sourceAccount().balance;
  }

  private destinationOptions(): TransferDestinationOption[] {
    const ownAccountOptions = this.accounts()
      .filter((account) => account.id !== this.sourceAccount().id)
      .filter((account) => account.ownerId === this.sourceAccount().ownerId)
      .map((account) => ({
        accountId: account.id,
        value: String(account.id),
        label: account.name,
        groupKey: 'accounts.transferOwnAccounts' as const
      }));

    const otherUserOptions = this.selectableUsers()
      .filter((user) => user.id !== this.sourceAccount().ownerId)
      .filter((user) => typeof user.defaultMainAccountId === 'number' && user.defaultMainAccountId > 0)
      .map((user) => ({
        accountId: user.defaultMainAccountId as number,
        value: String(user.defaultMainAccountId),
        label: user.username,
        groupKey: 'accounts.transferOtherUsers' as const
      }));

    return [...ownAccountOptions, ...otherUserOptions];
  }

  private ensureDefaultDestinationSelected(): void {
    const options = this.destinationOptions();
    if (options.length === 0) {
      return;
    }

    const currentValue = this.form.controls.transferToAccountId.value;
    const isCurrentValueValid = options.some((option) => option.value === currentValue);
    if (isCurrentValueValid) {
      return;
    }

    this.form.patchValue({ transferToAccountId: options[0].value });
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
}
