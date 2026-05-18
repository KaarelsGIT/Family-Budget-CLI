import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, ViewChild, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { TranslationService } from '../../../../core/services/i18n/translation.service';
import { Account } from '../../models/account.model';
import { AccountBalanceAdjustment, AccountService } from '../../services/account.service';
import { CalculatorComponent } from '../../../shared/modals/calculator-modal/calculator.component';
import { formatMoney, parseMoneyInput } from '../../../shared/utils/money-format';

@Component({
  selector: 'app-adjust-balance-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CalculatorComponent],
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
  readonly recentAdjustments = signal<AccountBalanceAdjustment[]>([]);
  readonly isLoadingAdjustments = signal(false);
  readonly isCalculatorVisible = signal(false);
  @ViewChild('modalCard') private modalCard?: ElementRef<HTMLElement>;
  readonly modalOffsetX = signal(0);
  readonly modalOffsetY = signal(0);

  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragOriginX = 0;
  private dragOriginY = 0;

  readonly form = this.formBuilder.nonNullable.group({
    amount: [0, [Validators.required]],
    comment: ['', [Validators.required, Validators.maxLength(500)]]
  });

  close(): void {
    this.isCalculatorVisible.set(false);
    this.closed.emit();
  }

  ngOnInit(): void {
    this.loadRecentAdjustments();
  }

  ngAfterViewInit(): void {
    queueMicrotask(() => this.modalCard?.nativeElement.focus());
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

  openCalculator(): void {
    this.isCalculatorVisible.set(true);
  }

  closeCalculator(): void {
    this.isCalculatorVisible.set(false);
  }

  formatBalance(value: number): string {
    return formatMoney(value);
  }

  handleEscape(): void {
    if (this.isCalculatorVisible()) {
      this.closeCalculator();
      return;
    }

    this.close();
  }

  handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.handleEscape();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      this.submit();
    }
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
        this.loadRecentAdjustments();
        this.adjusted.emit();
        this.form.patchValue({ amount: 0, comment: '' }, { emitEvent: false });
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

  formatAdjustmentAmount(value: number): string {
    return formatMoney(value);
  }

  formatAdjustmentDate(value: string): string {
    return new Date(value).toLocaleString(this.i18n.language(), {
      dateStyle: 'short',
      timeStyle: 'short'
    });
  }

  getModalTransform(): string {
    return `translate3d(${this.modalOffsetX()}px, ${this.modalOffsetY()}px, 0)`;
  }

  private loadRecentAdjustments(): void {
    this.isLoadingAdjustments.set(true);
    this.accountService.getRecentBalanceAdjustments(this.account().id).pipe(
      finalize(() => this.isLoadingAdjustments.set(false))
    ).subscribe({
      next: (adjustments) => {
        this.recentAdjustments.set(adjustments.slice(0, 5));
      },
      error: () => {
        this.recentAdjustments.set([]);
      }
    });
  }
}
