import { CommonModule } from '@angular/common';
import { Component, HostListener, computed, effect, input, output, signal } from '@angular/core';
import { inject } from '@angular/core';
import { TranslationService } from '../../../../core/services/i18n/translation.service';

export type ChartDetailModalType = 'monthly' | 'savings' | 'category';

export interface ChartDetailMonthlyBar {
  month: number;
  label: string;
  incomeHeight: number;
  expenseHeight: number;
  incomeY: number;
  expenseY: number;
  incomeValue: number;
  expenseValue: number;
}

export interface ChartDetailLinePoint {
  month: number;
  label: string;
  x: number;
  y: number;
  value: number;
}

export interface ChartDetailTick {
  value: number;
  y: number;
  label: string;
}

export interface ChartDetailPieSlice {
  label: string;
  color: string;
  path: string;
  percent: number;
  total: number;
}

export type ChartDetailModalData =
  | { kind: 'monthly'; year: number; bars: ChartDetailMonthlyBar[]; ticks: ChartDetailTick[] }
  | { kind: 'savings'; year: number; line: { points: string; dots: ChartDetailLinePoint[] }; ticks: ChartDetailTick[] }
  | { kind: 'category'; year: number; slices: ChartDetailPieSlice[] };

@Component({
  selector: 'app-chart-detail-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chart-detail-modal.component.html',
  styleUrl: './chart-detail-modal.component.css'
})
export class ChartDetailModalComponent {
  readonly i18n = inject(TranslationService);
  readonly chart = input<ChartDetailModalType | null>(null);
  readonly data = input<ChartDetailModalData | null>(null);
  readonly closed = output<void>();

  readonly modalOffsetX = signal(0);
  readonly modalOffsetY = signal(0);

  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragOriginX = 0;
  private dragOriginY = 0;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;

  readonly isOpen = computed(() => !!this.chart() && !!this.data());

  constructor() {
    effect(() => {
      if (!this.isOpen()) {
        return;
      }

      this.queueLayoutRefresh();
    });
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    if (!this.isOpen()) {
      return;
    }

    this.queueLayoutRefresh();
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.isOpen()) {
      this.close();
    }
  }

  private queueLayoutRefresh(): void {
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
    }

    this.resizeTimer = setTimeout(() => {
      // SVG charts derive sizing from CSS; this forces a layout pass after open/resize.
      this.modalOffsetX.update((value) => value);
      this.modalOffsetY.update((value) => value);
      this.resizeTimer = null;
    }, 50);
  }

  startDrag(event: PointerEvent): void {
    if (!this.isOpen()) {
      return;
    }

    this.dragging = true;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.dragOriginX = this.modalOffsetX();
    this.dragOriginY = this.modalOffsetY();
    (event.currentTarget as HTMLElement | null)?.setPointerCapture(event.pointerId);
  }

  onDrag(event: PointerEvent): void {
    if (!this.dragging) {
      return;
    }

    this.modalOffsetX.set(this.dragOriginX + (event.clientX - this.dragStartX));
    this.modalOffsetY.set(this.dragOriginY + (event.clientY - this.dragStartY));
  }

  stopDrag(event?: PointerEvent): void {
    if (event?.currentTarget) {
      try {
        (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
      } catch {
        // Ignore capture release errors.
      }
    }
    this.dragging = false;
  }

  close(): void {
    this.closed.emit();
  }

  getModalTransform(): string {
    return `translate3d(${this.modalOffsetX()}px, ${this.modalOffsetY()}px, 0)`;
  }

  isMonthly(data: ChartDetailModalData | null): data is Extract<ChartDetailModalData, { kind: 'monthly' }> {
    return !!data && data.kind === 'monthly';
  }

  isSavings(data: ChartDetailModalData | null): data is Extract<ChartDetailModalData, { kind: 'savings' }> {
    return !!data && data.kind === 'savings';
  }

  isCategory(data: ChartDetailModalData | null): data is Extract<ChartDetailModalData, { kind: 'category' }> {
    return !!data && data.kind === 'category';
  }

  trackByMonth(_index: number, item: ChartDetailMonthlyBar | ChartDetailLinePoint): number {
    return item.month;
  }

  trackByTick(_index: number, tick: ChartDetailTick): number {
    return tick.value;
  }

  trackBySlice(_index: number, slice: ChartDetailPieSlice): string {
    return `${slice.label}-${slice.total}`;
  }
}
