import { CommonModule } from '@angular/common';
import { Component, inject, input, output, signal, viewChild } from '@angular/core';
import { finalize } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { TranslationService } from '../../../../core/services/i18n/translation.service';
import { Account, AccountMonthlySummary } from '../../models/account.model';
import { AccountService } from '../../services/account.service';
import { EditAccountInlineComponent } from '../edit-account-inline/edit-account-inline.component';
import { formatMoney } from '../../../shared/utils/money-format';
import {
  canManageSavingsGoal,
  canShareAccount as canShareAccountForUser,
  canTransactFromAccount
} from '../../utils/account-access';

@Component({
  selector: 'app-account-card',
  standalone: true,
  imports: [CommonModule, EditAccountInlineComponent],
  templateUrl: './account-card.component.html',
  styleUrl: './account-card.component.css'
})
export class AccountCardComponent {
  private readonly accountService = inject(AccountService);
  private readonly authService = inject(AuthService);
  readonly i18n = inject(TranslationService);

  readonly account = input.required<Account>();
  readonly accentColor = input<string | null>(null);
  readonly monthlySummary = input<AccountMonthlySummary | null>(null);
  readonly changed = output<void>();
  readonly hovered = output<boolean>();
  readonly transferRequested = output<Account>();
  readonly adjustBalanceRequested = output<Account>();
  readonly shareRequested = output<Account>();
  readonly savingsGoalRequested = output<Account>();
  readonly editInline = viewChild(EditAccountInlineComponent);

  readonly isDeleting = signal(false);
  readonly errorMessage = signal('');

  isOwner(): boolean {
    return this.account().ownerId === this.authService.getUserId();
  }

  isAdmin(): boolean {
    return this.authService.getRole() === 'ADMIN';
  }

  canTransfer(): boolean {
    return canTransactFromAccount(this.account(), this.authService.getUserId(), this.authService.getRole());
  }

  canEditAccount(): boolean {
    return this.isOwner() || this.isAdmin();
  }

  canShareAccount(): boolean {
    return canShareAccountForUser(this.account(), this.authService.getUserId(), this.authService.getRole());
  }

  canDeleteAccount(): boolean {
    return this.isOwner() || this.isAdmin();
  }

  canEditSavingsGoal(): boolean {
    return canManageSavingsGoal(this.account(), this.authService.getUserId(), this.authService.getRole());
  }

  getTypeTranslationKey(type: Account['type']): 'accounts.typeMain' | 'accounts.typeSavings' | 'accounts.typeSubAccount' | 'accounts.typeCash' {
    switch (type) {
      case 'MAIN':
        return 'accounts.typeMain';
      case 'SAVINGS':
        return 'accounts.typeSavings';
      case 'SUB_ACCOUNT':
        return 'accounts.typeSubAccount';
      case 'CASH':
        return 'accounts.typeCash';
    }
  }

  isSharedAccount(): boolean {
    return (this.account().sharedUsers?.length ?? 0) > 0;
  }

  isSavingsAccount(): boolean {
    return this.account().type === 'SAVINGS' || this.account().type === 'CASH';
  }

  hasSavingsGoal(): boolean {
    const account = this.account();
    return this.isSavingsAccount() && account.targetAmount !== null && account.targetAmount !== undefined;
  }

  getSavingsProgress(): number {
    const target = this.account().targetAmount ?? 0;
    if (target <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(100, (this.account().balance / target) * 100));
  }

  openSavingsGoal(): void {
    if (!this.isSavingsAccount() || !this.canEditSavingsGoal()) {
      return;
    }

    this.savingsGoalRequested.emit(this.account());
  }

  onTransfer(): void {
    if (!this.canTransfer()) {
      return;
    }

    this.errorMessage.set('');
    this.transferRequested.emit(this.account());
  }

  onAdjustBalance(): void {
    if (!this.canEditAccount()) {
      return;
    }

    this.errorMessage.set('');
    this.adjustBalanceRequested.emit(this.account());
  }

  onShare(): void {
    if (!this.canShareAccount()) {
      return;
    }

    this.errorMessage.set('');
    this.shareRequested.emit(this.account());
  }

  startInlineEdit(): void {
    if (!this.canEditAccount()) {
      return;
    }

    this.editInline()?.startEditing();
  }

  onUpdated(): void {
    this.errorMessage.set('');
    this.changed.emit();
  }

  deleteAccount(): void {
    if (this.isDeleting() || !this.canDeleteAccount()) {
      return;
    }

    this.errorMessage.set('');
    this.isDeleting.set(true);

    this.accountService.deleteAccount(this.account().id)
      .pipe(finalize(() => this.isDeleting.set(false)))
      .subscribe({
        next: () => this.changed.emit(),
        error: (error: { error?: { message?: string } }) => {
          this.errorMessage.set(error.error?.message || this.i18n.translate('accounts.deleteFailed'));
        }
      });
  }

  formatBalance(balance: number): string {
    return formatMoney(balance);
  }

  formatTargetDate(value: string | null | undefined): string {
    if (!value) {
      return 'Puudub';
    }

    const parsed = new Date(`${value}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat(this.i18n.language(), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(parsed);
  }

  hasAccentColor(): boolean {
    return !!this.accentColor();
  }

  onMouseEnter(): void {
    this.hovered.emit(true);
  }

  onMouseLeave(): void {
    this.hovered.emit(false);
  }

  onCardClick(): void {
    this.openSavingsGoal();
  }

  onCardKeydown(event: KeyboardEvent): void {
    if (!this.isSavingsAccount()) {
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.openSavingsGoal();
    }
  }

}
