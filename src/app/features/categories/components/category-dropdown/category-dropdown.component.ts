import { Component, ElementRef, HostListener, Output, EventEmitter, signal, computed, inject, ViewChildren, QueryList, OnDestroy, AfterViewInit, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslationService } from '../../../../core/services/i18n/translation.service';
import { TransactionCategory } from '../../../transactions/models/transaction.model';
import { computePosition, flip, shift, offset, Placement, autoUpdate } from '@floating-ui/dom';

@Component({
  selector: 'app-category-dropdown',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './category-dropdown.component.html',
  styleUrls: ['./category-dropdown.component.css']
})
export class CategoryDropdownComponent implements OnDestroy, AfterViewInit {
  readonly i18n = inject(TranslationService);
  private el = inject(ElementRef);

  readonly categories = input<TransactionCategory[]>([]);
  readonly transactionType = input<'EXPENSE' | 'INCOME' | 'TRANSFER'>('EXPENSE');
  readonly selectedMainCategoryId = input<number | null>(null);
  readonly selectedSubCategoryId = input<number | null>(null);
  readonly placeholder = input<string>('');
  readonly addLabel = input<string>('');

  @Output() categorySelected = new EventEmitter<{mainId: number | null, subId: number | null}>();
  @Output() addNewCategory = new EventEmitter<{mode: 'create-main' | 'create-sub', parent?: TransactionCategory}>();

  @ViewChildren('trigger') triggerElement!: QueryList<ElementRef>;
  @ViewChildren('menu') menuElement!: QueryList<ElementRef>;
  @ViewChildren('submenuTrigger') submenuTriggers!: QueryList<ElementRef>;
  @ViewChildren('submenu') submenus!: QueryList<ElementRef>;

  readonly isOpen = signal(false);
  readonly openSubmenuId = signal<number | null>(null);

  private cleanup?: () => void;
  private submenuCleanup?: () => void;
  private isMobile = signal(false);

  readonly mainCategories = computed(() =>
    this.categories()
      .filter(c => c.parentCategoryId === null && (c.type === this.transactionType() || this.transactionType() === 'TRANSFER'))
      .sort((a, b) => a.name.localeCompare(b.name))
  );

  constructor() {}

  ngAfterViewInit() {
    this.checkMobile();
    window.addEventListener('resize', () => this.checkMobile());

    // Listen for changes in ViewChildren to setup positioning when elements appear
    this.menuElement.changes.subscribe(() => {
      if (this.isOpen()) {
        this.setupPositioning();
      } else {
        this.cleanupPositioning();
      }
    });

    this.submenus.changes.subscribe(() => {
      if (this.openSubmenuId() !== null) {
        this.setupSubmenuPositioning();
      } else {
        this.cleanupSubmenuPositioning();
      }
    });
  }

  ngOnDestroy() {
    this.cleanupPositioning();
    this.cleanupSubmenuPositioning();
  }

  toggleDropdown() {
    const newState = !this.isOpen();
    this.isOpen.set(newState);
    if (!newState) {
      this.openSubmenuId.set(null);
    }
  }

  toggleSubmenu(event: MouseEvent, mainId: number) {
    event.stopPropagation();
    if (this.openSubmenuId() === mainId) {
      this.openSubmenuId.set(null);
    } else {
      this.openSubmenuId.set(mainId);
    }
  }

  selectCategory(mainId: number | null, subId: number | null) {
    this.categorySelected.emit({ mainId, subId });
    this.isOpen.set(false);
    this.openSubmenuId.set(null);
  }

  onAddNew(event: MouseEvent, mode: 'create-main' | 'create-sub', parent?: TransactionCategory) {
    event.stopPropagation();
    this.addNewCategory.emit({ mode, parent });
    this.isOpen.set(false);
    this.openSubmenuId.set(null);
  }

  getSubCategories(mainId: number) {
    return this.categories()
      .filter(c => c.parentCategoryId === mainId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getSelectedLabel(): string {
    const main = this.categories().find(c => c.id === this.selectedMainCategoryId());
    const sub = this.categories().find(c => c.id === this.selectedSubCategoryId());

    if (main && sub && main.id !== sub.id) return `${main.name} › ${sub.name}`;
    if (main) return main.name;
    return this.placeholder() || this.i18n.translate('transactions.selectCategory');
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.el.nativeElement.contains(event.target)) {
      this.isOpen.set(false);
      this.openSubmenuId.set(null);
    }
  }

  private setupPositioning() {
    if (this.isMobile()) {
      this.cleanupPositioning();
      return;
    }
    this.cleanupPositioning();
    const trigger = this.triggerElement.first?.nativeElement;
    const menu = this.menuElement.first?.nativeElement;

    if (!trigger || !menu) return;

    this.cleanup = autoUpdate(trigger, menu, () => {
      computePosition(trigger, menu, {
        placement: 'bottom-start',
        middleware: [offset(4), flip(), shift({ padding: 10 })],
      }).then(({ x, y }) => {
        Object.assign(menu.style, {
          left: `${x}px`,
          top: `${y}px`,
        });
      });
    });
  }

  private setupSubmenuPositioning() {
    if (this.isMobile()) {
      this.cleanupSubmenuPositioning();
      return;
    }
    this.cleanupSubmenuPositioning();
    const mainId = this.openSubmenuId();
    if (mainId === null) return;

    // Find the trigger and submenu for the current mainId
    const triggerIdx = this.mainCategories().findIndex(c => c.id === mainId);
    if (triggerIdx === -1) return;

    // We need to wait for the next tick to ensure the submenu is rendered and in the DOM
    setTimeout(() => {
      const triggers = this.submenuTriggers.toArray();
      const trigger = triggers[triggerIdx]?.nativeElement;
      const submenu = this.submenus.first?.nativeElement;

      if (!trigger || !submenu) return;

      this.submenuCleanup = autoUpdate(trigger, submenu, () => {
        computePosition(trigger, submenu, {
          placement: 'right-start',
          middleware: [
            offset(12), // Increased offset to ensure it's clearly to the right
            flip(),
            shift({ padding: 10 })
          ],
        }).then(({ x, y }) => {
          Object.assign(submenu.style, {
            left: `${x}px`,
            top: `${y}px`,
          });
        });
      });
    });
  }

  private cleanupPositioning() {
    if (this.cleanup) {
      this.cleanup();
      this.cleanup = undefined;
    }
  }

  private cleanupSubmenuPositioning() {
    if (this.submenuCleanup) {
      this.submenuCleanup();
      this.submenuCleanup = undefined;
    }
  }

  private checkMobile() {
    this.isMobile.set(window.innerWidth <= 768);
    if (this.isMobile()) {
      this.cleanupPositioning();
      this.cleanupSubmenuPositioning();
    }
  }

  trackById(_index: number, item: TransactionCategory) {
    return item.id;
  }
}
