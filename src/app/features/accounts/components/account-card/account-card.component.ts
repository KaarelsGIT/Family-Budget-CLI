import { CommonModule } from '@angular/common';
import { Component, inject, input, output, signal, viewChild } from '@angular/core';
import { finalize } from 'rxjs';
import { AuthService } from '../../../../auth/auth.service';
import { TranslationService } from '../../../../i18n/translation.service';
import { Account } from '../../models/account.model';
import { AccountService } from '../../services/account.service';
import { EditAccountInlineComponent } from '../edit-account-inline/edit-account-inline.component';
import { formatEuroAmount } from '../../../../shared/utils/money-format';
import { canShareAccount as canShareAccountForUser, canTransactFromAccount } from '../../utils/account-access';

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
  readonly changed = output<void>();
  readonly transferRequested = output<Account>();
  readonly adjustBalanceRequested = output<Account>();
  readonly shareRequested = output<Account>();
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
    return formatEuroAmount(balance, this.i18n.language());
  }

  hasAccentColor(): boolean {
    return !!this.accentColor();
  }

  getTypeLabel(type: Account['type']): string {
    switch (type) {
      case 'MAIN':
        return this.i18n.translate('accounts.typeMain');
      case 'GOAL':
        return this.i18n.translate('accounts.typeGoal');
      case 'CASH':
        return this.i18n.translate('accounts.typeCash');
      default:
        return this.i18n.translate('accounts.typeSavings');
    }
  }
}
