import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { TranslationService } from '../../../../core/services/i18n/translation.service';
import { Account } from '../../models/account.model';
import { AccountService } from '../../services/account.service';
import { formatMoney, parseMoneyInput } from '../../../shared/utils/money-format';

@Component({
  selector: 'app-savings-goal-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './savings-goal-modal.component.html',
  styleUrl: './savings-goal-modal.component.css'
})
export class SavingsGoalModalComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly accountService = inject(AccountService);
  readonly i18n = inject(TranslationService);

  readonly account = input.required<Account>();
  readonly closed = output<void>();
  readonly updated = output<void>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');

  readonly form = this.formBuilder.nonNullable.group({
    targetAmount: [0, [Validators.required]],
    targetDate: ['', [Validators.required]]
  });

  readonly progress = computed(() => {
    const target = this.account().targetAmount ?? 0;
    return target > 0 ? Math.max(0, Math.min(100, (this.account().balance / target) * 100)) : 0;
  });

  readonly monthlyAmount = computed(() => this.calculateMonthlyAmount());

  readonly quickPlans = computed(() => {
    const remaining = Math.max(0, (this.account().targetAmount ?? 0) - this.account().balance);
    return [3, 6, 12].map((months) => ({
      months,
      amount: months > 0 ? remaining / months : 0
    }));
  });

  ngOnInit(): void {
    this.form.patchValue({
      targetAmount: this.account().targetAmount ?? 0,
      targetDate: this.account().targetDate ?? ''
    }, { emitEvent: false });
  }

  close(): void {
    this.closed.emit();
  }

  formatMoney(value: number): string {
    return formatMoney(value);
  }

  formatDate(value: string | null | undefined): string {
    if (!value) {
      return '-';
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString(this.i18n.language(), { dateStyle: 'medium' });
  }

  normalizeMoneyInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (input) {
      input.value = input.value.replace(/,/g, '.');
    }
  }

  submit(): void {
    if (this.form.invalid || this.isSubmitting()) {
      this.form.markAllAsTouched();
      return;
    }

    const { targetAmount, targetDate } = this.form.getRawValue();
    const parsedAmount = parseMoneyInput(targetAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      this.errorMessage.set(this.i18n.translate('accounts.savingsGoalInvalid'));
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set('');

    this.accountService.updateSavingsGoal(this.account().id, {
      targetAmount: parsedAmount,
      targetDate: targetDate || null
    }).pipe(
      finalize(() => this.isSubmitting.set(false))
    ).subscribe({
      next: () => {
        this.updated.emit();
        this.closed.emit();
      },
      error: (error: { error?: { message?: string } }) => {
        this.errorMessage.set(error.error?.message || this.i18n.translate('accounts.savingsGoalSaveFailed'));
      }
    });
  }

  private calculateMonthlyAmount(): number {
    const targetAmount = this.account().targetAmount ?? 0;
    const targetDateValue = this.account().targetDate;
    const targetDate = targetDateValue ? new Date(targetDateValue) : null;
    if (!targetDate || Number.isNaN(targetDate.getTime())) {
      return 0;
    }

    const remaining = Math.max(0, targetAmount - this.account().balance);
    const today = new Date();
    const months = Math.max(1, (targetDate.getFullYear() - today.getFullYear()) * 12 + (targetDate.getMonth() - today.getMonth()) - (targetDate.getDate() < today.getDate() ? 1 : 0));
    return remaining / months;
  }
}
