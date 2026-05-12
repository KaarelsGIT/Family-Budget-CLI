import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, output } from '@angular/core';
import { Account } from '../../models/account.model';
import { AccountCardComponent } from '../account-card/account-card.component';
import { TranslationService } from '../../../../core/services/i18n/translation.service';
import { formatMoney } from '../../../shared/utils/money-format';

export interface FamilyUserCardData {
  ownerId: number;
  ownerUsername: string;
  ownerRole: Account['ownerRole'] | null;
  accounts: Account[];
}

@Component({
  selector: 'app-family-user-card',
  standalone: true,
  imports: [CommonModule, AccountCardComponent],
  templateUrl: './family-user-card.component.html',
  styleUrl: './family-user-card.component.css'
})
export class FamilyUserCardComponent {
  readonly user = input.required<FamilyUserCardData>();
  readonly changed = output<void>();
  readonly transferRequested = output<Account>();
  readonly adjustBalanceRequested = output<Account>();
  readonly shareRequested = output<Account>();
  readonly i18n = inject(TranslationService);

  readonly total = computed(() => this.user().accounts.reduce((sum, account) => sum + account.balance, 0));

  formatBalance(value: number): string {
    return formatMoney(value);
  }

  trackByAccountId(_index: number, account: Account): number {
    return account.id;
  }

  getAccountColor(index: number): string {
    const colors = ['#1f6f4a', '#2d8a64', '#4aa36f', '#77b255', '#d07c3e', '#b13f5f', '#4969c4', '#8a52c8'];
    return colors[index % colors.length];
  }
}
