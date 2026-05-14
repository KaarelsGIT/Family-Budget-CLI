import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize, forkJoin } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { TranslationService } from '../../../../core/services/i18n/translation.service';
import { Account } from '../../../accounts/models/account.model';
import { AccountService, SelectableUser } from '../../../accounts/services/account.service';
import { formatMoney } from '../../../shared/utils/money-format';
import { CategoryTableComponent, CategoryTableNode } from '../../components/category-table/category-table.component';
import {
  ChartDetailModalComponent,
  ChartDetailModalData,
  ChartDetailModalType
} from '../../modals/chart-detail-modal/chart-detail-modal.component';
import { TransactionItem, TransactionQuery } from '../../../transactions/models/transaction.model';
import { TransactionsService } from '../../../transactions/services/transactions.service';
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
  x: number;
  incomeX: number;
  expenseX: number;
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

interface MonthOption {
  value: number;
  label: string;
}

interface DailyChartEntry {
  day: number;
  label: string;
  income: number;
  expenses: number;
  savings: number;
}

interface UserFilterGroup {
  value: number | '__parent__' | '__child__' | null;
  label: string;
  options: SelectableUser[];
}

interface DailyCategoryBucket {
  total: number;
  monthly: Record<string, number>;
  children: Map<string, DailyCategoryBucket>;
}

@Component({
  selector: 'app-statistics-page',
  standalone: true,
  imports: [CommonModule, FormsModule, CategoryTableComponent, ChartDetailModalComponent],
  templateUrl: './statistics-page.component.html',
  styleUrl: './statistics-page.component.css'
})
export class StatisticsPageComponent {
  private readonly statisticsService = inject(StatisticsService);
  private readonly accountService = inject(AccountService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly authService = inject(AuthService);
  readonly i18n = inject(TranslationService);

  readonly currentYear = new Date().getFullYear();
  readonly currentMonth = new Date().getMonth() + 1;
  readonly selectedMonth = signal<number | null>(this.currentMonth);
  readonly currentUserId = this.authService.getUserId();
  readonly currentUserRole = this.authService.getRole();
  readonly selectedYear = signal(this.currentYear);
  readonly selectedUserId = signal<number | null>(this.currentUserId);
  readonly selectedUserType = signal<'PARENT' | 'CHILD' | null>(null);
  readonly selectedUserFilter = signal<number | '__parent__' | '__child__' | null>(this.currentUserId);
  readonly selectedAccountId = signal<number | null>(null);
  readonly selectedCategoryTab = signal<CategoryTab>('expenses');
  readonly isLoading = signal(false);
  readonly isLoadingAccounts = signal(false);
  readonly isLoadingUsers = signal(false);
  readonly errorMessage = signal('');
  readonly statistics = signal<YearlyStatisticsResponse | null>(null);
  readonly accounts = signal<Account[]>([]);
  readonly selectableUsers = signal<SelectableUser[]>([]);
  readonly monthTransactions = signal<TransactionItem[]>([]);
  readonly activeChartModal = signal<{ type: ChartDetailModalType; data: ChartDetailModalData } | null>(null);

  readonly yearOptions = computed(() => {
    const years: number[] = [];
    for (let year = 2100; year >= 1900; year--) {
      years.push(year);
    }
    return years;
  });

  readonly monthOptions = computed<MonthOption[]>(() =>
    Array.from({ length: 12 }, (_, index) => {
      const value = index + 1;
      const label = new Intl.DateTimeFormat(this.i18n.language(), { month: 'long' }).format(new Date(this.currentYear, index, 1));
      return {
        value,
        label: label.charAt(0).toUpperCase() + label.slice(1)
      };
    })
  );

  readonly statisticsTitle = computed(() => {
    const year = this.selectedYear();
    const month = this.selectedMonth();
    if (month === null) {
      return `${this.i18n.translate('statistics.yearOverview')} ${year}`;
    }

    const monthLabel = this.monthOptions().find((option) => option.value === month)?.label
      ?? new Intl.DateTimeFormat(this.i18n.language(), { month: 'long' }).format(new Date(year, month - 1, 1));
    return `${monthLabel} ${year}`;
  });

  readonly userOptions = computed(() => this.selectableUsers());
  readonly userFilterOptions = computed(() => this.buildUserFilterOptions(this.selectableUsers()));

  readonly accountOptions = computed(() => {
    return [...this.accounts()].sort((left, right) => left.name.localeCompare(right.name));
  });

  readonly showUserFilter = computed(() => this.currentUserRole !== 'CHILD' && this.userOptions().length > 0);

  readonly monthlyBars = computed(() => this.buildMonthlyBars());
  readonly dailyGuideXs = computed(() => this.buildDailyGuideXs());
  readonly monthlyGuideXs = computed(() => this.buildMonthlyGuideXs());
  readonly monthlyChartTicks = computed(() => this.buildMonthlyTicks());
  readonly savingsLine = computed(() => this.buildSavingsLine());
  readonly savingsChartTicks = computed(() => this.buildSavingsTicks());
  readonly categoryPieSlices = computed(() => this.buildCategoryPieSlices());
  readonly categoryGroups = computed(() => this.buildCategoryGroups());
  readonly categoryTableCategories = computed(() => this.buildCategoryTableCategories());
  readonly categoryTableColumns = computed(() => this.buildCategoryTableColumns());
  readonly categoryTableColumnLabels = computed(() => this.buildCategoryTableColumnLabels());
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

  readonly hasActiveFilters = computed(() =>
    this.selectedYear() !== this.currentYear
    || this.selectedMonth() !== null
    || this.selectedUserFilter() !== null
    || this.selectedUserType() !== null
    || this.selectedAccountId() !== null
  );

  constructor() {
    this.loadFilterOptions();
    this.loadStatistics();
    this.loadMonthTransactions();
  }

  onYearChange(value: number | string): void {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1900 || parsed > 2100) {
      return;
    }

    this.selectedYear.set(parsed);
    this.loadStatistics();
    this.loadMonthTransactions();
  }

  onMonthChange(value: any): void {
    const parsed = value === null || value === '' ? null : Number(value);
    this.selectedMonth.set(parsed);
    this.loadStatistics();
    this.loadMonthTransactions();
  }

  onUserChange(value: number | string | null): void {
    if (value === '__parent__') {
      this.onUserGroupChange('PARENT');
      return;
    }

    if (value === '__child__') {
      this.onUserGroupChange('CHILD');
      return;
    }

    const parsed = value === null || value === '' ? null : Number(value);
    this.selectedUserFilter.set(parsed);
    this.selectedUserId.set(parsed);
    this.selectedUserType.set(null);
    this.loadStatistics();
    this.loadMonthTransactions();
  }

  onUserGroupChange(value: 'PARENT' | 'CHILD' | null): void {
    if (value === null) {
      this.selectedUserFilter.set(null);
      this.selectedUserType.set(null);
      this.selectedUserId.set(null);
    } else {
      this.selectedUserFilter.set(value === 'PARENT' ? '__parent__' : '__child__');
      this.selectedUserType.set(value);
      this.selectedUserId.set(null);
    }
    this.loadStatistics();
    this.loadMonthTransactions();
  }

  onAccountChange(value: number | string | null): void {
    this.selectedAccountId.set(value === null || value === '' ? null : Number(value));
    this.loadStatistics();
    this.loadMonthTransactions();
  }

  clearFilters(): void {
    this.selectedYear.set(this.currentYear);
    this.selectedMonth.set(null);
    this.selectedUserId.set(null);
    this.selectedUserType.set(null);
    this.selectedUserFilter.set(null);
    this.selectedAccountId.set(null);
    this.loadStatistics();
    this.loadMonthTransactions();
  }

  setCategoryTab(tab: CategoryTab): void {
    this.selectedCategoryTab.set(tab);
  }

  openChartModal(type: ChartDetailModalType): void {
    const statistics = this.statistics();
    if (!statistics) {
      return;
    }

    this.activeChartModal.set({
      type,
      data: this.buildChartModalData(type, statistics)
    });
  }

  closeChartModal(): void {
    this.activeChartModal.set(null);
  }

  formatAmount(value: number): string {
    return formatMoney(value);
  }

  formatPercent(value: number): string {
    const parsed = typeof value === 'string' ? parseFloat(value) : Number(value);
    if (!Number.isFinite(parsed)) {
      return '0.0 %';
    }

    return `${parsed.toFixed(1)} %`;
  }

  trackByUserId(_index: number, user: SelectableUser): number {
    return user.id;
  }

  formatMonth(month: number): string {
    return new Intl.DateTimeFormat(this.i18n.language(), { month: 'short' }).format(new Date(this.selectedYear(), month - 1, 1));
  }

  formatDay(day: number): string {
    const month = this.selectedMonth();
    if (month === null) {
      return String(day);
    }

    return String(day).padStart(2, '0');
  }

  shouldShowDayLabel(day: number): boolean {
    const month = this.selectedMonth();
    if (month === null) {
      return true;
    }

    return true;
  }

  dayLabelRotation(): string {
    return this.selectedMonth() === null ? '0' : '45';
  }

  dayLabelAnchor(): string {
    return this.selectedMonth() === null ? 'middle' : 'end';
  }

  dayLabelXOffset(): number {
    return this.selectedMonth() === null ? 0 : 4;
  }

  dayLabelYOffset(): number {
    return this.selectedMonth() === null ? 220 : 226;
  }

  isMonthView(): boolean {
    return this.selectedMonth() !== null;
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

  trackByIndex(index: number): number {
    return index;
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

    this.statisticsService.getYearly(this.selectedYear(), this.selectedMonth(), this.selectedUserId(), this.selectedUserType(), this.selectedAccountId())
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

  private loadMonthTransactions(): void {
    const month = this.selectedMonth();
    if (month === null) {
      this.monthTransactions.set([]);
      return;
    }

    const query: TransactionQuery = {
      page: 0,
      size: 5000,
      sort: 'transactionDate,asc',
      userId: this.selectedUserId(),
      userType: this.selectedUserType(),
      types: [],
      mainCategoryId: null,
      subCategoryId: null,
      from: this.toIsoDate(new Date(this.selectedYear(), month - 1, 1)),
      to: this.toIsoDate(new Date(this.selectedYear(), month, 0))
    };

    this.transactionsService.getTransactions(query).subscribe({
      next: (response) => {
        const accountId = this.selectedAccountId();
        const filtered = accountId === null
          ? response.data
          : response.data.filter((transaction) => transaction.fromAccountId === accountId || transaction.toAccountId === accountId);
        this.monthTransactions.set(filtered);
      },
      error: () => this.monthTransactions.set([])
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

  private buildUserFilterOptions(users: SelectableUser[]): UserFilterGroup[] {
    if (this.currentUserRole === 'CHILD') {
      return [{
        value: this.currentUserId,
        label: this.i18n.translate('statistics.currentUser'),
        options: users.filter((user) => user.id === this.currentUserId)
      }];
    }

    const sortedUsers = [...users].sort((left, right) => left.username.localeCompare(right.username));
    return [
      {
        value: '__parent__',
        label: this.i18n.translate('transactions.userTypeParents'),
        options: sortedUsers.filter((user) => user.role === 'PARENT')
      },
      {
        value: '__child__',
        label: this.i18n.translate('transactions.userTypeChildren'),
        options: sortedUsers.filter((user) => user.role === 'CHILD')
      }
    ];
  }

  private buildCategoryTableCategories(): CategoryTableNode[] {
    if (this.selectedMonth() !== null) {
      return this.buildDailyCategoryTableCategories();
    }

    return this.buildCategoryGroups().map((group) => this.mapCategoryNode(group));
  }

  private buildCategoryTableColumns(): number[] {
    const month = this.selectedMonth();
    if (month === null) {
      return Array.from({ length: 12 }, (_, index) => index + 1);
    }

    return Array.from({ length: this.daysInSelectedMonth() }, (_, index) => index + 1);
  }

  private buildCategoryTableColumnLabels(): { key: number; label: string }[] {
    const month = this.selectedMonth();
    if (month === null) {
      return Array.from({ length: 12 }, (_, index) => ({
        key: index + 1,
        label: new Intl.DateTimeFormat(this.i18n.language(), { month: 'short' }).format(new Date(this.selectedYear(), index, 1))
      }));
    }

    return Array.from({ length: this.daysInSelectedMonth() }, (_, index) => {
      const day = index + 1;
      return { key: day, label: String(day).padStart(2, '0') };
    });
  }

  private buildChartModalData(type: ChartDetailModalType, statistics: YearlyStatisticsResponse): ChartDetailModalData {
    if (type === 'monthly') {
      return {
        kind: 'monthly',
        year: statistics.year,
        bars: this.buildMonthlyBars(),
        ticks: this.buildMonthlyTicks()
      };
    }

    if (type === 'savings') {
      return {
        kind: 'savings',
        year: statistics.year,
        line: this.buildSavingsLine(),
        ticks: this.buildSavingsTicks()
      };
    }

    return {
      kind: 'category',
      year: statistics.year,
      slices: this.categoryPieSlices()
    };
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

  private buildDailyCategoryTableCategories(): CategoryTableNode[] {
    const month = this.selectedMonth();
    if (month === null) {
      return [];
    }

    const rows = new Map<string, DailyCategoryBucket>();
    const typeFilter = this.selectedCategoryTab() === 'income' ? 'INCOME' : 'EXPENSE';

    for (const transaction of this.monthTransactions()) {
      if (transaction.type !== typeFilter) {
        continue;
      }

      const day = new Date(`${transaction.transactionDate}T00:00:00`).getDate();
      const parts = this.parseCategoryPath(transaction.categoryName);
      const categoryParts = parts.length > 0 ? parts : [this.i18n.translate('statistics.categoryTotal')];

      this.addDailyCategoryTransaction(rows, categoryParts, day, transaction.amount);
    }

    return this.mapDailyCategoryRows(rows);
  }

  private addDailyCategoryTransaction(
    rows: Map<string, DailyCategoryBucket>,
    parts: string[],
    day: number,
    amount: number
  ): void {
    if (parts.length === 0) {
      return;
    }

    const [head, ...tail] = parts;
    const bucket = rows.get(head) ?? { total: 0, monthly: {}, children: new Map<string, DailyCategoryBucket>() };
    bucket.total += amount;
    bucket.monthly[String(day)] = (bucket.monthly[String(day)] ?? 0) + amount;
    rows.set(head, bucket);
    this.addDailyCategoryTransaction(bucket.children, tail, day, amount);
  }

  private parseCategoryPath(categoryName: string | null): string[] {
    if (!categoryName) {
      return [];
    }

    return categoryName
      .split(' / ')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }

  private mapDailyCategoryRows(rows: Map<string, DailyCategoryBucket>): CategoryTableNode[] {
    return [...rows.entries()]
      .map(([name, entry]) => ({
        name,
        total: entry.total,
        monthly: entry.monthly,
        subcategories: this.mapDailyCategoryRows(entry.children)
      }))
      .sort((left, right) => right.total - left.total || left.name.localeCompare(right.name));
  }

  private buildMonthlyBars(): MonthlyBarGroup[] {
    if (this.selectedMonth() !== null) {
      return this.buildDailyBars();
    }

    const monthly = this.monthlyByNumber();
    const maxValue = this.monthlyChartMax();

    const chartHeight = 180;
    const baseline = 200;
    const width = 1052;
    const leftPadding = 64;
    const rightPadding = 64;
    const slotWidth = (width - leftPadding - rightPadding) / monthly.length;

    return monthly.map((entry) => ({
      month: entry.month,
      label: this.formatMonth(entry.month),
      x: leftPadding + ((entry.month - 1) * slotWidth) + (slotWidth / 2),
      incomeX: leftPadding + ((entry.month - 1) * slotWidth) + (slotWidth / 2) - 8,
      expenseX: leftPadding + ((entry.month - 1) * slotWidth) + (slotWidth / 2) + 4,
      incomeValue: entry.income,
      expenseValue: entry.expenses,
      incomeHeight: (entry.income / maxValue) * chartHeight,
      expenseHeight: (entry.expenses / maxValue) * chartHeight,
      incomeY: baseline - ((entry.income / maxValue) * chartHeight),
      expenseY: baseline - ((entry.expenses / maxValue) * chartHeight)
    }));
  }

  private buildMonthlyTicks(): ChartTick[] {
    if (this.selectedMonth() !== null) {
      return this.buildDailyTicks();
    }

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
    if (this.selectedMonth() !== null) {
      return this.buildDailySavingsLine();
    }

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
    if (this.selectedMonth() !== null) {
      return this.buildDailySavingsTicks();
    }

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

  private buildDailyBars(): MonthlyBarGroup[] {
    const daily = this.dailySeries();
    const maxValue = Math.max(1, ...daily.flatMap((entry) => [entry.income, entry.expenses]));
    const chartHeight = 180;
    const baseline = 200;
    const width = 1180;
    const leftPadding = 64;
    const rightPadding = 64;
    const slotWidth = (width - leftPadding - rightPadding) / daily.length;
    const barWidth = Math.max(3, Math.min(5, slotWidth * 0.14));
    const barGap = Math.max(6, Math.min(18, slotWidth * 0.48));
    const pairWidth = (barWidth * 2) + barGap;

    return daily.map((entry, index) => {
      const x = leftPadding + (index * slotWidth) + (slotWidth / 2);
      const barStart = x - (pairWidth / 2);
      const incomeHeight = (entry.income / maxValue) * chartHeight;
      const expenseHeight = (entry.expenses / maxValue) * chartHeight;
      const incomeX = barStart;
      const expenseX = barStart + barWidth + barGap;

      return {
        month: entry.day,
        label: entry.label,
        x,
        incomeX,
        expenseX,
        incomeValue: entry.income,
        expenseValue: entry.expenses,
        incomeHeight,
        expenseHeight,
        incomeY: baseline - incomeHeight,
        expenseY: baseline - expenseHeight
      };
    });
  }

  private buildDailyGuideXs(): number[] {
    const month = this.selectedMonth();
    if (month === null) {
      return [];
    }

    const daysInMonth = this.daysInSelectedMonth();
    const width = 1180;
    const leftPadding = 64;
    const rightPadding = 64;
    const slotWidth = (width - leftPadding - rightPadding) / daysInMonth;

    return Array.from({ length: daysInMonth + 1 }, (_, index) => leftPadding + (index * slotWidth));
  }

  private buildMonthlyGuideXs(): number[] {
    const monthly = this.monthlyByNumber();
    if (monthly.length < 2) {
      return [];
    }

    const width = 1052;
    const leftPadding = 56;
    const rightPadding = 56;
    const slotWidth = (width - leftPadding - rightPadding) / monthly.length;

    return Array.from({ length: monthly.length - 1 }, (_, index) => leftPadding + ((index + 1) * slotWidth));
  }

  private buildDailyTicks(): ChartTick[] {
    const daily = this.dailySeries();
    const rawMax = Math.max(0, ...daily.flatMap((entry) => [entry.income, entry.expenses]));
    if (rawMax <= 0) {
      return [{
        value: 0,
        y: 200,
        label: this.formatAmount(0)
      }];
    }

    const max = Math.max(1, rawMax);
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

  private buildDailySavingsLine(): { points: string; dots: LinePoint[]; min: number; max: number } {
    const daily = this.dailySeries();
    const values = daily.map((entry) => entry.savings);
    const min = Math.min(0, ...values);
    const max = Math.max(0, ...values);
    const range = max - min || 1;
    const width = 540;
    const height = 170;
    const leftPadding = 40;
    const pointSpacing = daily.length > 1 ? width / (daily.length - 1) : width;

    const dots = daily.map((entry, index) => {
      const x = leftPadding + index * pointSpacing;
      const y = 190 - (((entry.savings - min) / range) * height);
      return {
        month: entry.day,
        label: entry.label,
        x,
        y,
        value: entry.savings
      };
    });

    return { points: dots.map((dot) => `${dot.x},${dot.y}`).join(' '), dots, min, max };
  }

  private buildDailySavingsTicks(): ChartTick[] {
    const daily = this.dailySeries();
    const values = daily.map((entry) => entry.savings);
    const min = Math.min(0, ...values);
    const max = Math.max(0, ...values);
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

  private savingsChartBounds(): { min: number; max: number } {
    const values = this.monthlyByNumber().map((entry) => entry.savings);
    return {
      min: Math.min(0, ...values),
      max: Math.max(0, ...values)
    };
  }

  private toIsoDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private daysInSelectedMonth(): number {
    const month = this.selectedMonth();
    if (month === null) {
      return 0;
    }

    return new Date(this.selectedYear(), month, 0).getDate();
  }

  private dailySeries(): DailyChartEntry[] {
    const month = this.selectedMonth();
    if (month === null) {
      return [];
    }

    const daysInMonth = this.daysInSelectedMonth();
    const accountById = new Map(this.accounts().map((account) => [account.id, account]));
    const series = Array.from({ length: daysInMonth }, (_, index) => ({
      day: index + 1,
      label: this.formatDay(index + 1),
      income: 0,
      expenses: 0,
      savings: 0
    }));

    for (const transaction of this.monthTransactions()) {
      const day = new Date(`${transaction.transactionDate}T00:00:00`).getDate();
      const bucket = series[day - 1];
      if (!bucket) {
        continue;
      }

      if (transaction.type === 'INCOME') {
        bucket.income += transaction.amount;
        const toAccount = transaction.toAccountId ? accountById.get(transaction.toAccountId) : null;
        if (toAccount?.type === 'SAVINGS') {
          bucket.savings += transaction.amount;
        }
      }

      if (transaction.type === 'EXPENSE') {
        bucket.expenses += transaction.amount;
        const fromAccount = transaction.fromAccountId ? accountById.get(transaction.fromAccountId) : null;
        if (fromAccount?.type === 'SAVINGS') {
          bucket.savings -= transaction.amount;
        }
      }

      if (transaction.type === 'TRANSFER') {
        const fromAccount = transaction.fromAccountId ? accountById.get(transaction.fromAccountId) : null;
        const toAccount = transaction.toAccountId ? accountById.get(transaction.toAccountId) : null;
        if (fromAccount?.type === 'SAVINGS') {
          bucket.savings -= transaction.amount;
        }
        if (toAccount?.type === 'SAVINGS') {
          bucket.savings += transaction.amount;
        }
      }
    }

    return series;
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
