import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, Observable } from 'rxjs';
import { Account } from '../models/account.model';

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
  type: 'MAIN' | 'SAVINGS';
}

type AccountPayload = Pick<Account, 'name' | 'type'>;
type UpdateAccountPayload = Pick<Account, 'name'>;

@Injectable({
  providedIn: 'root'
})
export class AccountService {
  private readonly http = inject(HttpClient);

  getAccounts(): Observable<Account[]> {
    return this.http.get<ListResponse<AccountApiResponse[]>>('/api/accounts').pipe(
      map((response) => response.data.map((account) => this.mapAccount(account)))
    );
  }

  createAccount(account: AccountPayload): Observable<Account> {
    return this.http.post<ApiResponse<AccountApiResponse>>('/api/accounts', account).pipe(
      map((response) => this.mapAccount(response.data))
    );
  }

  updateAccount(id: number, account: UpdateAccountPayload): Observable<Account> {
    return this.http.put<ApiResponse<AccountApiResponse>>(`/api/accounts/${id}`, account).pipe(
      map((response) => this.mapAccount(response.data))
    );
  }

  deleteAccount(id: number): Observable<void> {
    return this.http.delete<ApiResponse<string>>(`/api/accounts/${id}`).pipe(
      map(() => void 0)
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
      ownerRole: account.ownerRole
    };
  }
}
