import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, ViewChild, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { TranslationService } from '../../../../core/services/i18n/translation.service';
import {
  CreateTransactionCategoryPayload,
  TransactionCategory
} from '../../../transactions/models/transaction.model';
import { TransactionsService } from '../../../transactions/services/transactions.service';

type TransactionType = 'INCOME' | 'EXPENSE';
type CategoryGroup = 'FAMILY' | 'CHILD' | 'PARENT';
type EditorMode = 'create-main' | 'create-sub' | 'edit';

@Component({
  selector: 'app-category-editor-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './category-editor-modal.component.html',
  styleUrl: './category-editor-modal.component.css'
})
export class CategoryEditorModalComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly transactionsService = inject(TransactionsService);
  private readonly authService = inject(AuthService);
  readonly i18n = inject(TranslationService);

  readonly isOpen = input(false);
  readonly mode = input<EditorMode>('create-main');
  readonly category = input<TransactionCategory | null>(null);
  readonly parentCategory = input<TransactionCategory | null>(null);
  readonly defaultType = input<TransactionType>('EXPENSE');
  readonly defaultGroup = input<CategoryGroup>('FAMILY');
  readonly allowGroupSelection = input(false);
  readonly closed = output<void>();
  readonly saved = output<TransactionCategory>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  readonly form = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    type: ['EXPENSE' as TransactionType, Validators.required],
    group: ['FAMILY' as CategoryGroup, Validators.required]
  });

  readonly modalOffsetX = signal(0);
  readonly modalOffsetY = signal(0);
  readonly allowedGroups = signal<CategoryGroup[]>(this.getAllowedGroups());
  @ViewChild('modalCard') private modalCard?: ElementRef<HTMLElement>;

  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragOriginX = 0;
  private dragOriginY = 0;

  constructor() {
    effect(() => {
    if (!this.isOpen()) {
        this.errorMessage.set('');
        this.successMessage.set('');
        return;
      }

      this.initializeForm();
      queueMicrotask(() => this.modalCard?.nativeElement.focus());
    }, { allowSignalWrites: true });
  }

  close(): void {
    this.closed.emit();
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

  onEscape(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    keyboardEvent.preventDefault();
    keyboardEvent.stopPropagation();
    this.close();
  }

  @HostListener('document:pointermove', ['$event'])
  onDocumentPointerMove(event: PointerEvent): void {
    if (!this.dragging) {
      return;
    }

    const nextX = this.dragOriginX + (event.clientX - this.dragStartX);
    const nextY = this.dragOriginY + (event.clientY - this.dragStartY);
    const { x, y } = this.clampToViewport(nextX, nextY);
    this.modalOffsetX.set(x);
    this.modalOffsetY.set(y);
  }

  @HostListener('document:pointerup')
  @HostListener('document:pointercancel')
  endDrag(): void {
    this.dragging = false;
  }

  submit(): void {
    if (this.form.invalid || this.isSubmitting()) {
      this.form.markAllAsTouched();
      return;
    }

    const mode = this.mode();
    const category = this.category();
    const parentCategory = this.parentCategory();
    const { name, type, group } = this.form.getRawValue();
    const trimmedName = name.trim();

    if (!trimmedName) {
      this.errorMessage.set(this.i18n.translate('categories.nameRequired'));
      this.form.markAllAsTouched();
      return;
    }

    this.errorMessage.set('');
    this.successMessage.set('');
    this.isSubmitting.set(true);

    const request: Partial<CreateTransactionCategoryPayload> = { name: trimmedName };

    if (mode === 'create-main') {
      request.type = type;
      request.group = this.allowGroupSelection() ? group : this.defaultGroup();
      request.parentCategoryId = null;
    } else if (mode === 'create-sub') {
      if (!parentCategory) {
        this.isSubmitting.set(false);
        this.errorMessage.set(this.i18n.translate('categories.parentMissing'));
        return;
      }

      request.type = (parentCategory.type === 'INCOME' ? 'INCOME' : 'EXPENSE');
      request.group = group;
      request.parentCategoryId = parentCategory.id;
    } else if (category) {
      request.type = category.type as TransactionType;
      request.group = group;
      request.parentCategoryId = category.parentCategoryId;
    }

    const request$ = mode === 'edit' && category
      ? this.transactionsService.updateCategory(category.id, request)
      : this.transactionsService.createCategory(request as CreateTransactionCategoryPayload);

    request$
      .pipe(finalize(() => this.isSubmitting.set(false)))
      .subscribe({
        next: (savedCategory) => {
          this.saved.emit(savedCategory);
          if (mode === 'edit') {
            this.closed.emit();
            return;
          }

          this.successMessage.set(this.i18n.translate('categories.createSuccess'));
          this.form.patchValue({
            name: '',
          }, { emitEvent: false });
        },
        error: (error: { error?: { message?: string } }) => {
          this.errorMessage.set(error.error?.message || this.getFallbackError(mode));
        }
      });
  }

  isEditMode(): boolean {
    return this.mode() === 'edit';
  }

  isCreateMainMode(): boolean {
    return this.mode() === 'create-main';
  }

  isCreateSubMode(): boolean {
    return this.mode() === 'create-sub';
  }

  getAllowedGroupOptions(): CategoryGroup[] {
    return this.allowedGroups();
  }

  getTitle(): string {
    if (this.isCreateMainMode()) {
      return this.i18n.translate('categories.createMainTitle');
    }

    if (this.isCreateSubMode()) {
      return this.i18n.translate('categories.createSubTitle', {
        name: this.parentCategory()?.name ?? ''
      });
    }

    return this.i18n.translate('categories.editTitle');
  }

  getSubmitLabel(): string {
    if (this.isEditMode()) {
      return this.i18n.translate('categories.save');
    }

    if (this.isCreateMainMode()) {
      return this.i18n.translate('categories.create');
    }

    return this.i18n.translate('categories.createSubcategory');
  }

  private initializeForm(): void {
    const category = this.category();
    const parentCategory = this.parentCategory();
    const mode = this.mode();

    this.form.patchValue({
      name: category?.name ?? '',
      type: mode === 'create-sub'
        ? ((parentCategory?.type as TransactionType | undefined) ?? 'EXPENSE')
        : (category?.type ? (category.type as TransactionType) : this.defaultType()),
      group: mode === 'create-sub'
        ? ((parentCategory?.group as CategoryGroup | undefined) ?? this.defaultGroup())
        : (category?.group ? (category.group as CategoryGroup) : this.defaultGroup())
    }, { emitEvent: false });

    if (mode === 'create-main' || mode === 'edit') {
      this.form.controls.group.enable({ emitEvent: false });
    } else if (mode === 'create-sub') {
      this.form.controls.group.enable({ emitEvent: false });
    } else {
      this.form.controls.group.disable({ emitEvent: false });
    }

    if (mode === 'create-main' || mode === 'edit') {
      this.form.controls.type.enable({ emitEvent: false });
    } else if (mode === 'create-sub') {
      this.form.controls.type.disable({ emitEvent: false });
    } else {
      this.form.controls.type.disable({ emitEvent: false });
    }
  }

  getModalTransform(): string {
    return `translate3d(${this.modalOffsetX()}px, ${this.modalOffsetY()}px, 0)`;
  }

  private clampToViewport(nextX: number, nextY: number): { x: number; y: number } {
    const width = Math.min(560, window.innerWidth - 32);
    const height = 360;
    const padding = 12;
    const maxX = Math.max(padding, window.innerWidth - width - padding);
    const maxY = Math.max(padding, window.innerHeight - height - padding);

    return {
      x: Math.min(Math.max(nextX, -maxX), maxX),
      y: Math.min(Math.max(nextY, -maxY), maxY)
    };
  }

  private getAllowedGroups(): CategoryGroup[] {
    const role = this.authService.getRole();
    if (role === 'ADMIN') {
      return ['FAMILY', 'CHILD', 'PARENT'];
    }
    if (role === 'PARENT') {
      return ['FAMILY', 'PARENT'];
    }
    return ['CHILD'];
  }

  private getFallbackError(mode: EditorMode): string {
    return mode === 'edit'
      ? this.i18n.translate('categories.saveFailed')
      : this.i18n.translate('categories.createFailed');
  }
}
