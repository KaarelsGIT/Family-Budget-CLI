import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { AuthService } from '../../../../auth/auth.service';
import { TranslationService } from '../../../../i18n/translation.service';
import { Account, AccountSharedUser } from '../../models/account.model';
import { AccountService, SelectableUser } from '../../services/account.service';

type ShareRole = 'EDITOR' | 'VIEWER';

@Component({
  selector: 'app-share-account-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './share-account-modal.component.html',
  styleUrl: './share-account-modal.component.css'
})
export class ShareAccountModalComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly accountService = inject(AccountService);
  private readonly authService = inject(AuthService);
  readonly i18n = inject(TranslationService);

  readonly account = input.required<Account>();
  readonly closed = output<void>();
  readonly shared = output<void>();

  readonly selectableUsers = signal<SelectableUser[]>([]);
  readonly currentShares = signal<AccountSharedUser[]>([]);
  readonly isLoadingUsers = signal(false);
  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');

  readonly roleOptions = computed(() => [
    { value: 'EDITOR' as ShareRole, label: this.i18n.translate('accounts.roleEditor') },
    { value: 'VIEWER' as ShareRole, label: this.i18n.translate('accounts.roleViewer') }
  ]);

  readonly form = this.formBuilder.nonNullable.group({
    userId: ['', Validators.required],
    role: ['EDITOR' as ShareRole, Validators.required]
  });

  constructor() {
    this.loadUsers();
    effect(() => {
      this.currentShares.set(this.account().sharedUsers ?? []);
    }, { allowSignalWrites: true });
  }

  close(): void {
    this.closed.emit();
  }

  submit(): void {
    if (this.form.invalid || this.isSubmitting()) {
      this.form.markAllAsTouched();
      return;
    }

    const userId = Number(this.form.controls.userId.value);
    const role = this.form.controls.role.value;
    if (!Number.isFinite(userId) || userId < 1) {
      this.errorMessage.set(this.i18n.translate('accounts.shareFailed'));
      return;
    }

    this.errorMessage.set('');
    this.isSubmitting.set(true);

    this.accountService.shareAccount(this.account().id, {
      userId,
      role
    }).pipe(
      finalize(() => this.isSubmitting.set(false))
    ).subscribe({
      next: (updatedAccount) => {
        this.currentShares.set(updatedAccount.sharedUsers ?? []);
        this.form.patchValue({
          userId: '',
          role: 'EDITOR'
        }, { emitEvent: false });
        this.shared.emit();
      },
      error: (error: { error?: { message?: string } }) => {
        this.errorMessage.set(error.error?.message || this.i18n.translate('accounts.shareFailed'));
      }
    });
  }

  revokeAccess(userId: number): void {
    if (this.isSubmitting()) {
      return;
    }

    this.errorMessage.set('');
    this.isSubmitting.set(true);

    this.accountService.revokeAccountShare(this.account().id, userId).pipe(
      finalize(() => this.isSubmitting.set(false))
    ).subscribe({
      next: (updatedAccount) => {
        this.currentShares.set(updatedAccount.sharedUsers ?? []);
        this.shared.emit();
      },
      error: (error: { error?: { message?: string } }) => {
        this.errorMessage.set(error.error?.message || this.i18n.translate('accounts.shareFailed'));
      }
    });
  }

  trackByUserId(_index: number, user: SelectableUser): number {
    return user.id;
  }

  trackBySharedUserId(_index: number, user: AccountSharedUser): number {
    return user.userId;
  }

  trackByRole(_index: number, role: { value: ShareRole }): ShareRole {
    return role.value;
  }

  private loadUsers(): void {
    this.isLoadingUsers.set(true);
    this.accountService.getSelectableUsers().subscribe({
      next: (users) => {
        const currentUserId = this.authService.getUserId();
        this.selectableUsers.set(users.filter((user) => user.id !== currentUserId));
        this.isLoadingUsers.set(false);
      },
      error: (error: { error?: { message?: string } }) => {
        this.errorMessage.set(error.error?.message || this.i18n.translate('accounts.loadFailed'));
        this.selectableUsers.set([]);
        this.isLoadingUsers.set(false);
      }
    });
  }
}
