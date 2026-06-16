import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, input, output, signal, HostListener } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { TranslationService } from '../../../../core/services/i18n/translation.service';
import { Account } from '../../models/account.model';
import { AccountService, FamilySavingsSelection } from '../../services/account.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { parseMoneyInput } from '../../../shared/utils/money-format';

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

interface SelectableFamilySavingsAccount extends Account {}

@Component({
  selector: 'app-family-savings-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './family-savings-modal.component.html',
  styleUrl: './family-savings-modal.component.css'
})
export class FamilySavingsModalComponent implements OnInit {
  private readonly accountService = inject(AccountService);
  private readonly authService = inject(AuthService);
  private readonly formBuilder = inject(FormBuilder);
  readonly i18n = inject(TranslationService);

  readonly accounts = input<SelectableFamilySavingsAccount[]>([]);
  readonly selectedAccountIds = input<number[]>([]);
  readonly targetAmount = input<number | null>(null);
  readonly targetDate = input<string | null>(null);
  readonly closed = output<void>();
  readonly saved = output<FamilySavingsSelection>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');
  readonly pendingSelection = signal<number[]>([]);

  readonly activeDatePicker = signal(false);
  readonly calendarMode = signal<CalendarMode>('month');
  readonly calendarMonthAnchor = signal(new Date());
  readonly yearGridStart = signal(0);

  readonly form = this.formBuilder.nonNullable.group({
    targetAmount: [0 as number | string, [Validators.required]],
    targetDate: ['', [Validators.required]]
  });

  ngOnInit(): void {
    this.pendingSelection.set(this.selectedAccountIds());
    this.form.patchValue({
      targetAmount: this.targetAmount() ?? 0,
      targetDate: this.targetDate() ?? ''
    });
    this.calendarMonthAnchor.set(this.getCalendarAnchorDate());
    this.yearGridStart.set(this.getYearGridStart(this.calendarMonthAnchor().getFullYear()));
  }

  isAccountDisabled(account: SelectableFamilySavingsAccount): boolean {
    return account.ownerId !== this.authService.getUserId();
  }

  close(): void {
    this.closed.emit();
  }

  isSelected(accountId: number): boolean {
    return this.pendingSelection().includes(accountId);
  }

  toggle(accountId: number, checked: boolean): void {
    const next = checked
      ? Array.from(new Set([...this.pendingSelection(), accountId]))
      : this.pendingSelection().filter((id) => id !== accountId);
    this.pendingSelection.set(next);
  }

  save(): void {
    if (this.isSubmitting()) {
      return;
    }

    const { targetAmount, targetDate } = this.form.getRawValue();
    const parsedAmount = typeof targetAmount === 'string' ? parseMoneyInput(targetAmount) : targetAmount;

    this.isSubmitting.set(true);
    this.errorMessage.set('');

    const request: FamilySavingsSelection = {
      selectedAccountIds: this.pendingSelection(),
      targetAmount: parsedAmount > 0 ? parsedAmount : null,
      targetDate: targetDate || null
    };

    this.accountService.updateFamilySavingsSelection(request)
      .pipe(finalize(() => this.isSubmitting.set(false)))
      .subscribe({
        next: (selection) => {
          this.saved.emit(selection);
          this.closed.emit();
        },
        error: (error: { error?: { message?: string } }) => {
          this.errorMessage.set(error.error?.message || 'Salvestamine ebaõnnestus.');
        }
      });
  }

  // Date picker logic copied from savings-goal-modal
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
}
