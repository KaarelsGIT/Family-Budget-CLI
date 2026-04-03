import { Account } from '../models/account.model';

export function canTransactFromAccount(
  account: Pick<Account, 'ownerId' | 'sharedUsers'>,
  currentUserId: number | null,
  currentUserRole: string | null
): boolean {
  if (currentUserRole === 'ADMIN') {
    return true;
  }

  if (currentUserId !== null && account.ownerId === currentUserId) {
    return true;
  }

  if (currentUserId !== null && account.sharedUsers?.some((sharedUser) => sharedUser.userId === currentUserId)) {
    return true;
  }

  return false;
}

export function canShareAccount(
  account: Pick<Account, 'ownerId'>,
  currentUserId: number | null,
  currentUserRole: string | null
): boolean {
  return currentUserRole === 'ADMIN' || (currentUserId !== null && account.ownerId === currentUserId);
}
