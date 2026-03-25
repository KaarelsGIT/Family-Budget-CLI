import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { TranslationService } from '../i18n/translation.service';

type UserRole = 'ADMIN' | 'PARENT' | 'CHILD';
type AccountType = 'MAIN' | 'SAVINGS';

interface AccountSummary {
  id: number;
  name: string;
  ownerId: number;
  ownerUsername: string;
  type: AccountType;
  isDefault: boolean;
  deletionRequested: boolean;
  balance: number | string | null;
}

interface ApiResponse<T> {
  data: T;
}

interface ListResponse<T> {
  data: T;
  total: number;
}

@Component({
  selector: 'app-accounts',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './accounts.html',
  styleUrl: './accounts.css'
})
export class AccountsComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly formBuilder = inject(FormBuilder);
  readonly authService = inject(AuthService);
  readonly i18n = inject(TranslationService);

  activeSection: 'family' | 'mine' = 'mine';
  feedbackMessage = '';
  errorMessage = '';
  createFeedbackMessage = '';
  createErrorMessage = '';
  isLoading = false;
  isCreating = false;
  deletingAccountIds = new Set<number>();
  accounts: AccountSummary[] = [];

  readonly createSavingsAccountForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]]
  });

  readonly currentUserId = computed(() => this.authService.getUserId());
  readonly currentUserRole = computed(() => this.authService.getRole() as UserRole | null);

  ngOnInit(): void {
    if (!this.showSidebar()) {
      this.activeSection = 'mine';
    }
    this.loadAccounts();
  }

  selectSection(section: 'family' | 'mine'): void {
    if (section === 'family' && !this.showSidebar()) {
      return;
    }

    this.activeSection = section;
    this.feedbackMessage = '';
    this.errorMessage = '';
    this.createFeedbackMessage = '';
    this.createErrorMessage = '';
  }

  loadAccounts(): void {
    if (this.isLoading) {
      return;
    }

    this.feedbackMessage = '';
    this.errorMessage = '';
    this.isLoading = true;

    this.http.get<ListResponse<AccountSummary[]>>('/api/accounts')
      .pipe(finalize(() => {
        this.isLoading = false;
      }))
      .subscribe({
        next: (response) => {
          this.accounts = response.data;
        },
        error: (error: HttpErrorResponse) => {
          this.errorMessage = error.error?.message || this.i18n.translate('accounts.loadFailed');
        }
      });
  }

  createSavingsAccount(): void {
    if (this.createSavingsAccountForm.invalid || this.isCreating) {
      this.createSavingsAccountForm.markAllAsTouched();
      return;
    }

    this.createFeedbackMessage = '';
    this.createErrorMessage = '';
    this.isCreating = true;

    this.http.post<ApiResponse<AccountSummary>>('/api/accounts', this.createSavingsAccountForm.getRawValue())
      .pipe(finalize(() => {
        this.isCreating = false;
      }))
      .subscribe({
        next: () => {
          this.createSavingsAccountForm.reset({ name: '' });
          this.createFeedbackMessage = this.i18n.translate('accounts.createSuccess');
          this.loadAccounts();
          this.activeSection = 'mine';
        },
        error: (error: HttpErrorResponse) => {
          this.createErrorMessage = error.error?.message || this.i18n.translate('accounts.createFailed');
        }
      });
  }

  deleteAccount(account: AccountSummary): void {
    if (!this.canManageAccount(account) || this.deletingAccountIds.has(account.id)) {
      return;
    }

    this.feedbackMessage = '';
    this.errorMessage = '';
    this.deletingAccountIds.add(account.id);

    this.http.delete<ApiResponse<string>>(`/api/accounts/${account.id}`)
      .pipe(finalize(() => {
        const nextIds = new Set(this.deletingAccountIds);
        nextIds.delete(account.id);
        this.deletingAccountIds = nextIds;
      }))
      .subscribe({
        next: () => {
          const actionText = this.isAdmin()
            ? this.i18n.translate('accounts.deleteSuccess')
            : this.i18n.translate('accounts.requestSuccess');
          this.feedbackMessage = actionText;
          this.loadAccounts();
        },
        error: (error: HttpErrorResponse) => {
          this.errorMessage = error.error?.message || this.i18n.translate('accounts.deleteFailed');
        }
      });
  }

  showSidebar(): boolean {
    const role = this.currentUserRole();
    return role === 'ADMIN' || role === 'PARENT';
  }

  isAdmin(): boolean {
    return this.currentUserRole() === 'ADMIN';
  }

  isChild(): boolean {
    return this.currentUserRole() === 'CHILD';
  }

  getMyAccounts(): AccountSummary[] {
    const currentUserId = this.currentUserId();
    return this.sortedAccounts().filter((account) => account.ownerId === currentUserId);
  }

  getFamilyAccounts(): AccountSummary[] {
    const currentUserId = this.currentUserId();
    return this.sortedAccounts().filter((account) => account.ownerId !== currentUserId);
  }

  getVisibleAccounts(): AccountSummary[] {
    return this.activeSection === 'family' ? this.getFamilyAccounts() : this.getMyAccounts();
  }

  getSectionTitle(): string {
    if (this.activeSection === 'family') {
      return this.i18n.translate('accounts.sectionFamily');
    }
    return this.i18n.translate('accounts.sectionMine');
  }

  getSectionEyebrow(): string {
    if (this.activeSection === 'family') {
      return this.i18n.translate('accounts.eyebrowFamily');
    }
    return this.i18n.translate('accounts.eyebrowMine');
  }

  getSectionCopy(): string {
    if (this.activeSection === 'family') {
      return this.i18n.translate('accounts.copyFamily');
    }

    if (this.isChild()) {
      return this.i18n.translate('accounts.copyChild');
    }

    return this.i18n.translate('accounts.copyMine');
  }

  formatBalance(value: number | string | null): string {
    const numericValue = typeof value === 'number' ? value : Number(value ?? 0);
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number.isNaN(numericValue) ? 0 : numericValue);
  }

  getAccountTypeLabel(type: AccountType): string {
    return type === 'MAIN'
      ? this.i18n.translate('accounts.typeMain')
      : this.i18n.translate('accounts.typeSavings');
  }

  canManageAccount(account: AccountSummary): boolean {
    if (this.isAdmin()) {
      return true;
    }

    return account.ownerId === this.currentUserId();
  }

  isDeletingAccount(accountId: number): boolean {
    return this.deletingAccountIds.has(accountId);
  }

  trackByAccountId(_index: number, account: AccountSummary): number {
    return account.id;
  }

  private sortedAccounts(): AccountSummary[] {
    return [...this.accounts].sort((left, right) => {
      if (left.ownerUsername !== right.ownerUsername) {
        return left.ownerUsername.localeCompare(right.ownerUsername);
      }
      if (left.type !== right.type) {
        return left.type === 'MAIN' ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
  }
}
