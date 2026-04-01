import { CommonModule } from '@angular/common';
import { Component, HostListener, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { TranslationService } from '../../../../i18n/translation.service';
import { formatEuroAmount } from '../../../../shared/utils/money-format';
import { TransactionItem } from '../../models/transaction.model';
import { TransactionsService } from '../../services/transactions.service';

@Component({
  selector: 'app-edit-transaction-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './edit-transaction-modal.component.html',
  styleUrl: './edit-transaction-modal.component.css'
})
export class EditTransactionModalComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly transactionsService = inject(TransactionsService);
  readonly i18n = inject(TranslationService);

  readonly transaction = input.required<TransactionItem>();
  readonly closed = output<void>();
  readonly updated = output<void>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');
  readonly modalOffsetX = signal(0);
  readonly modalOffsetY = signal(0);

  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragOriginX = 0;
  private dragOriginY = 0;

  readonly form = this.formBuilder.nonNullable.group({
    amount: [0, [Validators.required, Validators.min(0.01)]],
    transactionDate: ['', Validators.required],
    comment: ['', [Validators.maxLength(500)]]
  });

  constructor() {
    effect(() => {
      const transaction = this.transaction();
      this.form.patchValue({
        amount: transaction.amount,
        transactionDate: transaction.transactionDate,
        comment: transaction.comment ?? ''
      }, { emitEvent: false });
      this.errorMessage.set('');
    });
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

    const { amount, transactionDate, comment } = this.form.getRawValue();
    const parsedAmount = Number(amount);
    const trimmedComment = (comment || '').trim();

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      this.errorMessage.set(this.i18n.translate('transactions.fillRequiredFields'));
      return;
    }

    this.errorMessage.set('');
    this.isSubmitting.set(true);

    this.transactionsService.updateTransaction(this.transaction().id, {
      amount: parsedAmount,
      transactionDate,
      comment: trimmedComment
    }).pipe(
      finalize(() => this.isSubmitting.set(false))
    ).subscribe({
      next: () => {
        this.updated.emit();
        this.closed.emit();
      },
      error: (error: { error?: { message?: string } }) => {
        this.errorMessage.set(this.resolveErrorMessage(error));
      }
    });
  }

  getTypeLabel(): string {
    switch (this.transaction().type) {
      case 'INCOME':
        return this.i18n.translate('transactions.typeIncome');
      case 'EXPENSE':
        return this.i18n.translate('transactions.typeExpense');
      default:
        return this.i18n.translate('transactions.typeTransfer');
    }
  }

  getAccountLabel(): string {
    const transaction = this.transaction();
    return transaction.type === 'INCOME'
      ? (transaction.toAccountName ?? '—')
      : (transaction.fromAccountName ?? '—');
  }

  formatCurrentAmount(): string {
    return formatEuroAmount(this.transaction().amount, this.i18n.language());
  }

  getModalTransform(): string {
    return `translate3d(${this.modalOffsetX()}px, ${this.modalOffsetY()}px, 0)`;
  }

  private resolveErrorMessage(error: { error?: { message?: string } }): string {
    const message = error.error?.message;
    if (
      message === 'Kontol ei ole piisavalt raha' ||
      message === 'Saldo ei tohi minna alla nulli!'
    ) {
      return this.i18n.translate('transactions.balanceWouldGoNegative');
    }

    return message || this.i18n.translate('transactions.editFailed');
  }
}
