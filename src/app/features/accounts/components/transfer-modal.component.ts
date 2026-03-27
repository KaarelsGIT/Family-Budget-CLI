import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { TranslationService } from '../../../i18n/translation.service';
import { Account } from '../models/account.model';
import { AccountService, SelectableUser } from '../services/account.service';

interface TransferDestinationOption {
  accountId: number;
  value: string;
  label: string;
  groupKey: 'accounts.transferOwnAccounts' | 'accounts.transferOtherUsers';
}

@Component({
  selector: 'app-transfer-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './transfer-modal.component.html',
  styleUrl: './transfer-modal.component.css'
})
export class TransferModalComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly accountService = inject(AccountService);
  readonly i18n = inject(TranslationService);

  readonly sourceAccount = input.required<Account>();
  readonly accounts = input.required<Account[]>();
  readonly closed = output<void>();
  readonly transferred = output<void>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');
  readonly selectableUsers = signal<SelectableUser[]>([]);
  readonly selectedToAccountId = signal('');

  readonly form = this.formBuilder.nonNullable.group({
    amount: [0, [Validators.required, Validators.min(0.01)]],
    transactionDate: [this.getTodayDate(), Validators.required],
    comment: ['', [Validators.maxLength(500)]]
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
      this.destinationOptions();
      this.ensureDefaultDestinationSelected();
    }, { allowSignalWrites: true });
  }

  ngOnInit(): void {
    this.accountService.getSelectableUsers().subscribe({
      next: (users) => {
        this.selectableUsers.set(users);
      },
      error: (error: { error?: { message?: string } }) => {
        this.errorMessage.set(error.error?.message || this.i18n.translate('accounts.loadFailed'));
      }
    });
  }

  close(): void {
    this.closed.emit();
  }

  onDestinationChange(value: string): void {
    this.selectedToAccountId.set(value);
    this.errorMessage.set('');
  }

  submit(): void {
    if (this.form.invalid || this.isSubmitting() || !this.hasDestinations()) {
      if (!this.hasDestinations()) {
        this.errorMessage.set(this.i18n.translate('accounts.noSectionAccounts'));
      } else if (!this.selectedToAccountId()) {
        this.errorMessage.set(this.i18n.translate('accounts.transferTo'));
      }
      this.form.markAllAsTouched();
      return;
    }

    const { amount, comment, transactionDate } = this.form.getRawValue();
    const parsedToAccountId = Number.parseInt(this.selectedToAccountId(), 10);
    if (!Number.isFinite(parsedToAccountId) || parsedToAccountId < 1) {
      this.errorMessage.set(this.i18n.translate('accounts.transferTo'));
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
        this.transferred.emit();
        this.closed.emit();
      },
      error: (error: { error?: { message?: string } }) => {
        this.errorMessage.set(error.error?.message || this.i18n.translate('accounts.transferFailed'));
      }
    });
  }

  private destinationOptions(): TransferDestinationOption[] {
    const ownAccountOptions = this.accounts()
      .filter((account) => account.id !== this.sourceAccount().id)
      .filter((account) => account.ownerId === this.sourceAccount().ownerId)
      .map((account) => ({
        accountId: account.id,
        value: String(account.id),
        label: `${account.name} (${account.type})`,
        groupKey: 'accounts.transferOwnAccounts' as const
      }));

    const otherUserOptions = this.selectableUsers()
      .filter((user) => user.id !== this.sourceAccount().ownerId)
      .filter((user) => typeof user.defaultMainAccountId === 'number' && user.defaultMainAccountId > 0)
      .map((user) => ({
        accountId: user.defaultMainAccountId as number,
        value: String(user.defaultMainAccountId),
        label: `${user.username} (MAIN)`,
        groupKey: 'accounts.transferOtherUsers' as const
      }));

    return [...ownAccountOptions, ...otherUserOptions];
  }

  private ensureDefaultDestinationSelected(): void {
    const toAccountId = this.selectedToAccountId();
    if (toAccountId) {
      return;
    }

    const firstOption = this.destinationOptions()[0];
    if (!firstOption) {
      return;
    }

    this.selectedToAccountId.set(firstOption.value);
  }

  private getTodayDate(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
