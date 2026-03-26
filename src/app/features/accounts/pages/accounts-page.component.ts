import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../../auth/auth.service';
import { TranslationService } from '../../../i18n/translation.service';
import { AccountCardComponent } from '../components/account-card.component';
import { AddAccountModalComponent } from '../components/add-account-modal.component';
import { Account } from '../models/account.model';
import { AccountService } from '../services/account.service';

interface AccountOwnerGroup {
  ownerId: number;
  ownerUsername: string;
  ownerRole: Account['ownerRole'];
  accounts: Account[];
}

interface AccountSection {
  key: 'currentUser' | 'parents' | 'children';
  titleKey: 'accounts.sectionCurrentUser' | 'accounts.sectionParents' | 'accounts.sectionChildren';
  groups: AccountOwnerGroup[];
}

@Component({
  selector: 'app-accounts-page',
  standalone: true,
  imports: [CommonModule, AccountCardComponent, AddAccountModalComponent],
  templateUrl: './accounts-page.component.html',
  styleUrl: './accounts-page.component.css'
})
export class AccountsPageComponent {
  private readonly accountService = inject(AccountService);
  private readonly authService = inject(AuthService);
  readonly i18n = inject(TranslationService);

  readonly accounts = signal<Account[]>([]);
  readonly isLoading = signal(false);
  readonly isModalOpen = signal(false);
  readonly errorMessage = signal('');

  readonly totalBalance = computed(() =>
    this.accounts().reduce((sum, account) => sum + account.balance, 0)
  );

  readonly sections = computed<AccountSection[]>(() => {
    const currentUserId = this.authService.getUserId();
    const currentUserRole = this.authService.getRole();
    const accounts = this.accounts();

    const currentUserAccounts = accounts.filter((account) => account.ownerId === currentUserId);
    const parentAccounts = accounts.filter((account) =>
      account.ownerId !== currentUserId && (account.ownerRole === 'PARENT' || account.ownerRole === 'ADMIN')
    );
    const childAccounts = accounts.filter((account) =>
      account.ownerId !== currentUserId && account.ownerRole === 'CHILD'
    );

    const sections: AccountSection[] = [
      {
        key: 'currentUser',
        titleKey: 'accounts.sectionCurrentUser',
        groups: this.groupByOwner(currentUserAccounts)
      },
      {
        key: 'parents',
        titleKey: 'accounts.sectionParents',
        groups: this.groupByOwner(parentAccounts)
      },
      {
        key: 'children',
        titleKey: 'accounts.sectionChildren',
        groups: this.groupByOwner(childAccounts)
      }
    ];

    if (currentUserRole === 'CHILD') {
      return sections.filter((section) => section.key === 'currentUser' || section.groups.length > 0);
    }

    return sections.filter((section) => section.groups.length > 0);
  });

  constructor() {
    this.loadAccounts();
  }

  loadAccounts(): void {
    this.isLoading.set(true);
    this.errorMessage.set('');

    this.accountService.getAccounts().subscribe({
      next: (accounts) => {
        this.accounts.set(accounts);
        this.isLoading.set(false);
      },
      error: (error: { error?: { message?: string } }) => {
        this.errorMessage.set(error.error?.message || this.i18n.translate('accounts.loadFailed'));
        this.isLoading.set(false);
      }
    });
  }

  openAddAccountModal(): void {
    this.isModalOpen.set(true);
  }

  closeAddAccountModal(): void {
    this.isModalOpen.set(false);
  }

  handleAccountsChanged(): void {
    this.loadAccounts();
  }

  trackByAccountId(_index: number, account: Account): number {
    return account.id;
  }

  formatBalance(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  }

  trackBySectionKey(_index: number, section: AccountSection): string {
    return section.key;
  }

  trackByOwnerId(_index: number, group: AccountOwnerGroup): number {
    return group.ownerId;
  }

  private groupByOwner(accounts: Account[]): AccountOwnerGroup[] {
    const groups = new Map<number, AccountOwnerGroup>();

    for (const account of this.sortAccounts(accounts)) {
      const existingGroup = groups.get(account.ownerId);
      if (existingGroup) {
        existingGroup.accounts.push(account);
        continue;
      }

      groups.set(account.ownerId, {
        ownerId: account.ownerId,
        ownerUsername: account.ownerUsername,
        ownerRole: account.ownerRole,
        accounts: [account]
      });
    }

    return [...groups.values()].sort((left, right) => {
      if (left.ownerRole !== right.ownerRole) {
        if (left.ownerRole === 'PARENT') {
          return -1;
        }
        if (right.ownerRole === 'PARENT') {
          return 1;
        }
        if (left.ownerRole === 'ADMIN') {
          return 1;
        }
        if (right.ownerRole === 'ADMIN') {
          return -1;
        }
      }

      return left.ownerUsername.localeCompare(right.ownerUsername);
    });
  }

  private sortAccounts(accounts: Account[]): Account[] {
    return [...accounts].sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === 'MAIN' ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });
  }
}
