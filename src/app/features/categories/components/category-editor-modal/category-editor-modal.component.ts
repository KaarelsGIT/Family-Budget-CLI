import { CommonModule } from '@angular/common';
import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { TranslationService } from '../../../../i18n/translation.service';
import {
  CreateTransactionCategoryPayload,
  TransactionCategory
} from '../../../transactions/models/transaction.model';
import { TransactionsService } from '../../../transactions/services/transactions.service';
import { parseMoneyInput } from '../../../../shared/utils/money-format';

type TransactionType = 'INCOME' | 'EXPENSE';
type CategoryGroup = 'FAMILY' | 'CHILD';
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
    group: ['FAMILY' as CategoryGroup, Validators.required],
    isRecurring: [false],
    dueDayOfMonth: [''],
    recurringAmount: ['']
  });

  constructor() {
    effect(() => {
      if (!this.isOpen()) {
        this.errorMessage.set('');
        this.successMessage.set('');
        return;
      }

      this.initializeForm();
    }, { allowSignalWrites: true });

    this.form.controls.isRecurring.valueChanges.subscribe((isRecurring) => {
      if (!isRecurring) {
        this.form.patchValue({ dueDayOfMonth: '' }, { emitEvent: false });
      }
      this.syncRecurringValidators();
    });

    this.form.controls.type.valueChanges.subscribe(() => this.syncRecurringValidators());
  }

  close(): void {
    this.closed.emit();
  }

  submit(): void {
    if (this.form.invalid || this.isSubmitting()) {
      this.form.markAllAsTouched();
      return;
    }

    const mode = this.mode();
    const category = this.category();
    const parentCategory = this.parentCategory();
    const { name, type, group, isRecurring, dueDayOfMonth } = this.form.getRawValue();
    const trimmedName = name.trim();

    if (!trimmedName) {
      this.errorMessage.set(this.i18n.translate('categories.nameRequired'));
      this.form.markAllAsTouched();
      return;
    }

    const recurringEnabled = this.supportsRecurring()
      ? Boolean(isRecurring)
      : false;
    let parsedDueDay: number | null = null;
    if (recurringEnabled) {
      const candidate = Number.parseInt(String(dueDayOfMonth ?? ''), 10);
      if (!Number.isInteger(candidate) || candidate < 1 || candidate > 31) {
        this.errorMessage.set(this.i18n.translate('categories.dueDayInvalid'));
        this.form.markAllAsTouched();
        return;
      }
      parsedDueDay = candidate;
    }

    let parsedRecurringAmount: number | null = null;
    if (recurringEnabled) {
      const candidate = parseMoneyInput(this.form.controls.recurringAmount.value);
      if (!Number.isFinite(candidate) || candidate <= 0) {
        this.errorMessage.set(this.i18n.translate('categories.recurringAmountInvalid'));
        this.form.markAllAsTouched();
        return;
      }
      parsedRecurringAmount = candidate;
    }

    this.errorMessage.set('');
    this.successMessage.set('');
    this.isSubmitting.set(true);

    const request: Partial<CreateTransactionCategoryPayload> = {
      name: trimmedName
    };

    if (mode === 'create-main') {
      request.type = type;
      request.group = this.allowGroupSelection() ? group : this.defaultGroup();
      request.parentCategoryId = null;
      request.isRecurring = false;
      request.dueDayOfMonth = null;
      request.recurringAmount = null;
    } else if (mode === 'create-sub') {
      if (!parentCategory) {
        this.isSubmitting.set(false);
        this.errorMessage.set(this.i18n.translate('categories.parentMissing'));
        return;
      }

      request.type = (parentCategory.type === 'INCOME' ? 'INCOME' : 'EXPENSE');
      request.group = parentCategory.group as CategoryGroup;
      request.parentCategoryId = parentCategory.id;
      request.isRecurring = recurringEnabled;
      request.dueDayOfMonth = recurringEnabled ? parsedDueDay : null;
      request.recurringAmount = recurringEnabled ? parsedRecurringAmount : null;
    } else if (category) {
      request.isRecurring = recurringEnabled;
      if (this.supportsRecurring()) {
        request.dueDayOfMonth = recurringEnabled ? parsedDueDay : null;
        request.recurringAmount = recurringEnabled ? parsedRecurringAmount : null;
      }
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
            isRecurring: false,
            dueDayOfMonth: '',
            recurringAmount: ''
          }, { emitEvent: false });
        },
        error: (error: { error?: { message?: string } }) => {
          this.errorMessage.set(error.error?.message || this.getFallbackError(mode));
        }
      });
  }

  supportsRecurring(): boolean {
    const categoryType = this.mode() === 'create-sub'
      ? (this.parentCategory()?.type as TransactionType | undefined)
      : this.mode() === 'edit'
        ? (this.category()?.type as TransactionType | undefined)
        : this.form.controls.type.value;

    const parentCategoryId = this.mode() === 'create-sub'
      ? this.parentCategory()?.id ?? null
      : this.category()?.parentCategoryId ?? null;

    return categoryType === 'EXPENSE' && parentCategoryId !== null;
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
        : (category?.group ? (category.group as CategoryGroup) : this.defaultGroup()),
      isRecurring: category?.isRecurring ?? false,
      dueDayOfMonth: category?.dueDayOfMonth === null || category?.dueDayOfMonth === undefined
        ? ''
        : String(category.dueDayOfMonth),
      recurringAmount: category?.recurringAmount === null || category?.recurringAmount === undefined
        ? ''
        : String(category.recurringAmount)
    }, { emitEvent: false });

    if (this.allowGroupSelection()) {
      this.form.controls.group.enable({ emitEvent: false });
    } else {
      this.form.controls.group.disable({ emitEvent: false });
    }

    if (mode === 'create-main') {
      this.form.controls.type.enable({ emitEvent: false });
      this.form.controls.isRecurring.setValue(false, { emitEvent: false });
    } else if (mode === 'create-sub') {
      this.form.controls.type.disable({ emitEvent: false });
      this.form.controls.group.disable({ emitEvent: false });
    } else {
      this.form.controls.type.disable({ emitEvent: false });
      this.form.controls.group.disable({ emitEvent: false });
    }

    this.syncRecurringValidators();
  }

  private syncRecurringValidators(): void {
    const recurringControl = this.form.controls.isRecurring;
    const dueDayControl = this.form.controls.dueDayOfMonth;

    if (!this.supportsRecurring()) {
      recurringControl.setValue(false, { emitEvent: false });
      dueDayControl.clearValidators();
      dueDayControl.setValue('', { emitEvent: false });
      this.form.controls.recurringAmount.setValue('', { emitEvent: false });
      dueDayControl.updateValueAndValidity({ emitEvent: false });
      return;
    }

    dueDayControl.setValidators(recurringControl.value
      ? [Validators.required, Validators.min(1), Validators.max(31)]
      : [Validators.min(1), Validators.max(31)]);
    this.form.controls.recurringAmount.setValidators(recurringControl.value
      ? [Validators.required, Validators.min(0.01)]
      : []);
    if (!recurringControl.value) {
      this.form.controls.recurringAmount.setValue('', { emitEvent: false });
    }
    this.form.controls.recurringAmount.updateValueAndValidity({ emitEvent: false });
    dueDayControl.updateValueAndValidity({ emitEvent: false });
  }

  normalizeMoneyInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (!input) {
      return;
    }

    const normalized = input.value.replace(/,/g, '.');
    if (input.value !== normalized) {
      input.value = normalized;
    }
  }

  private getFallbackError(mode: EditorMode): string {
    return mode === 'edit'
      ? this.i18n.translate('categories.saveFailed')
      : this.i18n.translate('categories.createFailed');
  }
}
