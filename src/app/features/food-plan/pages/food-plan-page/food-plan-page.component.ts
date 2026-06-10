import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { finalize } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../../../core/auth/auth.service';
import { TranslationService } from '../../../../core/services/i18n/translation.service';
import { FoodPlanService, FoodCalendarEntry, FoodRecipe, FoodRecipeType } from '../../services/food-plan.service';
import { FoodRecipeModalComponent } from '../../modals/food-recipe-modal/food-recipe-modal.component';
import { CalculatorComponent } from '../../../shared/modals/calculator-modal/calculator.component';

interface CalendarDay {
  date: string;
  label: number;
  weekday: string;
  entries: FoodCalendarEntry[];
  isCurrentMonth?: boolean;
}

interface RecipeFormIngredient {
  tempId: string;
  name: string;
  baseAmount: number | null;
  unit: string;
}

@Component({
  selector: 'app-food-plan-page',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule, FoodRecipeModalComponent, CalculatorComponent],
  templateUrl: './food-plan-page.component.html',
  styleUrl: './food-plan-page.component.css'
})
export class FoodPlanPageComponent {
  private readonly foodPlanService = inject(FoodPlanService);
  private readonly authService = inject(AuthService);
  readonly i18n = inject(TranslationService);

  readonly currentUserRole = this.authService.getRole();
  readonly isEditable = computed(() => this.currentUserRole === 'ADMIN' || this.currentUserRole === 'PARENT');
  readonly language = this.i18n.language;
  readonly selectedType = signal<FoodRecipeType | null>(null);
  readonly searchTerm = signal('');
  readonly recipes = signal<FoodRecipe[]>([]);
  readonly weekEntries = signal<FoodCalendarEntry[]>([]);
  readonly isLoading = signal(false);
  readonly selectedRecipe = signal<FoodRecipe | null>(null);
  readonly recipeToast = signal('');
  readonly pendingRecipeDelete = signal<FoodRecipe | null>(null);
  readonly isDeletingRecipe = signal(false);
  readonly recipeDeleteError = signal('');
  readonly isRecipeEditorOpen = signal(false);
  readonly editingRecipeId = signal<number | null>(null);
  readonly isRecipeCalculatorVisible = signal(false);
  readonly isRatingSaving = signal(false);
  private toastTimeout: ReturnType<typeof window.setTimeout> | null = null;
  readonly recipeModalOffsetX = signal(0);
  readonly recipeModalOffsetY = signal(0);
  private readonly createIngredientId = () => {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }

    return `ingredient-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  };
  readonly recipeForm = signal({
    name: '',
    type: 'PRAAD' as FoodRecipeType,
    instructions: '',
    baseServings: 2,
    cost: 0,
    ingredients: [{ tempId: this.createIngredientId(), name: '', baseAmount: 1, unit: 'tk' }] as RecipeFormIngredient[]
  });
  readonly weekStart = signal(this.getWeekStart(new Date()));
  readonly monthAnchor = signal(new Date());
  readonly viewMode = signal<'week' | 'month'>('week');
  readonly isWeekAnimating = signal(false);
  readonly isCalendarDragging = signal(false);
  readonly draggedCalendarEntry = signal<FoodCalendarEntry | null>(null);
  readonly recipePickerDate = signal<string | null>(null);
  readonly errorMessage = signal('');
  private recipeModalDragging = false;
  private recipeDragStartX = 0;
  private recipeDragStartY = 0;
  private recipeDragOriginX = 0;
  private recipeDragOriginY = 0;
  private trashDropCommitted = false;
  @ViewChild('trashZone') private trashZone?: ElementRef<HTMLElement>;

  readonly labels = computed(() => ({
    locale: this.language(),
    title: this.i18n.translate('foodPlan.title'),
    copy: this.i18n.translate('foodPlan.copy'),
    searchPlaceholder: this.i18n.translate('foodPlan.searchPlaceholder'),
    allTypes: this.i18n.translate('foodPlan.allTypes'),
    addRecipe: this.i18n.translate('foodPlan.addRecipe'),
    recipeBook: this.i18n.translate('foodPlan.recipeBook'),
    weekView: this.i18n.translate('foodPlan.weekView'),
    servings: this.i18n.translate('foodPlan.servings'),
    ingredients: this.i18n.translate('foodPlan.ingredients'),
    instructions: this.i18n.translate('foodPlan.instructions'),
    rating: this.i18n.translate('foodPlan.rating'),
    saveRating: this.i18n.translate('foodPlan.saveRating'),
    delete: this.i18n.translate('foodPlan.delete'),
    noRecipes: this.i18n.translate('foodPlan.noRecipes'),
    noCalendar: this.i18n.translate('foodPlan.noCalendar'),
    readOnly: this.i18n.translate('foodPlan.readOnly'),
    monday: this.i18n.translate('foodPlan.monday'),
    tuesday: this.i18n.translate('foodPlan.tuesday'),
    wednesday: this.i18n.translate('foodPlan.wednesday'),
    thursday: this.i18n.translate('foodPlan.thursday'),
    friday: this.i18n.translate('foodPlan.friday'),
    saturday: this.i18n.translate('foodPlan.saturday'),
    sunday: this.i18n.translate('foodPlan.sunday'),
    dragToRemoveTitle: this.i18n.translate('foodPlan.dragToRemoveTitle')
  }));
  readonly dragToRemoveHint = computed(() =>
    this.i18n.translate('foodPlan.dragToRemoveHint', {
      recipe: this.draggedCalendarEntry()?.recipe.name ?? ''
    })
  );
  readonly todayIso = this.toLocalIso(new Date());

  readonly filteredRecipes = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    return this.recipes().filter((recipe) =>
      (!this.selectedType() || recipe.type === this.selectedType()) &&
      (!term || recipe.name.toLowerCase().includes(term))
    );
  });

  readonly days = computed<CalendarDay[]>(() => {
    const start = this.parseLocalDate(this.weekStart());
    const entries = this.weekEntries();
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const isoDate = this.toLocalIso(date);
      return {
        date: isoDate,
        label: date.getDate(),
        weekday: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'][index],
        entries: entries.filter((entry) => entry.date === isoDate)
      };
    });
  });

  readonly monthDays = computed<CalendarDay[]>(() => {
    const anchor = this.monthAnchor();
    const firstDay = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const lastDay = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    const start = new Date(firstDay);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = new Date(lastDay);
    end.setDate(end.getDate() + (6 - ((end.getDay() + 6) % 7)));
    const entries = this.weekEntries();
    const days: CalendarDay[] = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const isoDate = this.toLocalIso(cursor);
      days.push({
        date: isoDate,
        label: cursor.getDate(),
        weekday: '',
        entries: entries.filter((entry) => entry.date === isoDate),
        isCurrentMonth: cursor.getMonth() === anchor.getMonth()
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  });

  constructor() {
    this.loadRecipes();
    this.loadWeek();
  }

  loadRecipes(): void {
    this.foodPlanService.getRecipes(this.selectedType(), this.searchTerm()).subscribe({
      next: (recipes) => this.recipes.set(recipes),
      error: () => this.recipes.set([])
    });
  }

  loadWeek(): void {
    this.isLoading.set(true);
    this.foodPlanService.getWeek(this.weekStart()).pipe(finalize(() => this.isLoading.set(false))).subscribe({
      next: (week) => this.weekEntries.set(week.entries),
      error: () => this.weekEntries.set([])
    });
  }

  onSearchChange(value: string): void {
    this.searchTerm.set(value);
    this.loadRecipes();
  }

  onTypeChange(value: FoodRecipeType | null): void {
    this.selectedType.set(value);
    this.loadRecipes();
  }

  openRecipe(recipe: FoodRecipe): void {
    this.selectedRecipe.set(recipe);
  }

  openDayRecipePicker(date: string): void {
    if (!this.isEditable()) {
      return;
    }
    this.recipePickerDate.set(date);
  }

  closeDayRecipePicker(): void {
    this.recipePickerDate.set(null);
  }

  canEditRecipe(recipe: FoodRecipe | null | undefined): boolean {
    const currentUserId = this.authService.getUserId();
    return !!recipe && currentUserId !== null && (recipe.ownerId == null || recipe.ownerId === currentUserId);
  }

  openRecipeEditor(recipe?: FoodRecipe): void {
    this.editingRecipeId.set(recipe?.id ?? null);
    this.isRecipeCalculatorVisible.set(false);
    this.recipeModalOffsetX.set(0);
    this.recipeModalOffsetY.set(0);
    this.recipeForm.set(recipe ? {
      name: recipe.name,
      type: recipe.type,
      instructions: recipe.instructions,
      baseServings: recipe.baseServings,
      cost: recipe.cost,
      ingredients: recipe.ingredients.map((ingredient) => ({
        tempId: this.createIngredientId(),
        name: ingredient.name,
        baseAmount: ingredient.baseAmount,
        unit: ingredient.unit
      }))
    } : {
      name: '',
      type: 'PRAAD',
      instructions: '',
      baseServings: 2,
      cost: 0,
      ingredients: [{ tempId: this.createIngredientId(), name: '', baseAmount: 1, unit: 'tk' }]
    });
    this.isRecipeEditorOpen.set(true);
  }

  closeRecipeEditor(): void {
    this.isRecipeEditorOpen.set(false);
    this.isRecipeCalculatorVisible.set(false);
  }

  openRecipeEditorCalculator(): void {
    this.isRecipeCalculatorVisible.set(true);
  }

  closeRecipeEditorCalculator(): void {
    this.isRecipeCalculatorVisible.set(false);
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentEscape(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key !== 'Escape') {
      return;
    }

    if (this.isRecipeCalculatorVisible()) {
      keyboardEvent.preventDefault();
      keyboardEvent.stopPropagation();
      this.closeRecipeEditorCalculator();
      return;
    }

    if (this.isRecipeEditorOpen()) {
      keyboardEvent.preventDefault();
      keyboardEvent.stopPropagation();
      this.closeRecipeEditor();
    }
  }

  startRecipeModalDrag(event: PointerEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input, textarea, select')) {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    this.recipeModalDragging = true;
    this.recipeDragStartX = event.clientX;
    this.recipeDragStartY = event.clientY;
    this.recipeDragOriginX = this.recipeModalOffsetX();
    this.recipeDragOriginY = this.recipeModalOffsetY();
  }

  @HostListener('document:pointermove', ['$event'])
  onRecipeModalPointerMove(event: PointerEvent): void {
    if (!this.recipeModalDragging) return;
    this.recipeModalOffsetX.set(this.recipeDragOriginX + (event.clientX - this.recipeDragStartX));
    this.recipeModalOffsetY.set(this.recipeDragOriginY + (event.clientY - this.recipeDragStartY));
  }

  @HostListener('document:pointerup')
  @HostListener('document:pointercancel')
  onRecipeModalPointerUp(): void {
    this.recipeModalDragging = false;
  }

  getRecipeModalTransform(): string {
    return `translate3d(${this.recipeModalOffsetX()}px, ${this.recipeModalOffsetY()}px, 0)`;
  }

  addIngredient(): void {
    this.recipeForm.update((form) => ({
      ...form,
      ingredients: [...form.ingredients, { tempId: this.createIngredientId(), name: '', baseAmount: 1, unit: 'tk' }]
    }));
  }

  removeIngredient(index: number): void {
    this.recipeForm.update((form) => ({
      ...form,
      ingredients: form.ingredients.filter((_, currentIndex) => currentIndex !== index)
    }));
  }

  trackByIngredientId(index: number, ingredient: RecipeFormIngredient): string {
    return ingredient.tempId;
  }

  saveRecipe(): void {
    const form = this.recipeForm();
    const payload = {
      name: form.name.trim(),
      type: form.type,
      instructions: form.instructions.trim(),
      baseServings: Number(form.baseServings),
      cost: Number(form.cost),
      ingredients: form.ingredients
        .filter((ingredient) => ingredient.name.trim())
        .map((ingredient) => ({
          name: ingredient.name.trim(),
          baseAmount: Number(ingredient.baseAmount ?? 0),
          unit: ingredient.unit.trim()
        }))
    };

    if (!payload.name || !payload.instructions || payload.baseServings <= 0) {
      return;
    }

    const request = this.editingRecipeId()
      ? this.foodPlanService.updateRecipe(this.editingRecipeId()!, payload)
      : this.foodPlanService.createRecipe(payload);

    request.subscribe({
      next: (savedRecipe) => {
        this.isRecipeEditorOpen.set(false);
        this.syncRecipe(savedRecipe);
        this.showToast(this.editingRecipeId() ? 'Retsept uuendatud' : 'Retsept salvestatud');
      }
    });
  }

  closeRecipe(): void {
    this.selectedRecipe.set(null);
  }

  requestRecipeDelete(recipe: FoodRecipe): void {
    this.recipeDeleteError.set('');
    this.pendingRecipeDelete.set(recipe);
  }

  closeRecipeDeleteConfirmation(): void {
    this.pendingRecipeDelete.set(null);
    this.recipeDeleteError.set('');
  }

  confirmRecipeDelete(): void {
    const recipe = this.pendingRecipeDelete();
    if (!recipe) {
      return;
    }
    this.isDeletingRecipe.set(true);
    this.recipeDeleteError.set('');
    this.foodPlanService.deleteRecipe(recipe.id).subscribe({
      next: () => {
        if (this.selectedRecipe()?.id === recipe.id) {
          this.selectedRecipe.set(null);
        }
        this.pendingRecipeDelete.set(null);
        this.isDeletingRecipe.set(false);
        this.recipes.update((items) => items.filter((item) => item.id !== recipe.id));
        this.weekEntries.update((entries) => entries.filter((entry) => entry.recipe.id !== recipe.id));
        this.showToast('Retsept kustutatud');
      },
      error: (error: HttpErrorResponse) => {
        this.isDeletingRecipe.set(false);
        this.recipeDeleteError.set(error.error?.message || error.message || 'Retsepti kustutamine ebaõnnestus');
      }
    });
  }

  addRecipeToDate(recipe: FoodRecipe, date: string): void {
    if (!this.isEditable()) return;
    const optimisticEntry: FoodCalendarEntry = {
      id: Date.now(),
      date,
      recipe
    };
    this.weekEntries.update((entries) => [...entries, optimisticEntry]);
    this.foodPlanService.addToCalendar({ recipeId: recipe.id, date }).subscribe({
      next: (entry) => {
        this.weekEntries.update((entries) =>
          entries.map((current) => (current.id === optimisticEntry.id ? entry : current))
        );
      },
      error: () => this.loadWeek()
    });
  }

  selectRecipeForDate(recipe: FoodRecipe, date: string): void {
    this.addRecipeToDate(recipe, date);
    this.closeDayRecipePicker();
    this.showToast(this.i18n.translate('foodPlan.addedToCalendar'));
  }

  formatPickerDate(dateIso: string): string {
    const date = this.parseLocalDate(dateIso);
    return new Intl.DateTimeFormat(this.labels().locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(date);
  }

  handleDrop(event: CdkDragDrop<any>, targetDate?: string): void {
    if (!this.isEditable()) return;
    const dragged = event.item.data as FoodRecipe | FoodCalendarEntry;
    if ('baseServings' in dragged) {
      if (targetDate) {
        this.addRecipeToDate(dragged, targetDate);
      }
      return;
    }

    const destinationDate = targetDate ?? this.days()[event.currentIndex]?.date;
    if (!destinationDate) return;
    const previousEntries = this.weekEntries();
    const optimisticDate = destinationDate;
    this.weekEntries.update((entries) =>
      entries.map((current) => current.id === dragged.id ? { ...current, date: optimisticDate } : current)
    );
    this.foodPlanService.moveCalendarEntry(dragged.id, { date: destinationDate }).subscribe({
      next: (entry) => {
        this.weekEntries.update((entries) =>
          entries.map((current) => current.id === dragged.id ? entry : current)
        );
      },
      error: () => this.weekEntries.set(previousEntries)
    });
  }

  onCalendarDragStarted(entry: FoodCalendarEntry): void {
    this.isCalendarDragging.set(true);
    this.draggedCalendarEntry.set(entry);
  }

  onCalendarDragEnded(event: any): void {
    if (!this.trashDropCommitted && this.isPointInsideTrashZone(event?.dropPoint ?? event?.pointerPosition ?? event)) {
      const entry = this.draggedCalendarEntry();
      if (entry) {
        this.deleteEntry(entry);
      }
    }
    this.trashDropCommitted = false;
    this.isCalendarDragging.set(false);
    this.draggedCalendarEntry.set(null);
  }

  deleteDraggedEntryFromCalendar(event: CdkDragDrop<any>): void {
    if (!this.isEditable()) return;
    const dragged = event.item.data as FoodCalendarEntry | FoodRecipe;
    if ('baseServings' in dragged) {
      return;
    }
    this.trashDropCommitted = true;
    this.deleteEntry(dragged);
  }

  moveDayEntry(entry: FoodCalendarEntry, date: string): void {
    if (!this.isEditable()) return;
    const previousEntries = this.weekEntries();
    this.weekEntries.update((entries) => entries.map((current) => current.id === entry.id ? { ...current, date } : current));
    this.foodPlanService.moveCalendarEntry(entry.id, { date }).subscribe({
      next: (updated) => {
        this.weekEntries.update((entries) => entries.map((current) => current.id === entry.id ? updated : current));
      },
      error: () => this.weekEntries.set(previousEntries)
    });
  }

  deleteEntry(entry: FoodCalendarEntry): void {
    if (!this.isEditable()) return;
    const previousEntries = this.weekEntries();
    this.weekEntries.update((entries) => entries.filter((current) => current.id !== entry.id));
    this.foodPlanService.deleteCalendarEntry(entry.id).subscribe({
      error: () => this.weekEntries.set(previousEntries)
    });
  }

  generateShoppingList(): void {
    this.showToast('Ostunimekirja genereerimine lisatakse peagi');
  }

  saveRating(rating: number): void {
    const recipe = this.selectedRecipe();
    if (!recipe) return;
    this.isRatingSaving.set(true);
    const previousRecipe = { ...recipe };
    const optimisticRecipe = { ...recipe, myRating: rating };
    this.syncRecipe(optimisticRecipe);
    this.foodPlanService.saveRating(recipe.id, rating).subscribe({
      next: () => {
        this.foodPlanService.getRecipe(recipe.id).subscribe({
          next: (updated) => {
            this.syncRecipe(updated);
            this.selectedRecipe.set(updated);
            this.showToast('Hinne salvestatud');
          },
          error: () => {
            this.syncRecipe(previousRecipe);
          }
        });
      },
      error: () => {
        this.syncRecipe(previousRecipe);
      },
      complete: () => this.isRatingSaving.set(false)
    });
  }

  trackById(_: number, item: { id: number }): number {
    return item.id;
  }

  isToday(date: string): boolean {
    return date === this.todayIso;
  }

  recipeStripeColor(type: FoodRecipeType): string {
    switch (type) {
      case 'SUPP':
        return '#9CAF88';
      case 'MAGUSTOIT':
        return '#D99A2B';
      case 'PRAAD':
      default:
        return '#1F7A1F';
    }
  }

  formatRating(value: number | null | undefined): string {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return '—';
    }
    return value.toFixed(1);
  }

  weekdayFromDate(date: string): string {
    const day = this.parseLocalDate(date).getDay();
    const map = [this.labels().sunday, this.labels().monday, this.labels().tuesday, this.labels().wednesday, this.labels().thursday, this.labels().friday, this.labels().saturday];
    return map[day];
  }

  changeMonth(delta: number): void {
    this.animateWeekChange();
    const anchor = new Date(this.monthAnchor());
    anchor.setMonth(anchor.getMonth() + delta);
    this.monthAnchor.set(anchor);
    this.weekStart.set(this.getWeekStart(anchor));
    this.loadWeek();
  }

  goToCurrentWeek(): void {
    this.animateWeekChange();
    const today = new Date();
    this.monthAnchor.set(today);
    this.weekStart.set(this.getWeekStart(today));
    this.loadWeek();
  }

  setViewMode(mode: 'week' | 'month'): void {
    this.animateWeekChange();
    this.viewMode.set(mode);
    this.weekStart.set(this.getWeekStart(this.monthAnchor()));
    this.loadWeek();
  }

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    if (this.recipePickerDate()) {
      this.closeDayRecipePicker();
      return;
    }
    this.closeRecipe();
  }

  private getWeekStart(date: Date): string {
    const copy = new Date(date);
    const day = copy.getDay() || 7;
    copy.setDate(copy.getDate() - day + 1);
    return this.toLocalIso(copy);
  }

  private parseLocalDate(isoDate: string): Date {
    const [year, month, day] = isoDate.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  private toLocalIso(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  weekdayLabel(index: number): string {
    return [this.labels().monday, this.labels().tuesday, this.labels().wednesday, this.labels().thursday, this.labels().friday, this.labels().saturday, this.labels().sunday][index];
  }

  private syncRecipe(recipe: FoodRecipe): void {
    this.recipes.update((items) => {
      const exists = items.some((item) => item.id === recipe.id);
      if (!exists) {
        return [recipe, ...items];
      }

      return items.map((item) => (item.id === recipe.id ? { ...item, ...recipe } : item));
    });
    this.weekEntries.update((entries) =>
      entries.map((entry) => entry.recipe.id === recipe.id ? { ...entry, recipe: { ...entry.recipe, ...recipe } } : entry)
    );
    if (this.selectedRecipe()?.id === recipe.id) {
      this.selectedRecipe.set({ ...this.selectedRecipe()!, ...recipe });
    }
  }

  private showToast(message: string): void {
    this.recipeToast.set(message);
    if (this.toastTimeout) {
      window.clearTimeout(this.toastTimeout);
    }
    this.toastTimeout = window.setTimeout(() => this.recipeToast.set(''), 1800);
  }

  private animateWeekChange(): void {
    this.isWeekAnimating.set(false);
    requestAnimationFrame(() => this.isWeekAnimating.set(true));
    window.setTimeout(() => this.isWeekAnimating.set(false), 220);
  }

  private isPointInsideTrashZone(point: { x?: number; y?: number } | null | undefined): boolean {
    const zone = this.trashZone?.nativeElement;
    if (!zone || point?.x === undefined || point?.y === undefined) {
      return false;
    }

    const rect = zone.getBoundingClientRect();
    return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
  }
}
