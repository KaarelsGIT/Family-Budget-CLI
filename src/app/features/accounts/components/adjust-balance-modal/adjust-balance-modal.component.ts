import { CommonModule } from '@angular/common';
import { Component, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { TranslationService } from '../../../../i18n/translation.service';
import { Account } from '../../models/account.model';
import { AccountService } from '../../services/account.service';
import { formatMoney, parseMoneyInput } from '../../../../shared/utils/money-format';

@Component({
  selector: 'app-adjust-balance-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './adjust-balance-modal.component.html',
  styleUrl: './adjust-balance-modal.component.css'
})
export class AdjustBalanceModalComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly accountService = inject(AccountService);
  readonly i18n = inject(TranslationService);

  readonly account = input.required<Account>();
  readonly closed = output<void>();
  readonly adjusted = output<void>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');

  readonly form = this.formBuilder.nonNullable.group({
    amount: [0, [Validators.required]],
    comment: ['', [Validators.required, Validators.maxLength(500)]]
  });

  close(): void {
    this.closed.emit();
  }

  formatBalance(value: number): string {
    return formatMoney(value);
  }

  submit(): void {
    if (this.form.invalid || this.isSubmitting()) {
      this.form.markAllAsTouched();
      return;
    }

    const { amount, comment } = this.form.getRawValue();
    const parsedAmount = parseMoneyInput(amount);
    const trimmedComment = comment.trim();
    if (!Number.isFinite(parsedAmount) || parsedAmount === 0) {
      this.errorMessage.set(this.i18n.translate('accounts.adjustBalanceInvalid'));
      this.form.markAllAsTouched();
      return;
    }

    if (!trimmedComment) {
      this.errorMessage.set(this.i18n.translate('accounts.adjustBalanceCommentRequired'));
      this.form.markAllAsTouched();
      return;
    }

    this.errorMessage.set('');
    this.isSubmitting.set(true);

    this.accountService.adjustBalance(this.account().id, {
      amount: parsedAmount,
      comment: trimmedComment
    }).pipe(
      finalize(() => this.isSubmitting.set(false))
    ).subscribe({
      next: () => {
        this.adjusted.emit();
        this.closed.emit();
      },
      error: (error: { error?: { message?: string } }) => {
        this.errorMessage.set(error.error?.message || this.i18n.translate('accounts.adjustBalanceFailed'));
      }
    });
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
}
