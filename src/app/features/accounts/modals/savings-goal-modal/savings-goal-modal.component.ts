import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { TranslationService } from '../../../../core/services/i18n/translation.service';
import { Account } from '../../models/account.model';
import { AccountService } from '../../services/account.service';
import { formatMoney, parseMoneyInput } from '../../../shared/utils/money-format';

type CalendarMode = 'month' | 'year';

interface YearOption {
  year: number;
}

interface CalendarDay {
  date: string;
  label: number;
  isCurrentMonth: boolean;
  isSelected: boolean;
  isToday: boolean;
}

@Component({
  selector: 'app-savings-goal-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './savings-goal-modal.component.html',
  styleUrl: './savings-goal-modal.component.css'
})
export class SavingsGoalModalComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly accountService = inject(AccountService);
  readonly i18n = inject(TranslationService);

  readonly account = input.required<Account>();
  readonly closed = output<void>();
  readonly updated = output<void>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');
  readonly activeDatePicker = signal(false);
  readonly calendarMode = signal<CalendarMode>('month');
  readonly calendarMonthAnchor = signal(new Date());
  readonly yearGridStart = signal(0);
  readonly modalOffsetX = signal(0);
  readonly modalOffsetY = signal(0);
  readonly animatedProgress = signal(0);

  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragOriginX = 0;
  private dragOriginY = 0;

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
    this.calendarMonthAnchor.set(this.getCalendarAnchorDate());
    this.yearGridStart.set(this.getYearGridStart(this.calendarMonthAnchor().getFullYear()));
    this.animateProgressRing();
  }

  close(): void {
    this.closed.emit();
  }

  getModalTransform(): string {
    return `translate(${this.modalOffsetX()}px, ${this.modalOffsetY()}px)`;
  }

  formatMoney(value: number): string {
    return formatMoney(value);
  }

  formatDate(value: string | null | undefined): string {
    if (!value) {
      return '-';
    }
    const parsed = new Date(`${value}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat(this.i18n.language(), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(parsed);
  }

  normalizeMoneyInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (input) {
      input.value = input.value.replace(/,/g, '.');
    }
  }

  openDatePicker(): void {
    this.activeDatePicker.set(true);
    this.calendarMode.set('month');
    this.calendarMonthAnchor.set(this.getCalendarAnchorDate());
    this.yearGridStart.set(this.getYearGridStart(this.calendarMonthAnchor().getFullYear()));
    requestAnimationFrame(() => this.repositionDatePicker());
  }

  closeDatePicker(): void {
    this.activeDatePicker.set(false);
    this.calendarMode.set('month');
  }

  toggleCalendarYearMode(): void {
    this.calendarMode.update((mode) => mode === 'month' ? 'year' : 'month');
    if (this.calendarMode() === 'year') {
      this.yearGridStart.set(this.getYearGridStart(this.calendarMonthAnchor().getFullYear()));
    }
  }

  previousCalendarMonth(): void {
    this.calendarMonthAnchor.update((date) => new Date(date.getFullYear(), date.getMonth() - 1, 1));
  }

  nextCalendarMonth(): void {
    this.calendarMonthAnchor.update((date) => new Date(date.getFullYear(), date.getMonth() + 1, 1));
  }

  selectCalendarYear(year: number): void {
    this.calendarMonthAnchor.update((date) => new Date(year, date.getMonth(), 1));
    this.calendarMode.set('month');
  }

  changeYearGrid(offset: number): void {
    this.yearGridStart.update((start) => start + offset);
  }

  selectCalendarDate(day: CalendarDay): void {
    if (!day.isCurrentMonth) {
      return;
    }

    this.form.patchValue({ targetDate: day.date });
    this.closeDatePicker();
  }

  getDisplayedTargetDate(): string {
    return this.formatDate(this.form.controls.targetDate.value);
  }

  isDatePickerOpen(): boolean {
    return this.activeDatePicker();
  }

  monthTitle(): string {
    return new Intl.DateTimeFormat(this.i18n.language(), { month: 'long', year: 'numeric' }).format(this.calendarMonthAnchor());
  }

  yearOptions(): YearOption[] {
    const start = this.yearGridStart();
    return Array.from({ length: 12 }, (_, index) => ({ year: start + index }));
  }

  calendarDays(): CalendarDay[] {
    const anchor = this.calendarMonthAnchor();
    const currentDate = new Date();
    const selectedIso = this.form.controls.targetDate.value;
    const year = anchor.getFullYear();
    const month = anchor.getMonth();
    const firstDayOfMonth = new Date(year, month, 1);
    const offset = (firstDayOfMonth.getDay() + 6) % 7;
    const startDate = new Date(year, month, 1 - offset);

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + index);
      const iso = this.toIsoDate(date);
      return {
        date: iso,
        label: date.getDate(),
        isCurrentMonth: date.getMonth() === month,
        isSelected: iso === selectedIso,
        isToday: this.isSameDate(date, currentDate)
      };
    });
  }

  weekDayLabels(): string[] {
    const fmt = new Intl.DateTimeFormat(this.i18n.language(), { weekday: 'short' });
    const base = new Date(2024, 0, 1);
    return Array.from({ length: 7 }, (_, index) => fmt.format(new Date(base.getFullYear(), base.getMonth(), base.getDate() + index)));
  }

  @HostListener('document:click', ['$event'])
  handleDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target?.closest('.date-picker-trigger') && !target?.closest('.date-picker-shell')) {
      this.closeDatePicker();
    }
  }

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    this.close();
  }

  startDrag(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }

    this.dragging = true;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.dragOriginX = this.modalOffsetX();
    this.dragOriginY = this.modalOffsetY();
    (event.currentTarget as HTMLElement | null)?.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  onDragMove(event: PointerEvent): void {
    if (!this.dragging) {
      return;
    }

    this.modalOffsetX.set(this.dragOriginX + (event.clientX - this.dragStartX));
    this.modalOffsetY.set(this.dragOriginY + (event.clientY - this.dragStartY));
  }

  stopDrag(event: PointerEvent): void {
    if (!this.dragging) {
      return;
    }

    this.dragging = false;
    (event.currentTarget as HTMLElement | null)?.releasePointerCapture(event.pointerId);
  }

  private getCalendarAnchorDate(): Date {
    const value = this.form.controls.targetDate.value;
    if (!value) {
      return new Date();
    }

    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  private getYearGridStart(year: number): number {
    return Math.max(1900, Math.floor(year / 12) * 12);
  }

  private repositionDatePicker(): void {
    const shell = document.querySelector('.date-picker-shell') as HTMLElement | null;
    const trigger = document.querySelector('.date-picker-trigger') as HTMLElement | null;
    if (!shell || !trigger) {
      return;
    }

    const triggerRect = trigger.getBoundingClientRect();
    shell.style.position = 'fixed';
    shell.style.left = `${Math.max(8, Math.min(triggerRect.left, window.innerWidth - 340))}px`;
    shell.style.top = `${triggerRect.bottom + 8}px`;
    shell.style.bottom = 'auto';
    shell.style.display = 'block';
    shell.style.visibility = 'visible';
    shell.style.pointerEvents = 'auto';

    const shellRect = shell.getBoundingClientRect();
    if (shellRect.bottom > window.innerHeight) {
      shell.style.top = `${Math.max(8, triggerRect.top - shellRect.height - 8)}px`;
    }

    if (shell.getBoundingClientRect().right > window.innerWidth) {
      shell.style.left = `${Math.max(8, window.innerWidth - shellRect.width - 8)}px`;
    }
  }

  private toIsoDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private isSameDate(left: Date, right: Date): boolean {
    return left.getFullYear() === right.getFullYear()
      && left.getMonth() === right.getMonth()
      && left.getDate() === right.getDate();
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
    const targetDate = targetDateValue ? new Date(`${targetDateValue}T00:00:00`) : null;
    if (!targetDate || Number.isNaN(targetDate.getTime()) || targetAmount <= 0) {
      return 0;
    }

    const remaining = Math.max(0, targetAmount - this.account().balance);
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const end = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    const diffDays = Math.ceil((end.getTime() - start.getTime()) / 86_400_000);
    if (diffDays <= 0) {
      return 0;
    }

    const months = Math.max(1, Math.ceil(diffDays / 30.42));
    return remaining / months;
  }

  private animateProgressRing(): void {
    this.animatedProgress.set(0);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.animatedProgress.set(this.progress());
      });
    });
  }
}
