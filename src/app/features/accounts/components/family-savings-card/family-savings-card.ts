import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslationService } from '../../../../core/services/i18n/translation.service';
import { formatMoney } from '../../../shared/utils/money-format';
import { Account } from '../../models/account.model';

@Component({
  selector: 'app-family-savings-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './family-savings-card.component.html',
  styleUrl: './family-savings-card.component.css'
})
export class FamilySavingsCardComponent {
  readonly i18n = inject(TranslationService);

  readonly accounts = input<Account[]>([]);
  readonly selectedAccountIds = input<number[]>([]);
  readonly addRequested = output<void>();

  readonly isReady = signal(false);
  readonly ringCircumference = 2 * Math.PI * 52;

  readonly total = computed(() => {
    const selected = new Set(this.selectedAccountIds());
    return this.accounts()
      .filter((account) => selected.has(account.id))
      .reduce((sum, account) => sum + account.balance, 0);
  });

  readonly progress = computed(() => {
    const total = this.total();
    const target = this.targetAmount() ?? 0;
    return target > 0 ? Math.max(0, Math.min(100, (total / target) * 100)) : 0;
  });

  readonly targetAmount = input<number | null>(null);
  readonly targetDate = input<string | null>(null);
  readonly strokeDashoffset = computed(() => {
    if (!this.isReady()) {
      return this.ringCircumference;
    }
    return this.ringCircumference * (1 - this.progress() / 100);
  });

  constructor() {
    requestAnimationFrame(() => this.isReady.set(true));
  }

  formatBalance(value: number): string {
    return formatMoney(value);
  }
}
