import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize, forkJoin } from 'rxjs';
import { AuthService } from '../../../../auth/auth.service';
import { TranslationService } from '../../../../i18n/translation.service';
import { Account } from '../../../accounts/models/account.model';
import { AccountService, SelectableUser } from '../../../accounts/services/account.service';
import { formatEuroAmount } from '../../../../shared/utils/money-format';
import { CategoryTableComponent, CategoryTableNode } from '../../components/category-table/category-table.component';
import {
  StatisticsService,
  YearlyStatisticsMonthlyEntry,
  YearlyStatisticsResponse,
  YearlyStatisticsCategoryEntry
} from '../../services/statistics.service';

type CategoryTab = 'income' | 'expenses';

interface MonthlyBarGroup {
  month: number;
  label: string;
  incomeHeight: number;
  expenseHeight: number;
  incomeY: number;
  expenseY: number;
  incomeValue: number;
  expenseValue: number;
}

interface LinePoint {
  month: number;
  label: string;
  x: number;
  y: number;
  value: number;
}

interface PieSlice {
  label: string;
  color: string;
  path: string;
  percent: number;
  total: number;
}

interface ChartTick {
  value: number;
  y: number;
  label: string;
}

@Component({
  selector: 'app-statistics-page',
  standalone: true,
  imports: [CommonModule, FormsModule, CategoryTableComponent],
  templateUrl: './statistics-page.component.html',
  styleUrl: './statistics-page.component.css'
})
export class StatisticsPageComponent {
  private readonly statisticsService = inject(StatisticsService);
  private readonly accountService = inject(AccountService);
  private readonly authService = inject(AuthService);
  readonly i18n = inject(TranslationService);

  readonly currentYear = new Date().getFullYear();
  readonly currentUserId = this.authService.getUserId();
  readonly currentUserRole = this.authService.getRole();
  readonly selectedYear = signal(this.currentYear);
  readonly selectedUserId = signal<number | null>(this.currentUserId);
  readonly selectedAccountId = signal<number | null>(null);
  readonly selectedCategoryTab = signal<CategoryTab>('expenses');
  readonly isLoading = signal(false);
  readonly isLoadingAccounts = signal(false);
  readonly isLoadingUsers = signal(false);
  readonly errorMessage = signal('');
  readonly statistics = signal<YearlyStatisticsResponse | null>(null);
  readonly accounts = signal<Account[]>([]);
  readonly selectableUsers = signal<SelectableUser[]>([]);

  readonly yearOptions = computed(() => {
    const years: number[] = [];
    for (let year = 2100; year >= 1900; year--) {
      years.push(year);
    }
    return years;
  });

  readonly userOptions = computed(() => this.selectableUsers());

  readonly accountOptions = computed(() => {
    return [...this.accounts()].sort((left, right) => left.name.localeCompare(right.name));
  });

  readonly showUserFilter = computed(() => this.userOptions().length > 0);

  readonly monthlyBars = computed(() => this.buildMonthlyBars());
  readonly monthlyChartTicks = computed(() => this.buildMonthlyTicks());
  readonly savingsLine = computed(() => this.buildSavingsLine());
  readonly savingsChartTicks = computed(() => this.buildSavingsTicks());
  readonly categoryPieSlices = computed(() => this.buildCategoryPieSlices());
  readonly categoryGroups = computed(() => this.buildCategoryGroups());
  readonly categoryTableCategories = computed(() => this.buildCategoryTableCategories());
  readonly hasStatisticsData = computed(() => {
    const statistics = this.statistics();
    if (!statistics) {
      return false;
    }

    return statistics.totals.income !== 0
      || statistics.totals.expenses !== 0
      || statistics.totals.savings !== 0
      || statistics.monthly.some((month) => month.income !== 0 || month.expenses !== 0 || month.savings !== 0)
      || statistics.categories.income.length > 0
      || statistics.categories.expenses.length > 0;
  });

  constructor() {
    this.loadFilterOptions();
    this.loadStatistics();
  }

  onYearChange(value: number | string): void {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1900 || parsed > 2100) {
      return;
    }

    this.selectedYear.set(parsed);
    this.loadStatistics();
  }

  onUserChange(value: number | string | null): void {
    const parsed = value === null || value === '' ? null : Number(value);
    this.selectedUserId.set(parsed);
    this.loadStatistics();
  }

  onAccountChange(value: number | string | null): void {
    this.selectedAccountId.set(value === null || value === '' ? null : Number(value));
    this.loadStatistics();
  }

  setCategoryTab(tab: CategoryTab): void {
    this.selectedCategoryTab.set(tab);
  }

  formatAmount(value: number): string {
    return formatEuroAmount(value, this.i18n.language());
  }

  formatPercent(value: number): string {
    return `${value.toFixed(1)} %`;
  }

  formatMonth(month: number): string {
    return new Intl.DateTimeFormat(this.i18n.language(), { month: 'short' }).format(new Date(this.selectedYear(), month - 1, 1));
  }

  formatAccountLabel(account: Account): string {
    return `${account.ownerUsername} · ${account.name}`;
  }

  formatUserLabel(user: SelectableUser): string {
    return user.id === this.currentUserId
      ? `${user.username} (${this.i18n.translate('statistics.currentUser')})`
      : user.username;
  }

  trackByAccountId(_index: number, account: Account): number {
    return account.id;
  }

  trackByMonth(_index: number, item: MonthlyBarGroup): number {
    return item.month;
  }

  trackByLinePoint(_index: number, item: LinePoint): number {
    return item.month;
  }

  trackByPieSlice(_index: number, slice: PieSlice): string {
    return `${slice.label}-${slice.total}`;
  }

  trackByTick(_index: number, tick: ChartTick): number {
    return tick.value;
  }

  private loadFilterOptions(): void {
    this.isLoadingAccounts.set(true);
    this.isLoadingUsers.set(true);

    forkJoin({
      accounts: this.accountService.getAccounts(),
      users: this.accountService.getFilterUsers()
    }).pipe(finalize(() => {
      this.isLoadingAccounts.set(false);
      this.isLoadingUsers.set(false);
    })).subscribe({
      next: ({ accounts, users }) => {
        this.accounts.set(accounts);
        this.selectableUsers.set(users);
      },
      error: () => {
        this.accounts.set([]);
        this.selectableUsers.set([]);
      }
    });
  }

  private loadStatistics(): void {
    this.isLoading.set(true);
    this.errorMessage.set('');

    this.statisticsService.getYearly(this.selectedYear(), this.selectedUserId(), this.selectedAccountId())
      .pipe(finalize(() => {
        this.isLoading.set(false);
      }))
      .subscribe({
        next: (statistics) => {
          this.statistics.set(statistics);
        },
        error: (error: { error?: { message?: string } }) => {
          this.statistics.set(null);
          this.errorMessage.set(error.error?.message || this.i18n.translate('statistics.loadFailed'));
        }
      });
  }

  private buildCategoryGroups(): YearlyStatisticsCategoryEntry[] {
    const groups = this.statistics()?.categories[this.selectedCategoryTab()] ?? [];
    return [...groups]
      .map((group) => ({
        parentCategory: group.parentCategory,
        total: group.total,
        monthly: group.monthly,
        subcategories: [...group.subcategories]
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((subcategory) => ({
            ...subcategory,
            monthly: subcategory.monthly
          }))
      }))
      .sort((left, right) => left.parentCategory.localeCompare(right.parentCategory));
  }

  private buildCategoryTableCategories(): CategoryTableNode[] {
    return this.buildCategoryGroups().map((group) => this.mapCategoryNode(group));
  }

  private mapCategoryNode(group: YearlyStatisticsCategoryEntry): CategoryTableNode {
    return {
      name: group.parentCategory,
      total: group.total,
      monthly: group.monthly,
      subcategories: group.subcategories.map((subcategory) => ({
        name: subcategory.name,
        total: subcategory.total,
        monthly: subcategory.monthly,
        subcategories: []
      }))
    };
  }

  private buildMonthlyBars(): MonthlyBarGroup[] {
    const monthly = this.monthlyByNumber();
    const maxValue = this.monthlyChartMax();

    const chartHeight = 180;
    const baseline = 200;

    return monthly.map((entry) => ({
      month: entry.month,
      label: this.formatMonth(entry.month),
      incomeValue: entry.income,
      expenseValue: entry.expenses,
      incomeHeight: (entry.income / maxValue) * chartHeight,
      expenseHeight: (entry.expenses / maxValue) * chartHeight,
      incomeY: baseline - ((entry.income / maxValue) * chartHeight),
      expenseY: baseline - ((entry.expenses / maxValue) * chartHeight)
    }));
  }

  private buildMonthlyTicks(): ChartTick[] {
    const rawMax = this.monthlyChartRawMax();
    if (rawMax <= 0) {
      return [{
        value: 0,
        y: 200,
        label: this.formatAmount(0)
      }];
    }

    const max = this.monthlyChartMax();
    const chartHeight = 180;
    const baseline = 200;
    const steps = 4;

    return Array.from({ length: steps + 1 }, (_, index) => {
      const value = (max / steps) * index;
      return {
        value,
        y: baseline - ((value / max) * chartHeight),
        label: this.formatAmount(value)
      };
    }).reverse();
  }

  private buildSavingsLine(): { points: string; dots: LinePoint[]; min: number; max: number } {
    const monthly = this.monthlyByNumber();
    const { min, max } = this.savingsChartBounds();
    const range = max - min || 1;
    const width = 540;
    const height = 170;
    const leftPadding = 40;
    const pointSpacing = width / 11;

    const dots = monthly.map((entry, index) => {
      const x = leftPadding + index * pointSpacing;
      const y = 190 - (((entry.savings - min) / range) * height);
      return {
        month: entry.month,
        label: this.formatMonth(entry.month),
        x,
        y,
        value: entry.savings
      };
    });

    const points = dots.map((dot) => `${dot.x},${dot.y}`).join(' ');
    return { points, dots, min, max };
  }

  private buildSavingsTicks(): ChartTick[] {
    const { min, max } = this.savingsChartBounds();
    const chartHeight = 170;
    const baseline = 190;

    if (min === 0 && max === 0) {
      return [{
        value: 0,
        y: baseline,
        label: this.formatAmount(0)
      }];
    }

    const steps = 4;
    const range = max - min || 1;

    return Array.from({ length: steps + 1 }, (_, index) => {
      const value = min + (range * index / steps);
      return {
        value,
        y: baseline - (((value - min) / range) * chartHeight),
        label: this.formatAmount(value)
      };
    }).reverse();
  }

  private buildCategoryPieSlices(): PieSlice[] {
    const groups = this.categoryGroups();
    const total = groups.reduce((sum, group) => sum + Math.max(0, group.total), 0);
    if (total <= 0) {
      return [];
    }

    const colors = ['#2f7d46', '#3f9155', '#52a363', '#68b372', '#7cc07f', '#99cd93', '#b2d5ab'];
    let currentAngle = -90;

    return groups.flatMap((group, index) => {
      const value = Math.max(0, group.total);
      if (value <= 0) {
        return [];
      }

      const sweep = (value / total) * 360;
      const path = groups.filter((candidate) => Math.max(0, candidate.total) > 0).length === 1
        ? this.describeFullPieSlice(50, 50, 42)
        : this.describePieSlice(50, 50, 42, currentAngle, currentAngle + sweep);
      const slice = {
        label: group.parentCategory,
        color: colors[index % colors.length],
        path,
        percent: (value / total) * 100,
        total: value
      };
      currentAngle += sweep;
      return [slice];
    });
  }

  private monthlyByNumber(): YearlyStatisticsMonthlyEntry[] {
    const map = new Map<number, YearlyStatisticsMonthlyEntry>();
    for (const month of this.statistics()?.monthly ?? []) {
      map.set(month.month, month);
    }

    return Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      return map.get(month) ?? {
        month,
        income: 0,
        expenses: 0,
        savings: 0,
        savingsRate: 0
      };
    });
  }

  private monthlyChartRawMax(): number {
    const monthly = this.monthlyByNumber();
    return Math.max(0, ...monthly.flatMap((entry) => [entry.income, entry.expenses]));
  }

  private monthlyChartMax(): number {
    return Math.max(1, this.monthlyChartRawMax());
  }

  private savingsChartBounds(): { min: number; max: number } {
    const values = this.monthlyByNumber().map((entry) => entry.savings);
    return {
      min: Math.min(0, ...values),
      max: Math.max(0, ...values)
    };
  }

  private describePieSlice(cx: number, cy: number, radius: number, startAngle: number, endAngle: number): string {
    const start = this.polarToCartesian(cx, cy, radius, endAngle);
    const end = this.polarToCartesian(cx, cy, radius, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';

    return [
      `M ${cx} ${cy}`,
      `L ${start.x} ${start.y}`,
      `A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
      'Z'
    ].join(' ');
  }

  private describeFullPieSlice(cx: number, cy: number, radius: number): string {
    return [
      `M ${cx} ${cy}`,
      `m 0 -${radius}`,
      `a ${radius} ${radius} 0 1 1 0 ${radius * 2}`,
      `a ${radius} ${radius} 0 1 1 0 -${radius * 2}`,
      'Z'
    ].join(' ');
  }

  private polarToCartesian(cx: number, cy: number, radius: number, angleInDegrees: number): { x: number; y: number } {
    const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
    return {
      x: cx + radius * Math.cos(angleInRadians),
      y: cy + radius * Math.sin(angleInRadians)
    };
  }
}
