import { CommonModule } from '@angular/common';
import { Component, inject, input, output, signal, viewChild } from '@angular/core';
import { finalize } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { TranslationService } from '../../../../core/services/i18n/translation.service';
import { Account } from '../../models/account.model';
import { AccountService } from '../../services/account.service';
import { EditAccountInlineComponent } from '../edit-account-inline/edit-account-inline.component';
import { formatMoney } from '../../../shared/utils/money-format';
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
  readonly hovered = output<boolean>();
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

  hasAccentColor(): boolean {
    return !!this.accentColor();
  }

  onMouseEnter(): void {
    this.hovered.emit(true);
  }

  onMouseLeave(): void {
    this.hovered.emit(false);
  }

}
