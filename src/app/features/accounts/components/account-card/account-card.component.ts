import { CommonModule } from '@angular/common';
import { Component, inject, input, output, signal, viewChild } from '@angular/core';
import { finalize } from 'rxjs';
import { AuthService } from '../../../../auth/auth.service';
import { TranslationService } from '../../../../i18n/translation.service';
import { Account } from '../../models/account.model';
import { AccountService } from '../../services/account.service';
import { EditAccountInlineComponent } from '../edit-account-inline/edit-account-inline.component';

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
  readonly changed = output<void>();
  readonly transferRequested = output<Account>();
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
    return this.isOwner();
  }

  canEditAccount(): boolean {
    return this.isOwner() || this.isAdmin();
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
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(balance);
  }

  getTypeLabel(type: Account['type']): string {
    switch (type) {
      case 'MAIN':
        return this.i18n.translate('accounts.typeMain');
      case 'GOAL':
        return this.i18n.translate('accounts.typeGoal');
      default:
        return this.i18n.translate('accounts.typeSavings');
    }
  }
}
