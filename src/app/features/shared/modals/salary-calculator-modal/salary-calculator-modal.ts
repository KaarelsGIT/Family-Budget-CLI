import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslationService } from '../../../../core/services/i18n/translation.service';

@Component({
  selector: 'app-salary-calculator-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './salary-calculator-modal.html',
  styleUrl: './salary-calculator-modal.css',
})
export class SalaryCalculatorModal {
  @Input() isOpen = false;
  @Output() closed = new EventEmitter<void>();

  readonly i18n = inject(TranslationService);

  grossSalaryInput = '2500';
  taxFreeAllowanceInput = '700';
  pensionEnabled = true;

  readonly socialTaxRate = 0.33;
  readonly incomeTaxRate = 0.22;
  readonly unemploymentInsuranceRate = 0.016;
  readonly employeePensionRate = 0.02;

  modalOffsetX = 0;
  modalOffsetY = 0;

  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragOriginX = 0;
  private dragOriginY = 0;

  close(): void {
    this.closed.emit();
  }

  get grossSalary(): number {
    return this.parseMoney(this.grossSalaryInput);
  }

  get taxFreeAllowance(): number {
    const allowance = this.parseMoney(this.taxFreeAllowanceInput);
    if (!Number.isFinite(allowance) || allowance < 0) {
      return 0;
    }
    return allowance;
  }

  get pensionContribution(): number {
    if (!this.pensionEnabled) {
      return 0;
    }

    return this.grossSalary * this.employeePensionRate;
  }

  get unemploymentContribution(): number {
    return this.grossSalary * this.unemploymentInsuranceRate;
  }

  get taxableIncome(): number {
    return Math.max(0, this.grossSalary - this.taxFreeAllowance - this.pensionContribution - this.unemploymentContribution);
  }

  get incomeTax(): number {
    return this.taxableIncome * this.incomeTaxRate;
  }

  get netSalary(): number {
    return Math.max(0, this.grossSalary - this.pensionContribution - this.unemploymentContribution - this.incomeTax);
  }

  get incomeTaxBarWidth(): number {
    return this.progressWidth(this.incomeTax, this.grossSalary);
  }

  get unemploymentBarWidth(): number {
    return this.progressWidth(this.unemploymentContribution, this.grossSalary);
  }

  get pensionBarWidth(): number {
    return this.progressWidth(this.pensionContribution, this.grossSalary);
  }

  onGrossSalaryInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (!input) {
      return;
    }

    const normalized = input.value.replace(/,/g, '.');
    if (input.value !== normalized) {
      input.value = normalized;
    }

    this.grossSalaryInput = normalized;
  }

  onTaxFreeAllowanceInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (!input) {
      return;
    }

    const normalized = input.value.replace(/,/g, '.');
    if (input.value !== normalized) {
      input.value = normalized;
    }

    this.taxFreeAllowanceInput = normalized;
  }

  formatMoney(value: number): string {
    return new Intl.NumberFormat(this.i18n.language(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number.isFinite(value) ? value : 0);
  }

  startDrag(event: PointerEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target || target.closest('button, input, select, label')) {
      return;
    }

    if (event.button !== 0) {
      return;
    }

    this.dragging = true;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.dragOriginX = this.modalOffsetX;
    this.dragOriginY = this.modalOffsetY;
  }

  @HostListener('document:pointermove', ['$event'])
  onDocumentPointerMove(event: PointerEvent): void {
    if (!this.dragging) {
      return;
    }

    this.modalOffsetX = this.dragOriginX + (event.clientX - this.dragStartX);
    this.modalOffsetY = this.dragOriginY + (event.clientY - this.dragStartY);
  }

  @HostListener('document:pointerup')
  @HostListener('document:pointercancel')
  endDrag(): void {
    this.dragging = false;
  }

  getModalTransform(): string {
    return `translate3d(${this.modalOffsetX}px, ${this.modalOffsetY}px, 0)`;
  }

  private parseMoney(value: string): number {
    const normalized = value.replace(/,/g, '.').trim();
    if (normalized === '') {
      return 0;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private progressWidth(value: number, gross: number): number {
    if (!Number.isFinite(gross) || gross <= 0) {
      return 0;
    }

    return Math.max(0, Math.min(100, (value / gross) * 100));
  }
}
