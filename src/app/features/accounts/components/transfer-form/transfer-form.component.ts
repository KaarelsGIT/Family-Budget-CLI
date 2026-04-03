import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { AuthService } from '../../../../auth/auth.service';
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
export class TransferFormComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly accountService = inject(AccountService);
  private readonly authService = inject(AuthService);
  readonly i18n = inject(TranslationService);

  readonly sourceAccount = input.required<Account>();
  readonly accounts = input.required<Account[]>();
  readonly transferred = output<TransferSubmittedEvent>();
  readonly error = output<string>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');
  readonly selectableUsers = signal<SelectableUser[]>([]);
  readonly ownAccounts = computed(() => {
    const currentUserId = this.authService.getUserId();
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
      this.ensureDefaultDestinationSelected();
    }, { allowSignalWrites: true });

    this.loadSelectableUsers();
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
        this.setError(this.resolveErrorMessage(error, 'accounts.transferFailed'));
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
    const currentUserId = this.authService.getUserId();
    const destinationOptions = new Map<number, TransferDestinationOption>();

    for (const account of this.ownAccounts()) {
      if (account.id === this.sourceAccount().id) {
        continue;
      }

      destinationOptions.set(account.id, {
        accountId: account.id,
        value: String(account.id),
        label: account.ownerId === currentUserId ? account.name : `${account.name} · ${account.ownerUsername}`,
        groupKey: account.ownerId === currentUserId
          ? 'accounts.transferOwnAccounts'
          : 'accounts.transferOtherUsers'
      });
    }

    for (const user of this.selectableUsers()) {
      if (currentUserId !== null && user.id === currentUserId) {
        continue;
      }

      if (user.defaultMainAccountId === null || user.defaultMainAccountId === this.sourceAccount().id) {
        continue;
      }

      if (destinationOptions.has(user.defaultMainAccountId)) {
        continue;
      }

      destinationOptions.set(user.defaultMainAccountId, {
        accountId: user.defaultMainAccountId,
        value: String(user.defaultMainAccountId),
        label: user.username,
        groupKey: 'accounts.transferOtherUsers'
      });
    }

    return [...destinationOptions.values()];
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

  private loadSelectableUsers(): void {
    this.accountService.getSelectableUsers().subscribe({
      next: (users) => {
        this.selectableUsers.set(users);
        this.ensureDefaultDestinationSelected();
      },
      error: () => {
        this.selectableUsers.set([]);
        this.ensureDefaultDestinationSelected();
      }
    });
  }
}
