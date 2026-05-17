import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { CategoryDropdownComponent } from '../../../categories/components/category-dropdown/category-dropdown.component';
import { TranslationService } from '../../../../core/services/i18n/translation.service';
import { TransactionCategory, TransactionUserOption } from '../../models/transaction.model';

export type TransactionFilterType = 'INCOME' | 'EXPENSE' | 'TRANSFER';

export interface TransactionFiltersState {
  page: number;
  size: number;
  userId: number | null;
  userType: 'PARENT' | 'CHILD' | null;
  types: TransactionFilterType[];
  mainCategoryId: number | null;
  subCategoryId: number | null;
  fromDate: string;
  toDate: string;
}

export interface TransactionUserFilterGroup {
  value: number | '__parent__' | '__child__' | null;
  label: string;
  options: TransactionUserOption[];
}

type DateFieldKey = 'fromDate' | 'toDate';
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
  isDisabled: boolean;
}

@Component({
  selector: 'app-transaction-filters',
  standalone: true,
  imports: [CommonModule, CategoryDropdownComponent],
  templateUrl: './transaction-filters.component.html',
  styleUrl: './transaction-filters.component.css'
})
export class TransactionFiltersComponent {
  readonly i18n = inject(TranslationService);

  readonly filters = input.required<TransactionFiltersState>();
  readonly categories = input<TransactionCategory[]>([]);
  readonly users = input<TransactionUserOption[]>([]);
  readonly filterUsers = input<TransactionUserFilterGroup[]>([]);
  readonly currentUserRole = input<string | null>(null);
  readonly currentUserId = input<number | null>(null);
  readonly currentUserLabel = input<string>('');

  readonly filtersChange = output<TransactionFiltersState>();
  readonly clear = output<void>();

  readonly currentYear = new Date().getFullYear();
  readonly activeDatePicker = signal<DateFieldKey | null>(null);
  readonly calendarMode = signal<CalendarMode>('month');
  readonly calendarMonthAnchor = signal(new Date());
  readonly yearGridStart = signal(0);

  readonly userFilterValue = computed(() => {
    const f = this.filters();
    if (f.userType === 'PARENT') return '__parent__';
    if (f.userType === 'CHILD') return '__child__';
    return f.userId === null ? '' : String(f.userId);
  });

  readonly selectedUserLabel = computed(() => {
    const f = this.filters();
    if (f.userId === null || f.userType !== null) {
      return '';
    }

    if (this.currentUserId() === f.userId) {
      return this.currentUserLabel() || this.i18n.translate('statistics.currentUser');
    }

    return this.users().find((user) => user.id === f.userId)?.username ?? '';
  });

  readonly weekDayLabels = computed(() => {
    const fmt = new Intl.DateTimeFormat(this.i18n.language(), { weekday: 'short' });
    const base = new Date(2024, 0, 1);
    return Array.from({ length: 7 }, (_, index) => fmt.format(new Date(base.getFullYear(), base.getMonth(), base.getDate() + index)));
  });

  readonly yearOptions = computed<YearOption[]>(() => {
    const start = this.yearGridStart();
    return Array.from({ length: 12 }, (_, index) => ({ year: start + index }));
  });

  readonly monthTitle = computed(() =>
    new Intl.DateTimeFormat(this.i18n.language(), { month: 'long', year: 'numeric' }).format(this.calendarMonthAnchor())
  );

  readonly categoryDropdownDisabled = computed(() => this.filters().types.includes('TRANSFER'));
  onUserChange(value: number | string | null): void {
    if (value === '__parent__') {
      this.emitFilters({
        ...this.filters(),
        page: 0,
        userId: null,
        userType: 'PARENT'
      });
      return;
    }

    if (value === '__child__') {
      this.emitFilters({
        ...this.filters(),
        page: 0,
        userId: null,
        userType: 'CHILD'
      });
      return;
    }

    const parsed = value === null || value === '' ? null : Number(value);
    this.emitFilters({
      ...this.filters(),
      page: 0,
      userType: null,
      userId: parsed
    });
  }

  onCategorySelected(value: { mainId: number | null; subId: number | null }): void {
    this.emitFilters({
      ...this.filters(),
      page: 0,
      mainCategoryId: value.mainId,
      subCategoryId: value.subId
    });
  }

  onDateInput(field: DateFieldKey, value: string): void {
    if (value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      this.onDateChange(field, value);
    }
  }

  onDateChange(field: DateFieldKey, value: string): void {
    this.emitFilters({
      ...this.filters(),
      page: 0,
      [field]: value
    });
  }

  openDatePicker(field: DateFieldKey): void {
    this.activeDatePicker.set(field);
    this.calendarMode.set('month');
    this.calendarMonthAnchor.set(this.getCalendarAnchorDate(field));
    this.yearGridStart.set(this.getYearGridStart(this.calendarMonthAnchor().getFullYear()));
  }

  closeDatePicker(): void {
    this.activeDatePicker.set(null);
    this.calendarMode.set('month');
  }

  isDatePickerOpen(field: DateFieldKey): boolean {
    return this.activeDatePicker() === field;
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

  calendarDays(): CalendarDay[] {
    const anchor = this.calendarMonthAnchor();
    const currentDate = new Date();
    const selectedField = this.activeDatePicker();
    const selectedValue = selectedField ? this.filters()[selectedField] : '';
    const selectedIso = selectedValue || '';
    const year = anchor.getFullYear();
    const month = anchor.getMonth();
    const firstDayOfMonth = new Date(year, month, 1);
    const startDay = firstDayOfMonth.getDay();
    const offset = (startDay + 6) % 7;
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
        isToday: this.isSameDate(date, currentDate),
        isDisabled: false
      };
    });
  }

  selectCalendarDate(day: CalendarDay): void {
    if (!day.isCurrentMonth || day.isDisabled) {
      return;
    }

    const field = this.activeDatePicker();
    if (!field) {
      return;
    }

    this.onDateChange(field, day.date);
    this.closeDatePicker();
  }

  clearFilters(): void {
    this.clear.emit();
  }

  updateMainCategory(value: { mainId: number | null; subId: number | null }): void {
    this.onCategorySelected(value);
  }

  private emitFilters(filters: TransactionFiltersState): void {
    this.filtersChange.emit(filters);
  }

  private getCalendarAnchorDate(field: DateFieldKey): Date {
    const value = this.filters()[field];
    if (!value) {
      return new Date();
    }

    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  private getYearGridStart(year: number): number {
    return Math.max(1900, Math.floor(year / 12) * 12);
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
