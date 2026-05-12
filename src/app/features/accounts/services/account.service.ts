import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { Account, AccountSharedUser } from '../models/account.model';

interface ApiResponse<T> {
  data: T;
}

interface ListResponse<T> {
  data: T;
  total: number;
}

interface AccountApiResponse {
  id: number;
  name: string;
  ownerId: number;
  ownerUsername: string;
  ownerRole: 'ADMIN' | 'PARENT' | 'CHILD';
  balance: number | string | null;
  type: 'MAIN' | 'SAVINGS' | 'SUB_ACCOUNT' | 'CASH';
  accessRole?: 'OWNER' | 'EDITOR' | 'VIEWER' | null;
  sharedUsers?: AccountSharedUserApiResponse[];
}

interface AccountSharedUserApiResponse {
  userId: number;
  username: string;
  role: 'EDITOR' | 'VIEWER';
}

interface SelectableUserApiResponse {
  id: number;
  username: string;
  role: 'ADMIN' | 'PARENT' | 'CHILD';
  defaultMainAccountId?: number | null;
}

type TransferTargetsApiResponse = SelectableUserApiResponse[];

type AccountPayload = Pick<Account, 'name' | 'type'>;
type UpdateAccountPayload = Pick<Account, 'name'>;
interface AdjustBalancePayload {
  amount: number;
  comment: string;
}
interface AccountBalanceAdjustmentApiResponse {
  id: number;
  amount: number | string;
  comment: string;
  createdAt: string;
}
interface ShareAccountPayload {
  userId: number;
  role: 'EDITOR' | 'VIEWER';
}
interface CreateTransferPayload {
  amount: number;
  fromAccountId: number;
  toAccountId?: number | null;
  targetAccountId?: number | null;
  targetUserId?: number | null;
  transactionDate?: string | null;
  comment?: string;
  reminderId?: number | null;
}

export interface SelectableUser {
  id: number;
  username: string;
  role: 'ADMIN' | 'PARENT' | 'CHILD';
  defaultMainAccountId: number | null;
}

export interface TransferTargets {
  users: SelectableUser[];
}

export interface AccountBalanceAdjustment {
  id: number;
  amount: number;
  comment: string;
  createdAt: string;
}

interface SelectionApiResponse {
  data: number[];
}

@Injectable({
  providedIn: 'root'
})
export class AccountService {
  private readonly http = inject(HttpClient);

  getAccounts(): Observable<Account[]> {
    return this.http.get<ListResponse<AccountApiResponse[]>>(`${environment.apiUrl}/accounts`).pipe(
      map((response) => response.data.map((account) => this.mapAccount(account)))
    );
  }

  createAccount(account: AccountPayload): Observable<Account> {
    return this.http.post<ApiResponse<AccountApiResponse>>(`${environment.apiUrl}/accounts`, account).pipe(
      map((response) => this.mapAccount(response.data))
    );
  }

  updateAccount(id: number, account: UpdateAccountPayload): Observable<Account> {
    return this.http.put<ApiResponse<AccountApiResponse>>(`${environment.apiUrl}/accounts/${id}`, account).pipe(
      map((response) => this.mapAccount(response.data))
    );
  }

  adjustBalance(id: number, payload: AdjustBalancePayload): Observable<Account> {
    return this.http.patch<ApiResponse<AccountApiResponse>>(`${environment.apiUrl}/accounts/${id}/adjust-balance`, payload).pipe(
      map((response) => this.mapAccount(response.data))
    );
  }

  getRecentBalanceAdjustments(id: number): Observable<AccountBalanceAdjustment[]> {
    return this.http.get<ApiResponse<AccountBalanceAdjustmentApiResponse[]>>(`${environment.apiUrl}/accounts/${id}/adjust-balance-history`).pipe(
      map((response) => response.data.map((item) => ({
        id: item.id,
        amount: typeof item.amount === 'number' ? item.amount : Number(item.amount),
        comment: item.comment,
        createdAt: item.createdAt
      })))
    );
  }

  shareAccount(id: number, payload: ShareAccountPayload): Observable<Account> {
    return this.http.post<ApiResponse<AccountApiResponse>>(`${environment.apiUrl}/accounts/${id}/share`, payload).pipe(
      map((response) => this.mapAccount(response.data))
    );
  }

  revokeAccountShare(id: number, userId: number): Observable<Account> {
    return this.http.delete<ApiResponse<AccountApiResponse>>(`${environment.apiUrl}/accounts/${id}/share/${userId}`).pipe(
      map((response) => this.mapAccount(response.data))
    );
  }

  deleteAccount(id: number): Observable<void> {
    return this.http.delete<ApiResponse<string>>(`${environment.apiUrl}/accounts/${id}`).pipe(
      map(() => void 0)
    );
  }

  createTransfer(payload: CreateTransferPayload): Observable<void> {
    return this.http.post<ApiResponse<unknown>>(`${environment.apiUrl}/transactions`, {
      amount: payload.amount,
      type: 'TRANSFER',
      fromAccountId: payload.fromAccountId,
      targetUserId: payload.targetUserId ?? null,
      toAccountId: payload.targetAccountId ?? payload.toAccountId ?? null,
      categoryId: null,
      transactionDate: payload.transactionDate || null,
      comment: payload.comment || null,
      reminderId: payload.reminderId ?? null
    }).pipe(
      map(() => void 0)
    );
  }

  getSelectableUsers(): Observable<SelectableUser[]> {
    return this.http.get<ApiResponse<SelectableUserApiResponse[]>>(`${environment.apiUrl}/users?selectable=true`).pipe(
      map((response) => response.data.map((user) => ({
        id: user.id,
        username: user.username,
        role: user.role,
        defaultMainAccountId: typeof user.defaultMainAccountId === 'number'
          ? user.defaultMainAccountId
          : null
      })))
    );
  }

  getFilterUsers(): Observable<SelectableUser[]> {
    return this.http.get<ApiResponse<SelectableUserApiResponse[]>>(`${environment.apiUrl}/filters/users`).pipe(
      map((response) => response.data.map((user) => ({
        id: user.id,
        username: user.username,
        role: user.role,
        defaultMainAccountId: typeof user.defaultMainAccountId === 'number'
          ? user.defaultMainAccountId
          : null
      })))
    );
  }

  getFamilyDashboardSelection(): Observable<number[]> {
    return this.http.get<SelectionApiResponse>(`${environment.apiUrl}/users/me/family-dashboard-selection`).pipe(
      map((response) => Array.isArray(response.data) ? response.data : [])
    );
  }

  updateFamilyDashboardSelection(selectedUserIds: number[]): Observable<number[]> {
    return this.http.put<SelectionApiResponse>(`${environment.apiUrl}/users/me/family-dashboard-selection`, {
      selectedUserIds
    }).pipe(
      map((response) => Array.isArray(response.data) ? response.data : [])
    );
  }

  getTransferTargets(): Observable<TransferTargets> {
    return this.http.get<ApiResponse<TransferTargetsApiResponse>>(`${environment.apiUrl}/transfers/targets`).pipe(
      map((response) => ({
        users: response.data.map((user) => ({
          id: user.id,
          username: user.username,
          role: user.role,
          defaultMainAccountId: typeof user.defaultMainAccountId === 'number'
            ? user.defaultMainAccountId
            : null
        }))
      }))
    );
  }

  private mapAccount(account: AccountApiResponse): Account {
    const balance = typeof account.balance === 'number'
      ? account.balance
      : Number(account.balance ?? 0);

    return {
      id: account.id,
      name: account.name,
      balance: Number.isNaN(balance) ? 0 : balance,
      type: account.type,
      ownerId: account.ownerId,
      ownerUsername: account.ownerUsername,
      ownerRole: account.ownerRole,
      accessRole: account.accessRole ?? null,
      sharedUsers: account.sharedUsers?.map((sharedUser) => ({
        userId: sharedUser.userId,
        username: sharedUser.username,
        role: sharedUser.role
      })) ?? []
    };
  }
}
