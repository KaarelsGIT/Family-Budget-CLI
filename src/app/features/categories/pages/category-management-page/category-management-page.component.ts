import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../../../../auth/auth.service';
import { TranslationService } from '../../../../i18n/translation.service';
import { TransactionCategory } from '../../../transactions/models/transaction.model';
import { TransactionsService } from '../../../transactions/services/transactions.service';
import { CategoryEditorModalComponent } from '../../components/category-editor-modal/category-editor-modal.component';

type TransactionType = 'INCOME' | 'EXPENSE';
type CategoryGroup = 'FAMILY' | 'CHILD';

interface CategoryNode {
  category: TransactionCategory;
  depth: number;
  hasChildren: boolean;
}

interface CategorySection {
  type: TransactionType;
  label: string;
  nodes: CategoryNode[];
}

@Component({
  selector: 'app-category-management-page',
  standalone: true,
  imports: [CommonModule, RouterLink, CategoryEditorModalComponent],
  templateUrl: './category-management-page.component.html',
  styleUrl: './category-management-page.component.css'
})
export class CategoryManagementPageComponent {
  private readonly transactionsService = inject(TransactionsService);
  private readonly authService = inject(AuthService);
  readonly i18n = inject(TranslationService);

  readonly categories = signal<TransactionCategory[]>([]);
  readonly isLoading = signal(false);
  readonly errorMessage = signal('');
  readonly isModalOpen = signal(false);
  readonly modalMode = signal<'create-main' | 'create-sub' | 'edit'>('create-main');
  readonly selectedCategory = signal<TransactionCategory | null>(null);
  readonly selectedParentCategory = signal<TransactionCategory | null>(null);
  readonly createType = signal<TransactionType>('EXPENSE');
  readonly createGroup = signal<CategoryGroup>('FAMILY');

  readonly allowGroupSelection = computed(() => this.authService.isAdmin());

  readonly categorySections = computed<CategorySection[]>(() => [
    {
      type: 'EXPENSE',
      label: this.i18n.translate('categories.expenseSection'),
      nodes: this.buildCategoryTree('EXPENSE')
    },
    {
      type: 'INCOME',
      label: this.i18n.translate('categories.incomeSection'),
      nodes: this.buildCategoryTree('INCOME')
    }
  ]);

  constructor() {
    this.loadCategories();
  }

  trackByCategoryId(_index: number, node: CategoryNode): number {
    return node.category.id;
  }

  reloadCategories(): void {
    this.loadCategories();
  }

  openCreateMainCategory(type: TransactionType): void {
    this.modalMode.set('create-main');
    this.selectedCategory.set(null);
    this.selectedParentCategory.set(null);
    this.createType.set(type);
    this.createGroup.set(this.getDefaultGroup());
    this.isModalOpen.set(true);
  }

  openCreateSubcategory(parent: TransactionCategory): void {
    if (parent.parentCategoryId !== null) {
      return;
    }

    this.modalMode.set('create-sub');
    this.selectedCategory.set(null);
    this.selectedParentCategory.set(parent);
    this.createType.set(parent.type === 'INCOME' ? 'INCOME' : 'EXPENSE');
    this.createGroup.set(parent.group as CategoryGroup);
    this.isModalOpen.set(true);
  }

  openEditCategory(category: TransactionCategory): void {
    this.modalMode.set('edit');
    this.selectedCategory.set(category);
    this.selectedParentCategory.set(this.findParentCategory(category));
    this.createType.set(category.type as TransactionType);
    this.createGroup.set(category.group as CategoryGroup);
    this.isModalOpen.set(true);
  }

  deleteCategory(category: TransactionCategory): void {
    const confirmed = window.confirm(this.i18n.translate('categories.deleteConfirm'));
    if (!confirmed) {
      return;
    }

    this.errorMessage.set('');
    this.transactionsService.deleteCategory(category.id).subscribe({
      next: () => this.loadCategories(),
      error: (error: { error?: { message?: string } }) => {
        this.errorMessage.set(error.error?.message || this.i18n.translate('categories.deleteFailed'));
      }
    });
  }

  closeModal(): void {
    this.isModalOpen.set(false);
    this.selectedCategory.set(null);
    this.selectedParentCategory.set(null);
  }

  onCategorySaved(): void {
    this.loadCategories();
    if (this.modalMode() === 'edit') {
      this.isModalOpen.set(false);
      this.selectedCategory.set(null);
      this.selectedParentCategory.set(null);
    }
  }

  getNodeLabel(node: CategoryNode): string {
    return node.category.parentCategoryId === null
      ? node.category.name
      : `${node.category.parentCategoryName ?? ''}${node.category.parentCategoryName ? ' / ' : ''}${node.category.name}`;
  }

  getGroupLabel(group: CategoryGroup): string {
    return group === 'FAMILY'
      ? this.i18n.translate('categories.groupFamily')
      : this.i18n.translate('categories.groupChild');
  }

  getTypeLabel(type: TransactionCategory['type']): string {
    if (type === 'EXPENSE') {
      return this.i18n.translate('transactions.typeExpense');
    }
    if (type === 'INCOME') {
      return this.i18n.translate('transactions.typeIncome');
    }
    return type;
  }

  canAddSubcategory(node: CategoryNode): boolean {
    return node.depth === 0;
  }

  private loadCategories(): void {
    this.isLoading.set(true);
    this.errorMessage.set('');

    this.transactionsService.getCategories(1000)
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: (categories) => {
          this.categories.set(categories);
        },
        error: (error: { error?: { message?: string } }) => {
          this.categories.set([]);
          this.errorMessage.set(error.error?.message || this.i18n.translate('categories.loadFailed'));
        }
      });
  }

  private buildCategoryTree(type: TransactionType): CategoryNode[] {
    const categories = this.categories().filter((category) => category.type === type);
    const categoriesByParent = new Map<number | null, TransactionCategory[]>();

    for (const category of categories) {
      const parentKey = category.parentCategoryId ?? null;
      const list = categoriesByParent.get(parentKey) ?? [];
      list.push(category);
      categoriesByParent.set(parentKey, list);
    }

    const sortCategories = (items: TransactionCategory[]): TransactionCategory[] => [...items].sort((left, right) => {
      const groupOrder: Record<CategoryGroup, number> = { FAMILY: 0, CHILD: 1 };
      if (left.group !== right.group) {
        return groupOrder[left.group] - groupOrder[right.group];
      }

      return left.name.localeCompare(right.name);
    });

    const result: CategoryNode[] = [];
    const visit = (parentId: number | null, depth: number): void => {
      for (const category of sortCategories(categoriesByParent.get(parentId) ?? [])) {
        const children = categoriesByParent.get(category.id) ?? [];
        result.push({
          category,
          depth,
          hasChildren: children.length > 0
        });
        visit(category.id, depth + 1);
      }
    };

    visit(null, 0);
    return result;
  }

  private findParentCategory(category: TransactionCategory): TransactionCategory | null {
    if (category.parentCategoryId === null) {
      return null;
    }

    return this.categories().find((item) => item.id === category.parentCategoryId) ?? null;
  }

  private getDefaultGroup(): CategoryGroup {
    return this.authService.getRole() === 'CHILD' ? 'CHILD' : 'FAMILY';
  }
}
