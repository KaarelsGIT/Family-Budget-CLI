import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../../../core/auth/auth.service';
import { TranslationService } from '../../../../core/services/i18n/translation.service';
import { AccountCardComponent } from '../../components/account-card/account-card.component';
import { AddAccountModalComponent } from '../../modals/add-account-modal/add-account-modal.component';
import { AdjustBalanceModalComponent } from '../../modals/adjust-balance-modal/adjust-balance-modal.component';
import { ShareAccountModalComponent } from '../../modals/share-account-modal/share-account-modal.component';
import { AddTransactionModalComponent } from '../../../transactions/modals/add-transaction-modal/add-transaction-modal.component';
import { Account } from '../../models/account.model';
import { AccountService } from '../../services/account.service';
import { TransactionsService } from '../../../transactions/services/transactions.service';
import { TransactionCategory } from '../../../transactions/models/transaction.model';
import { TransactionDraftService } from '../../../transactions/services/transaction-draft.service';
import { formatMoney } from '../../../shared/utils/money-format';

interface AccountOwnerGroup {
  ownerId: number;
  ownerUsername: string;
  ownerRole: Account['ownerRole'] | null;
  accounts: Account[];
  hoveredAccountId: number | null;
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

interface FamilyDashboardUser {
  userId: number;
  username: string;
  total: number;
  color: string;
  initials: string;
  share: number;
}

@Component({
  selector: 'app-accounts-page',
  standalone: true,
  imports: [CommonModule, AccountCardComponent, AddAccountModalComponent, AdjustBalanceModalComponent, ShareAccountModalComponent, AddTransactionModalComponent],
  templateUrl: './accounts-page.component.html',
  styleUrl: './accounts-page.component.css'
})
export class AccountsPageComponent {
  private readonly accountService = inject(AccountService);
  private readonly transactionsService = inject(TransactionsService);
  private readonly transactionDraftService = inject(TransactionDraftService);
  private readonly authService = inject(AuthService);
  readonly i18n = inject(TranslationService);

  readonly accounts = signal<Account[]>([]);
  readonly categories = signal<TransactionCategory[]>([]);
  readonly isLoading = signal(false);
  readonly isModalOpen = signal(false);
  readonly isTransactionModalOpen = signal(false);
  readonly selectedAdjustBalanceAccount = signal<Account | null>(null);
  readonly selectedShareAccount = signal<Account | null>(null);
  readonly errorMessage = signal('');
  readonly selectedFamilyUserIds = signal<number[]>([]);
  readonly hoveredFamilyUserId = signal<number | null>(null);
  readonly hoveredAccountId = signal<number | null>(null);
  readonly isPrivilegedUser = computed(() => this.authService.getRole() === 'PARENT' || this.authService.getRole() === 'ADMIN');
  readonly familyDashboardUsers = computed<FamilyDashboardUser[]>(() => {
    if (!this.isPrivilegedUser()) {
      return [];
    }

    const currentUserId = this.authService.getUserId() ?? -1;
    const currentUserUsername = this.authService.getUsername() ?? '';
    const groups = this.groupByVisibleUser(this.accounts(), currentUserId, currentUserUsername);
    const rawUsers = [...groups.values()]
      .map((group, index) => ({
        userId: group.ownerId,
        username: group.ownerUsername,
        total: this.getGroupTotal(group.accounts),
        color: this.getChartColor(index),
        initials: this.getInitials(group.ownerUsername),
        share: 0
      }))
      .sort((a, b) => a.username.localeCompare(b.username));
    const rawTotal = rawUsers.reduce((sum, user) => sum + user.total, 0);

    return rawUsers.map((user) => ({
      ...user,
      share: rawTotal > 0 ? (user.total / rawTotal) * 100 : 0
    }));
  });
  readonly familyDashboardSelectedUsers = computed(() => {
    const selected = new Set(this.selectedFamilyUserIds());
    return this.familyDashboardUsers().filter((user) => selected.has(user.userId));
  });
  readonly familyDashboardTotal = computed(() => this.familyDashboardSelectedUsers().reduce((sum, user) => sum + user.total, 0));
  readonly familyDashboardSlices = computed(() => this.buildFamilyDashboardSlices());
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
    this.loadCategories();
    this.loadFamilySelection();
  }

  loadAccounts(): void {
    this.isLoading.set(true);
    this.errorMessage.set('');

    this.accountService.getAccounts().subscribe({
      next: (accounts) => {
        this.accounts.set(accounts);
        this.ensureFamilySelection(accounts);
        const selectedAdjustBalanceAccount = this.selectedAdjustBalanceAccount();
        if (selectedAdjustBalanceAccount) {
          const refreshedAccount = accounts.find((account) => account.id === selectedAdjustBalanceAccount.id);
          if (refreshedAccount) {
            this.selectedAdjustBalanceAccount.set(refreshedAccount);
          }
        }
        this.isLoading.set(false);
      },
      error: (error: { error?: { message?: string } }) => {
        this.errorMessage.set(error.error?.message || this.i18n.translate('accounts.loadFailed'));
        this.isLoading.set(false);
      }
    });
  }

  loadCategories(): void {
    this.transactionsService.getCategories().subscribe({
      next: (categories) => {
        this.categories.set(categories);
      },
      error: () => {
        this.categories.set([]);
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
    this.isTransactionModalOpen.set(true);
  }

  closeTransactionModal(): void {
    this.isTransactionModalOpen.set(false);
    this.transactionDraftService.reset();
    this.transactionDraftService.clearOpenRequest();
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

  handleCategoryCreated(category: TransactionCategory): void {
    this.categories.update((categories) => {
      if (categories.some(({ id }) => id === category.id)) {
        return [...categories];
      }
      return [...categories, category];
    });
  }

  trackByAccountId(_index: number, account: Account): number {
    return account.id;
  }

  formatBalance(value: number): string {
    return formatMoney(value);
  }

  toggleFamilyUser(userId: number, checked: boolean): void {
    const next = checked
      ? Array.from(new Set([...this.selectedFamilyUserIds(), userId]))
      : this.selectedFamilyUserIds().filter((id) => id !== userId);
    this.selectedFamilyUserIds.set(next);
    this.accountService.updateFamilyDashboardSelection(next).subscribe({
      next: (selection) => this.selectedFamilyUserIds.set(selection),
      error: () => {
        // Keep the local toggle responsive even if persistence fails.
      }
    });
  }

  setHoveredFamilyUser(userId: number | null): void {
    this.hoveredFamilyUserId.set(userId);
  }

  getGroupTotal(accounts: Account[]): number {
    return accounts.reduce((sum, account) => sum + account.balance, 0);
  }

  getChartColor(index: number): string {
    const colors = ['#1f6f4a', '#2d8a64', '#4aa36f', '#77b255', '#d07c3e', '#b13f5f', '#4969c4', '#8a52c8'];
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

  trackByFamilyUserId(_index: number, user: FamilyDashboardUser): number {
    return user.userId;
  }

  trackByOwnerId(_index: number, group: AccountOwnerGroup): number {
    return group.ownerId;
  }

  setHoveredAccount(accountId: number | null): void {
    this.hoveredAccountId.set(accountId);
  }

  private groupByVisibleUser(accounts: Account[], currentUserId: number, currentUserUsername: string): Map<number, AccountOwnerGroup> {
    const groups = new Map<number, AccountOwnerGroup>();

    for (const account of this.sortAccounts(accounts)) {
      this.addAccountToGroup(groups, account.ownerId, account.ownerUsername, account.ownerRole, account);

      for (const sharedUser of account.sharedUsers ?? []) {
        if (sharedUser.userId !== currentUserId) {
          continue;
        }

        this.addAccountToGroup(groups, sharedUser.userId, sharedUser.username, null, account);
      }
    }

    if (!groups.has(currentUserId)) {
      groups.set(currentUserId, {
        ownerId: currentUserId,
        ownerUsername: currentUserUsername,
        ownerRole: null,
        accounts: [],
        hoveredAccountId: null
      });
    }

    return groups;
  }

  private loadFamilySelection(): void {
    this.accountService.getFamilyDashboardSelection().subscribe({
      next: (selection) => {
        if (selection.length > 0) {
          this.selectedFamilyUserIds.set(selection);
        }
      },
      error: () => {
        // Fallback is handled after accounts are loaded.
      }
    });
  }

  private ensureFamilySelection(accounts: Account[]): void {
    if (!this.isPrivilegedUser()) {
      return;
    }

    if (this.selectedFamilyUserIds().length > 0) {
      return;
    }

    const currentUserId = this.authService.getUserId() ?? -1;
    const currentUserUsername = this.authService.getUsername() ?? '';
    const fallback = [...this.groupByVisibleUser(accounts, currentUserId, currentUserUsername).keys()];
    if (fallback.length === 0) {
      return;
    }

    this.selectedFamilyUserIds.set(fallback);
    this.accountService.updateFamilyDashboardSelection(fallback).subscribe({
      next: (saved) => this.selectedFamilyUserIds.set(saved),
      error: () => {
        // Keep the local fallback if persistence fails.
      }
    });
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
      accounts: [account],
      hoveredAccountId: null
    });
  }

  private sortAccounts(accounts: Account[]): Account[] {
    const typeOrder: Record<Account['type'], number> = {
      MAIN: 0,
      SUB_ACCOUNT: 1,
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
    const hoveredAccountId = this.hoveredAccountId();

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
        color: hoveredAccountId === null || hoveredAccountId === account.id
          ? this.getChartColor(index)
          : 'rgba(183, 228, 199, 0.24)',
        path: this.describePieSlice(50, 50, 42, startAngle, endAngle)
      }];
    });
  }

  buildFamilyDashboardSlices(): AccountChartSlice[] {
    const selected = this.familyDashboardSelectedUsers();
    const total = selected.reduce((sum, user) => sum + user.total, 0);
    const hoveredUserId = this.hoveredFamilyUserId();

    if (total <= 0) {
      return [];
    }

    let currentAngle = -90;
    return selected.flatMap((user) => {
      if (user.total <= 0) {
        return [];
      }

      const sweep = (user.total / total) * 360;
      const startAngle = currentAngle;
      const endAngle = currentAngle + sweep;
      currentAngle = endAngle;

      return [{
        accountId: user.userId,
        color: hoveredUserId === null || hoveredUserId === user.userId ? user.color : 'rgba(183, 228, 199, 0.26)',
        path: this.describePieSlice(50, 50, 42, startAngle, endAngle)
      }];
    });
  }

  getFamilyUserProgress(user: FamilyDashboardUser): number {
    return Math.max(0, Math.min(100, user.share));
  }

  private getInitials(username: string): string {
    const parts = username.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      return '?';
    }

    return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
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
