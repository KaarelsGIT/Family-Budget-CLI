import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { TranslationService } from '../../../../core/services/i18n/translation.service';
import { formatMoney } from '../../../shared/utils/money-format';

type CategoryTab = 'income' | 'expenses';

export interface CategoryTableMonthTotals {
  [month: string]: number;
}

export interface CategoryTableNode {
  name: string;
  total: number;
  monthly?: CategoryTableMonthTotals;
  subcategories?: CategoryTableNode[];
}

interface CategoryTableRow {
  key: string;
  name: string;
  total: number;
  monthly?: CategoryTableMonthTotals | null;
  depth: number;
  hasChildren: boolean;
}

@Component({
  selector: 'app-category-table',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './category-table.component.html',
  styleUrl: './category-table.component.css'
})
export class CategoryTableComponent {
  readonly i18n = inject(TranslationService);

  readonly categories = input.required<CategoryTableNode[]>();
  readonly activeTab = input<CategoryTab>('expenses');
  readonly activeTabChange = output<CategoryTab>();

  readonly expandedKeys = signal<Record<string, boolean>>({});

  readonly monthColumns = Array.from({ length: 12 }, (_, index) => index + 1);
  readonly monthLabels = computed(() => this.monthColumns.map((month, index) => ({
    key: month,
    label: new Intl.DateTimeFormat(this.i18n.language(), { month: 'short' }).format(new Date(2024, index, 1))
  })));
  readonly rows = computed(() => this.flattenRows(this.categories()));

  constructor() {
    effect(() => {
      this.categories();
      this.expandedKeys.set({});
    }, { allowSignalWrites: true });
  }

  setTab(tab: CategoryTab): void {
    this.activeTabChange.emit(tab);
  }

  toggleRow(key: string): void {
    this.expandedKeys.update((state) => ({
      ...state,
      [key]: !state[key]
    }));
  }

  isExpanded(key: string): boolean {
    return !!this.expandedKeys()[key];
  }

  formatAmount(value: number): string {
    return formatMoney(value);
  }

  rowTotal(row: CategoryTableRow): number {
    if (!row.monthly) {
      return row.total;
    }

    const monthlyTotal = this.monthColumns.reduce((sum, month) => sum + (row.monthly?.[String(month)] ?? 0), 0);
    return monthlyTotal;
  }

  trackByRow(_index: number, row: CategoryTableRow): string {
    return row.key;
  }

  trackByMonthColumn(_index: number, column: { key: number }): number {
    return column.key;
  }

  trackByMonthKey(_index: number, month: number): number {
    return month;
  }

  monthValue(row: CategoryTableRow, month: number): number {
    return row.monthly?.[String(month)] ?? 0;
  }

  monthCellLabel(value: number): string {
    return value === 0 ? '—' : this.formatAmount(value);
  }

  categoryButtonLabel(key: string): string {
    return this.isExpanded(key)
      ? this.i18n.translate('statistics.collapseCategory')
      : this.i18n.translate('statistics.expandCategory');
  }

  private flattenRows(categories: CategoryTableNode[], depth = 0, parentKey = ''): CategoryTableRow[] {
    return [...categories]
      .sort((left, right) => left.name.localeCompare(right.name))
      .flatMap((category) => {
        const key = parentKey ? `${parentKey}/${category.name}` : category.name;
        const children = category.subcategories ?? [];
        const row: CategoryTableRow = {
          key,
          name: category.name,
          total: category.total,
          monthly: category.monthly ?? null,
          depth,
          hasChildren: children.length > 0
        };

        if (!children.length || !this.isExpanded(key)) {
          return [row];
        }

        return [row, ...this.flattenRows(children, depth + 1, key)];
      });
  }
}
