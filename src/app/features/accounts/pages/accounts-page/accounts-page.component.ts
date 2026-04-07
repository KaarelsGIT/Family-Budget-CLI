import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../../auth/auth.service';
import { TranslationService } from '../../../../i18n/translation.service';
import { AccountCardComponent } from '../../components/account-card/account-card.component';
import { AddAccountModalComponent } from '../../components/add-account-modal/add-account-modal.component';
import { AdjustBalanceModalComponent } from '../../components/adjust-balance-modal/adjust-balance-modal.component';
import { ShareAccountModalComponent } from '../../components/share-account-modal/share-account-modal.component';
import { Account } from '../../models/account.model';
import { AccountService } from '../../services/account.service';
import { TransactionDraftService } from '../../../transactions/services/transaction-draft.service';
import { formatEuroAmount } from '../../../../shared/utils/money-format';

interface AccountOwnerGroup {
  ownerId: number;
  ownerUsername: string;
  ownerRole: Account['ownerRole'] | null;
  accounts: Account[];
}

interface AccountChartSlice {
  accountId: number;
  color: string;
  path: string;
}

interface AccountSection {
  key: 'currentUser' | 'otherFamilyMembers';
  titleKey: 'accounts.sectionCurrentUser' | 'accounts.sectionOtherFamilyMembers';
  groups: AccountOwnerGroup[];
}

@Component({
  selector: 'app-accounts-page',
  standalone: true,
  imports: [CommonModule, AccountCardComponent, AddAccountModalComponent, AdjustBalanceModalComponent, ShareAccountModalComponent],
  templateUrl: './accounts-page.component.html',
  styleUrl: './accounts-page.component.css'
})
export class AccountsPageComponent {
  private readonly accountService = inject(AccountService);
  private readonly transactionDraftService = inject(TransactionDraftService);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  readonly i18n = inject(TranslationService);

  readonly accounts = signal<Account[]>([]);
  readonly isLoading = signal(false);
  readonly isModalOpen = signal(false);
  readonly selectedAdjustBalanceAccount = signal<Account | null>(null);
  readonly selectedShareAccount = signal<Account | null>(null);
  readonly errorMessage = signal('');
  readonly sections = computed<AccountSection[]>(() => {
    const currentUserId = this.authService.getUserId();
    const currentUserUsername = this.authService.getUsername();
    const accounts = this.accounts();

    if (currentUserId === null || !currentUserUsername) {
      return [];
    }

    const groups = this.groupByVisibleUser(accounts, currentUserId, currentUserUsername);
    const currentUserGroup = groups.get(currentUserId);
    const otherFamilyMemberGroups = [...groups.values()]
      .filter((group) => group.ownerId !== currentUserId)
      .sort((left, right) => left.ownerUsername.localeCompare(right.ownerUsername));

    const sections: AccountSection[] = [
      {
        key: 'currentUser',
        titleKey: 'accounts.sectionCurrentUser',
        groups: currentUserGroup ? [currentUserGroup] : []
      },
      {
        key: 'otherFamilyMembers',
        titleKey: 'accounts.sectionOtherFamilyMembers',
        groups: otherFamilyMemberGroups
      }
    ];

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
    this.selectedAdjustBalanceAccount.set(null);
    this.selectedShareAccount.set(null);
    this.isModalOpen.set(true);
  }

  closeAddAccountModal(): void {
    this.isModalOpen.set(false);
  }

  openTransactionModal(request: { type: 'INCOME' | 'EXPENSE' | 'TRANSFER'; preselectedFromAccount?: number | null }): void {
    this.transactionDraftService.openTransactionModal(request);
    this.router.navigateByUrl('/transactions');
  }

  openAdjustBalanceModal(account: Account): void {
    this.isModalOpen.set(false);
    this.selectedShareAccount.set(null);
    this.selectedAdjustBalanceAccount.set(account);
  }

  closeAdjustBalanceModal(): void {
    this.selectedAdjustBalanceAccount.set(null);
  }

  openShareModal(account: Account): void {
    this.isModalOpen.set(false);
    this.selectedAdjustBalanceAccount.set(null);
    this.selectedShareAccount.set(account);
  }

  closeShareModal(): void {
    this.selectedShareAccount.set(null);
  }

  handleAccountsChanged(): void {
    this.loadAccounts();
  }

  trackByAccountId(_index: number, account: Account): number {
    return account.id;
  }

  formatBalance(value: number): string {
    return formatEuroAmount(value, this.i18n.language());
  }

  getGroupTotal(accounts: Account[]): number {
    return accounts.reduce((sum, account) => sum + account.balance, 0);
  }

  getChartColor(index: number): string {
    const colors = ['#2f7d46', '#3f9155', '#52a363', '#68b372', '#7cc07f', '#99cd93'];
    return colors[index % colors.length];
  }

  getAccountColor(accounts: Account[], account: Account): string | null {
    const index = accounts.findIndex((item) => item.id === account.id);
    return index >= 0 ? this.getChartColor(index) : null;
  }

  trackByChartSliceId(_index: number, slice: AccountChartSlice): number {
    return slice.accountId;
  }

  trackBySectionKey(_index: number, section: AccountSection): string {
    return section.key;
  }

  trackByOwnerId(_index: number, group: AccountOwnerGroup): number {
    return group.ownerId;
  }

  private groupByVisibleUser(accounts: Account[], currentUserId: number, currentUserUsername: string): Map<number, AccountOwnerGroup> {
    const groups = new Map<number, AccountOwnerGroup>();

    for (const account of this.sortAccounts(accounts)) {
      this.addAccountToGroup(groups, account.ownerId, account.ownerUsername, account.ownerRole, account);

      for (const sharedUser of account.sharedUsers ?? []) {
        this.addAccountToGroup(groups, sharedUser.userId, sharedUser.username, null, account);
      }
    }

    if (!groups.has(currentUserId)) {
      groups.set(currentUserId, {
        ownerId: currentUserId,
        ownerUsername: currentUserUsername,
        ownerRole: null,
        accounts: []
      });
    }

    return groups;
  }

  private addAccountToGroup(
    groups: Map<number, AccountOwnerGroup>,
    userId: number,
    username: string,
    role: Account['ownerRole'] | null,
    account: Account
  ): void {
    const existingGroup = groups.get(userId);
    if (existingGroup) {
      if (!existingGroup.accounts.some((item) => item.id === account.id)) {
        existingGroup.accounts.push(account);
      }
      if (!existingGroup.ownerRole && role) {
        existingGroup.ownerRole = role;
      }
      return;
    }

    groups.set(userId, {
      ownerId: userId,
      ownerUsername: username,
      ownerRole: role,
      accounts: [account]
    });
  }

  private sortAccounts(accounts: Account[]): Account[] {
    const typeOrder: Record<Account['type'], number> = {
      MAIN: 0,
      GOAL: 1,
      SAVINGS: 2,
      CASH: 3
    };

    return [...accounts].sort((left, right) => {
      if (left.type !== right.type) {
        return typeOrder[left.type] - typeOrder[right.type];
      }

      return left.name.localeCompare(right.name);
    });
  }

  buildAccountChartSlices(accounts: Account[]): AccountChartSlice[] {
    const positiveBalances = accounts.map((account) => Math.max(0, account.balance));
    const total = positiveBalances.reduce((sum, value) => sum + value, 0);

    if (total <= 0) {
      return [];
    }

    if (accounts.filter((account) => Math.max(0, account.balance) > 0).length === 1) {
      const singleAccount = accounts.find((account) => Math.max(0, account.balance) > 0);
      if (!singleAccount) {
        return [];
      }

      return [{
        accountId: singleAccount.id,
        color: this.getChartColor(accounts.findIndex((account) => account.id === singleAccount.id)),
        path: this.describeFullCircle(50, 50, 42)
      }];
    }

    let currentAngle = -90;

    return accounts.flatMap((account, index) => {
      const value = Math.max(0, account.balance);
      if (value <= 0) {
        return [];
      }

      const sweep = (value / total) * 360;
      const startAngle = currentAngle;
      const endAngle = currentAngle + sweep;
      currentAngle = endAngle;

      return [{
        accountId: account.id,
        color: this.getChartColor(index),
        path: this.describePieSlice(50, 50, 42, startAngle, endAngle)
      }];
    });
  }

  private describePieSlice(cx: number, cy: number, radius: number, startAngle: number, endAngle: number): string {
    const start = this.polarToCartesian(cx, cy, radius, endAngle);
    const end = this.polarToCartesian(cx, cy, radius, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';

    return [
      `M ${cx} ${cy}`,
      `L ${start.x} ${start.y}`,
      `A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
      'Z'
    ].join(' ');
  }

  private describeFullCircle(cx: number, cy: number, radius: number): string {
    return [
      `M ${cx} ${cy - radius}`,
      `A ${radius} ${radius} 0 1 1 ${cx} ${cy + radius}`,
      `A ${radius} ${radius} 0 1 1 ${cx} ${cy - radius}`,
      'Z'
    ].join(' ');
  }

  private polarToCartesian(cx: number, cy: number, radius: number, angleInDegrees: number): { x: number; y: number } {
    const angleInRadians = (angleInDegrees - 90) * (Math.PI / 180);
    return {
      x: cx + radius * Math.cos(angleInRadians),
      y: cy + radius * Math.sin(angleInRadians)
    };
  }
}
