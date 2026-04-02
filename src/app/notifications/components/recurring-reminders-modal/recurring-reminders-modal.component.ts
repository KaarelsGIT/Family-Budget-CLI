import { CommonModule } from '@angular/common';
import { Component, effect, inject, input, output, signal } from '@angular/core';
import { finalize } from 'rxjs';
import { TranslationService } from '../../../i18n/translation.service';
import { formatEuroAmount } from '../../../shared/utils/money-format';
import { RecurringReminderItem, RecurringReminderService } from '../../recurring-reminder.service';
import { TransactionDraftService } from '../../../features/transactions/services/transaction-draft.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-recurring-reminders-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './recurring-reminders-modal.component.html',
  styleUrl: './recurring-reminders-modal.component.css'
})
export class RecurringRemindersModalComponent {
  private readonly recurringReminderService = inject(RecurringReminderService);
  private readonly transactionDraftService = inject(TransactionDraftService);
  private readonly router = inject(Router);
  readonly i18n = inject(TranslationService);

  readonly isOpen = input(false);
  readonly highlightedReminderId = input<number | null>(null);
  readonly closed = output<void>();

  readonly reminders = signal<RecurringReminderItem[]>([]);
  readonly isLoading = signal(false);
  readonly errorMessage = signal('');

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        this.loadReminders();
        return;
      }

      this.errorMessage.set('');
    }, { allowSignalWrites: true });
  }

  close(): void {
    this.closed.emit();
  }

  trackByReminderId(_index: number, reminder: RecurringReminderItem): number {
    return reminder.id;
  }

  formatDueDate(value: string): string {
    return new Intl.DateTimeFormat(this.i18n.language(), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(new Date(value));
  }

  formatAmount(value: number | null): string {
    if (value === null) {
      return this.i18n.translate('recurringReminders.amountUnknown');
    }

    return formatEuroAmount(value, this.i18n.language());
  }

  pay(reminder: RecurringReminderItem): void {
    this.transactionDraftService.requestOpen({
      type: reminder.transactionType,
      categoryId: reminder.categoryId,
      accountId: reminder.accountId,
      amount: reminder.amount === null ? null : String(reminder.amount),
      transactionDate: this.getTodayDate(),
      comment: reminder.comment
    });
    this.closed.emit();
    this.router.navigateByUrl('/transactions');
  }

  skip(reminder: RecurringReminderItem): void {
    this.errorMessage.set('');

    this.recurringReminderService.skipReminder(reminder.id).subscribe({
      next: () => {
        this.reminders.update((items) => items.filter((item) => item.id !== reminder.id));
      },
      error: (error: { error?: { message?: string } }) => {
        this.errorMessage.set(error.error?.message || this.i18n.translate('recurringReminders.skipFailed'));
      }
    });
  }

  private loadReminders(): void {
    this.isLoading.set(true);
    this.errorMessage.set('');

    this.recurringReminderService.getReminders()
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: (reminders: RecurringReminderItem[]) => {
          this.reminders.set(reminders);
        },
        error: (error: { error?: { message?: string } }) => {
          this.reminders.set([]);
          this.errorMessage.set(error.error?.message || this.i18n.translate('recurringReminders.loadFailed'));
        }
      });
  }

  private getTodayDate(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
