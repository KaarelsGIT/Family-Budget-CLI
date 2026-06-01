import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, OnChanges, Output, SimpleChanges, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CalculatorComponent } from '../../../shared/modals/calculator-modal/calculator.component';
import { FoodRecipe } from '../../services/food-plan.service';

@Component({
  selector: 'app-food-recipe-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, CalculatorComponent],
  templateUrl: './food-recipe-modal.component.html',
  styleUrl: './food-recipe-modal.component.css'
})
export class FoodRecipeModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() recipe: FoodRecipe | null = null;
  @Input() canEdit = false;
  @Output() closed = new EventEmitter<void>();
  @Output() ratingSaved = new EventEmitter<number>();

  readonly servings = signal(0);
  readonly selectedRating = signal(0);
  readonly modalOffsetX = signal(0);
  readonly modalOffsetY = signal(0);
  readonly isCalculatorVisible = signal(false);
  readonly ratingPulse = signal(false);
  readonly ratingSavedHint = signal(false);
  readonly hoveredRating = signal(0);

  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragOriginX = 0;
  private dragOriginY = 0;

  readonly scaledIngredients = computed(() => {
    const recipe = this.recipe;
    const servings = this.servings();
    if (!recipe || !recipe.baseServings || servings <= 0) {
      return [];
    }

    return recipe.ingredients.map((ingredient) => ({
      ...ingredient,
      amount: (ingredient.baseAmount / recipe.baseServings) * servings
    }));
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['recipe'] && this.recipe) {
      this.servings.set(this.recipe.baseServings);
      this.selectedRating.set(this.recipe.myRating ?? 0);
      this.hoveredRating.set(0);
      this.modalOffsetX.set(0);
      this.modalOffsetY.set(0);
      this.isCalculatorVisible.set(false);
    }
  }

  startDrag(event: PointerEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input, textarea, select')) {
      return;
    }
    if (event.button !== 0) return;
    event.preventDefault();
    this.dragging = true;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.dragOriginX = this.modalOffsetX();
    this.dragOriginY = this.modalOffsetY();
  }

  @HostListener('document:pointermove', ['$event'])
  onDocumentPointerMove(event: PointerEvent): void {
    if (!this.dragging) return;
    this.modalOffsetX.set(this.dragOriginX + (event.clientX - this.dragStartX));
    this.modalOffsetY.set(this.dragOriginY + (event.clientY - this.dragStartY));
  }

  @HostListener('document:pointerup')
  @HostListener('document:pointercancel')
  onDocumentPointerUp(): void {
    this.dragging = false;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isCalculatorVisible()) {
      this.closeCalculator();
      return;
    }
    this.close();
  }

  close(): void {
    this.isCalculatorVisible.set(false);
    this.closed.emit();
  }

  openCalculator(): void {
    this.isCalculatorVisible.set(true);
  }

  closeCalculator(): void {
    this.isCalculatorVisible.set(false);
  }

  saveRating(): void {
    if (this.recipe && this.selectedRating() >= 1 && this.selectedRating() <= 5) {
      this.ratingPulse.set(true);
      this.ratingSavedHint.set(true);
      this.ratingSaved.emit(this.selectedRating());
      window.setTimeout(() => this.ratingPulse.set(false), 220);
      window.setTimeout(() => this.ratingSavedHint.set(false), 1400);
    }
  }

  rate(star: number): void {
    this.selectedRating.set(star);
    this.saveRating();
  }

  previewRating(star: number): void {
    this.hoveredRating.set(star);
  }

  clearPreview(): void {
    this.hoveredRating.set(0);
  }

  getModalTransform(): string {
    return `translate3d(${this.modalOffsetX()}px, ${this.modalOffsetY()}px, 0)`;
  }

  starValues(): number[] {
    return [1, 2, 3, 4, 5];
  }

  isStarFilled(star: number): boolean {
    const preview = this.hoveredRating();
    return star <= (preview || this.selectedRating());
  }
}
