import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../../../../auth/auth.service';
import { TranslationService } from '../../../../i18n/translation.service';
import { formatMoney } from '../../../../shared/utils/money-format';
import { TransactionCategory } from '../../models/transaction.model';
import { RecurringPaymentModalComponent } from '../../components/recurring-payment-modal/recurring-payment-modal.component';
import { RecurringPaymentItem, RecurringPaymentService } from '../../services/recurring-payment.service';
import { TransactionsService } from '../../services/transactions.service';

@Component({
  selector: 'app-recurring-payments-page',
  standalone: true,
  imports: [CommonModule, RouterLink, RecurringPaymentModalComponent],
  templateUrl: './recurring-payments-page.component.html',
  styleUrl: './recurring-payments-page.component.css'
})
export class RecurringPaymentsPageComponent {
  private readonly recurringPaymentService = inject(RecurringPaymentService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly authService = inject(AuthService);
  readonly i18n = inject(TranslationService);

  readonly currentUserId = this.authService.getUserId();
  readonly currentUserRole = this.authService.getRole();

  readonly payments = signal<RecurringPaymentItem[]>([]);
  readonly categories = signal<TransactionCategory[]>([]);
  readonly isLoading = signal(false);
  readonly errorMessage = signal('');
  readonly totalItems = signal(0);
  readonly isModalOpen = signal(false);
  readonly selectedPayment = signal<RecurringPaymentItem | null>(null);
  readonly pendingPaymentId = signal<number | null>(null);

  readonly recurringCategoryOptions = computed(() =>
    this.categories()
      .filter((category) => category.type === 'EXPENSE' && category.parentCategoryId === null)
      .map((category) => ({
        id: category.id,
        label: category.name
      }))
  );

  readonly hasRecurringCategoryOptions = computed(() => this.recurringCategoryOptions().length > 0);
  readonly totalAmount = computed(() =>
    this.payments()
      .filter((payment) => payment.active)
      .reduce((sum, payment) => sum + payment.amount, 0)
  );

  constructor() {
    this.loadCategories();
    this.loadPayments();
  }

  trackByPaymentId(_index: number, payment: RecurringPaymentItem): number {
    return payment.id;
  }

  trackByCategoryId(_index: number, option: { id: number }): number {
    return option.id;
  }

  loadPayments(): void {
    this.isLoading.set(true);
    this.errorMessage.set('');

    this.recurringPaymentService.getRecurringPayments()
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: (response) => {
          this.payments.set(response.data);
          this.totalItems.set(response.total);
        },
        error: (error: { error?: { message?: string } }) => {
          this.payments.set([]);
          this.totalItems.set(0);
          this.errorMessage.set(error.error?.message || this.i18n.translate('recurringPayments.loadFailed'));
        }
      });
  }

  loadCategories(): void {
    this.transactionsService.getCategories()
      .subscribe({
        next: (categories) => {
          this.categories.set(categories);
        },
        error: () => {
          this.categories.set([]);
        }
      });
  }

  formatAmount(amount: number): string {
    return formatMoney(amount);
  }

  formatStatusLabel(payment: RecurringPaymentItem): string {
    return payment.currentMonthStatus.paid
      ? this.i18n.translate('recurringPayments.statusPaid')
      : this.i18n.translate('recurringPayments.statusPending');
  }

  getStatusClass(payment: RecurringPaymentItem): string {
    return payment.currentMonthStatus.paid ? 'status-paid' : 'status-pending';
  }

  canManagePayment(payment: RecurringPaymentItem): boolean {
    return this.currentUserRole === 'ADMIN' || payment.ownerId === this.currentUserId;
  }

  openCreateModal(): void {
    if (!this.hasRecurringCategoryOptions()) {
      return;
    }

    this.selectedPayment.set(null);
    this.isModalOpen.set(true);
  }

  openEditModal(payment: RecurringPaymentItem): void {
    if (!this.canManagePayment(payment)) {
      return;
    }

    this.selectedPayment.set(payment);
    this.isModalOpen.set(true);
  }

  closeModal(): void {
    this.isModalOpen.set(false);
    this.selectedPayment.set(null);
  }

  handlePaymentSaved(): void {
    this.closeModal();
    this.loadPayments();
  }

  toggleActive(payment: RecurringPaymentItem): void {
    if (!this.canManagePayment(payment)) {
      return;
    }

    this.pendingPaymentId.set(payment.id);
    this.recurringPaymentService.updateRecurringPayment(payment.id, { active: !payment.active })
      .pipe(finalize(() => this.pendingPaymentId.set(null)))
      .subscribe({
        next: () => {
          this.loadPayments();
        },
        error: (error: { error?: { message?: string } }) => {
          this.errorMessage.set(error.error?.message || this.i18n.translate('recurringPayments.saveFailed'));
        }
      });
  }

  isPending(payment: RecurringPaymentItem): boolean {
    return this.pendingPaymentId() === payment.id;
  }
}
