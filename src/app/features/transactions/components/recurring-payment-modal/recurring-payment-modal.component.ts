import { CommonModule } from '@angular/common';
import { Component, HostListener, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { TranslationService } from '../../../../i18n/translation.service';
import { RecurringPaymentItem, RecurringPaymentPayload, RecurringPaymentService } from '../../services/recurring-payment.service';
import { TransactionCategory } from '../../models/transaction.model';
import { parseMoneyInput } from '../../../../shared/utils/money-format';

@Component({
  selector: 'app-recurring-payment-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './recurring-payment-modal.component.html',
  styleUrl: './recurring-payment-modal.component.css'
})
export class RecurringPaymentModalComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly recurringPaymentService = inject(RecurringPaymentService);
  readonly i18n = inject(TranslationService);

  readonly isOpen = input(false);
  readonly payment = input<RecurringPaymentItem | null>(null);
  readonly categories = input<TransactionCategory[]>([]);
  readonly closed = output<void>();
  readonly saved = output<void>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');
  readonly modalOffsetX = signal(0);
  readonly modalOffsetY = signal(0);

  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragOriginX = 0;
  private dragOriginY = 0;

  readonly categoryOptions = computed(() =>
    this.categories()
      .filter((category) => category.type === 'EXPENSE' && category.parentCategoryId === null)
      .map((category) => ({
        id: category.id,
        label: category.name
      }))
  );

  readonly displayedCategoryOptions = computed(() => {
    const options = [...this.categoryOptions()];
    const payment = this.payment();
    if (!payment) {
      return options;
    }

    if (options.some((option) => option.id === payment.categoryId)) {
      return options;
    }

    const category = this.categories().find((item) => item.id === payment.categoryId);
    if (!category) {
      return options;
    }

    return [...options, {
      id: category.id,
      label: category.name
    }];
  });

  readonly form = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    categoryId: [0, [Validators.required, Validators.min(1)]],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    dueDay: [1, [Validators.required, Validators.min(1), Validators.max(31)]],
    active: [true]
  });

  constructor() {
    effect(() => {
      this.payment();
      this.categories();

      if (!this.isOpen()) {
        this.errorMessage.set('');
        this.modalOffsetX.set(0);
        this.modalOffsetY.set(0);
        return;
      }

      this.initializeForm();
    }, { allowSignalWrites: true });
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

    if (this.categoryOptions().length === 0) {
      this.errorMessage.set(this.i18n.translate('recurringPayments.noEligibleCategories'));
      return;
    }

    const { name, categoryId, amount, dueDay, active } = this.form.getRawValue();
    const trimmedName = name.trim();
    const parsedCategoryId = Number(categoryId);
    const parsedAmount = parseMoneyInput(amount);
    const parsedDueDay = Number(dueDay);

    if (!trimmedName) {
      this.errorMessage.set(this.i18n.translate('categories.nameRequired'));
      return;
    }
    if (!Number.isFinite(parsedCategoryId) || parsedCategoryId < 1) {
      this.errorMessage.set(this.i18n.translate('recurringPayments.categoryRequired'));
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      this.errorMessage.set(this.i18n.translate('recurringPayments.amountInvalid'));
      return;
    }
    if (!Number.isInteger(parsedDueDay) || parsedDueDay < 1 || parsedDueDay > 31) {
      this.errorMessage.set(this.i18n.translate('recurringPayments.dueDayInvalid'));
      return;
    }

    const payload: RecurringPaymentPayload = {
      name: trimmedName,
      categoryId: parsedCategoryId,
      amount: parsedAmount,
      dueDay: parsedDueDay,
      active: Boolean(active)
    };

    this.errorMessage.set('');
    this.isSubmitting.set(true);

    const request$ = this.payment()
      ? this.recurringPaymentService.updateRecurringPayment(this.payment()!.id, payload)
      : this.recurringPaymentService.createRecurringPayment(payload);

    request$
      .pipe(finalize(() => this.isSubmitting.set(false)))
      .subscribe({
        next: () => {
          this.saved.emit();
          this.closed.emit();
        },
        error: (error: { error?: { message?: string } }) => {
          this.errorMessage.set(this.resolveErrorMessage(error));
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

  isEditMode(): boolean {
    return this.payment() !== null;
  }

  trackByCategoryId(_index: number, option: { id: number }): number {
    return option.id;
  }

  getModalTransform(): string {
    return `translate3d(${this.modalOffsetX()}px, ${this.modalOffsetY()}px, 0)`;
  }

  private initializeForm(): void {
    const payment = this.payment();
    const selectedCategoryId = payment?.categoryId ?? 0;

    if (payment) {
      this.form.patchValue({
        name: payment.name,
        categoryId: selectedCategoryId,
        amount: payment.amount,
        dueDay: payment.dueDay,
        active: payment.active
      }, { emitEvent: false });
    } else {
      this.form.patchValue({
        name: '',
        categoryId: 0,
        amount: '' as unknown as number,
        dueDay: '' as unknown as number,
        active: true
      }, { emitEvent: false });
    }

    this.errorMessage.set('');
  }

  private resolveErrorMessage(error: { error?: { message?: string } }): string {
    const message = error.error?.message;
    if (message === 'Recurring payment already exists for this category') {
      return this.i18n.translate('recurringPayments.alreadyExists');
    }
    if (message === 'Category is required') {
      return this.i18n.translate('recurringPayments.categoryRequired');
    }
    if (message === 'Due day must be between 1 and 31') {
      return this.i18n.translate('recurringPayments.dueDayInvalid');
    }
    if (message === 'Recurring payments must use expense categories' || message === 'Recurring payments must use subcategories') {
      return this.i18n.translate('recurringPayments.categoryInvalid');
    }

    return message || (this.payment() ? this.i18n.translate('recurringPayments.saveFailed') : this.i18n.translate('recurringPayments.createFailed'));
  }
}
