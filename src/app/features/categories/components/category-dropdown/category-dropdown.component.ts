import { Component, ElementRef, HostListener, Output, EventEmitter, signal, computed, inject, ViewChildren, QueryList, OnDestroy, AfterViewInit, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslationService } from '../../../../core/services/i18n/translation.service';
import { TransactionCategory } from '../../../transactions/models/transaction.model';
import { computePosition, flip, shift, offset, autoUpdate } from '@floating-ui/dom';

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
  @ViewChildren('menuPanel') menuElement!: QueryList<ElementRef>;
  @ViewChildren('submenuTrigger') submenuTriggers!: QueryList<ElementRef>;
  @ViewChildren('submenuPanel') submenus!: QueryList<ElementRef>;

  readonly isOpen = signal(false);
  readonly openSubmenuId = signal<number | null>(null);

  private cleanup?: () => void;
  private submenuCleanup?: () => void;
  private closeSubmenuTimer?: ReturnType<typeof setTimeout>;
  private submenuPositionTimer?: ReturnType<typeof setTimeout>;
  private resizeHandler?: () => void;
  readonly isMobile = signal(false);

  readonly mainCategories = computed(() =>
    this.categories()
      .filter(c => c.parentCategoryId === null && (c.type === this.transactionType() || this.transactionType() === 'TRANSFER'))
      .sort((a, b) => a.name.localeCompare(b.name))
  );

  readonly activeMainCategoryIds = computed(() => {
    const selectedMain = this.selectedMainCategoryId();
    const selectedSub = this.selectedSubCategoryId();
    const ids = new Set<number>();

    if (selectedMain !== null) {
      ids.add(selectedMain);
    }

    if (selectedSub !== null) {
      const sub = this.categories().find((category) => category.id === selectedSub);
      if (sub && sub.parentCategoryId !== null) {
        ids.add(sub.parentCategoryId);
      }
    }

    return ids;
  });

  constructor() {}

  ngAfterViewInit() {
    this.checkMobile();
    this.resizeHandler = () => this.checkMobile();
    window.addEventListener('resize', this.resizeHandler);

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
    this.clearCloseSubmenuTimer();
    this.cleanupPositioning();
    this.cleanupSubmenuPositioning();
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
    }
  }

  toggleDropdown() {
    const newState = !this.isOpen();
    this.isOpen.set(newState);
    if (!newState) {
      this.openSubmenuId.set(null);
    } else if (!this.isMobile()) {
      queueMicrotask(() => this.setupPositioning());
    }
  }

  openSubmenu(mainId: number) {
    this.clearCloseSubmenuTimer();
    this.openSubmenuId.set(mainId);
    this.scheduleSubmenuPositioning();
  }

  handleMainClick(event: MouseEvent, main: TransactionCategory) {
    event.stopPropagation();
    this.isOpen.set(true);
    this.openSubmenuId.set(main.id);
    this.scheduleSubmenuPositioning();
  }

  handleMainMouseEnter(main: TransactionCategory) {
    if (this.isMobile()) return;
    this.clearCloseSubmenuTimer();
    this.isOpen.set(true);
    this.openSubmenuId.set(main.id);
    this.scheduleSubmenuPositioning();
  }

  handleMainMouseLeave() {
    if (this.isMobile()) return;
    this.scheduleCloseSubmenu();
  }

  handleSubmenuToggleClick(event: MouseEvent, mainId: number) {
    event.stopPropagation();
    this.openSubmenuId.set(mainId);
    this.scheduleSubmenuPositioning();
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

  isMainCategoryActive(mainId: number): boolean {
    return this.activeMainCategoryIds().has(mainId);
  }

  isSubCategoryActive(mainId: number, subId: number): boolean {
    return this.selectedMainCategoryId() === mainId && this.selectedSubCategoryId() === subId;
  }

  getSelectedLabel(): string {
    const main = this.categories().find(c => c.id === this.selectedMainCategoryId());
    const sub = this.categories().find(c => c.id === this.selectedSubCategoryId());

    if (main && sub && main.id !== sub.id) return `${main.name} › ${sub.name}`;
    if (main) return main.name;
    return this.placeholder() || this.i18n.translate('transactions.selectCategory');
  }

  getOpenSubmenuCategory(): TransactionCategory | undefined {
    return this.categories().find(c => c.id === this.openSubmenuId());
  }

  getOpenSubmenuParent(): TransactionCategory | undefined {
    const submenuId = this.openSubmenuId();
    if (submenuId === null) return undefined;
    return this.categories().find(c => c.id === submenuId);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.el.nativeElement.contains(event.target)) {
      this.isOpen.set(false);
      this.openSubmenuId.set(null);
      this.clearCloseSubmenuTimer();
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
          visibility: 'visible',
          opacity: '1',
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
          strategy: 'fixed',
          placement: 'right-start',
          middleware: [
            offset(8),
            flip(),
            shift({ padding: 10 })
          ],
        }).then(({ x, y }) => {
          Object.assign(submenu.style, {
            left: `${x}px`,
            top: `${y}px`,
            visibility: 'visible',
            opacity: '1',
            position: 'fixed',
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

  clearCloseSubmenuTimer() {
    if (this.closeSubmenuTimer) {
      clearTimeout(this.closeSubmenuTimer);
      this.closeSubmenuTimer = undefined;
    }
  }

  private clearSubmenuPositionTimer() {
    if (this.submenuPositionTimer) {
      clearTimeout(this.submenuPositionTimer);
      this.submenuPositionTimer = undefined;
    }
  }

  private scheduleSubmenuPositioning() {
    if (this.isMobile()) return;
    this.clearSubmenuPositionTimer();
    this.submenuPositionTimer = setTimeout(() => {
      this.setupSubmenuPositioning();
    }, 0);
  }

  private scheduleCloseSubmenu() {
    this.clearCloseSubmenuTimer();
    this.closeSubmenuTimer = setTimeout(() => {
      this.openSubmenuId.set(null);
    }, 150);
  }

  private checkMobile() {
    this.isMobile.set(window.innerWidth <= 768);
    if (this.isMobile()) {
      this.cleanupPositioning();
      this.cleanupSubmenuPositioning();
      this.clearCloseSubmenuTimer();
      this.clearSubmenuPositionTimer();
    }
  }

  trackById(_index: number, item: TransactionCategory) {
    return item.id;
  }
}
