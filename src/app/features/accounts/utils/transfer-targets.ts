import { Account } from '../models/account.model';
import { SelectableUser } from '../services/account.service';

const accountTypeOrder: Record<Account['type'], number> = {
  MAIN: 0,
  SUB_ACCOUNT: 1,
  SAVINGS: 2,
  CASH: 3
};

export interface TransferTargetUser extends SelectableUser {
  isCurrentUser: boolean;
  accounts: Account[];
}

export function countSharedAccessibleAccounts(accounts: Account[], currentUserId: number | null): number {
  if (currentUserId === null) {
    return 0;
  }

  return accounts.filter((account) =>
    account.ownerId !== currentUserId &&
    account.sharedUsers?.some((sharedUser) => sharedUser.userId === currentUserId)
  ).length;
}

export function shouldShowMyAccountsSection(
  user: TransferTargetUser,
  accounts: Account[],
  currentUserId: number | null
): boolean {
  return user.isCurrentUser && (user.accounts.length > 1 || countSharedAccessibleAccounts(accounts, currentUserId) > 0);
}

export function buildTransferTargetUsers(
  users: SelectableUser[],
  accounts: Account[],
  currentUserId: number | null
): TransferTargetUser[] {
  const currentUserAccounts = currentUserId === null
    ? []
    : [...accounts]
        .filter((account) =>
          account.ownerId === currentUserId ||
          account.sharedUsers?.some((sharedUser) => sharedUser.userId === currentUserId)
        )
        .sort((left, right) => {
          if (left.type !== right.type) {
            return accountTypeOrder[left.type] - accountTypeOrder[right.type];
          }

          return left.name.localeCompare(right.name);
        });

  return [...users]
    .map((user) => ({
      ...user,
      isCurrentUser: currentUserId !== null && user.id === currentUserId,
      accounts: currentUserId !== null && user.id === currentUserId ? currentUserAccounts : []
    }))
    .sort((left, right) => {
      if (left.isCurrentUser && !right.isCurrentUser) {
        return -1;
      }
      if (!left.isCurrentUser && right.isCurrentUser) {
        return 1;
      }

      return left.username.localeCompare(right.username);
    });
}
