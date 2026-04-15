import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  CreateTransactionCategoryPayload,
  CreateTransactionPayload,
  TransactionCategory,
  TransactionItem,
  TransactionListResult,
  TransactionQuery,
  TransactionUserOption,
  UpdateTransactionPayload
} from '../models/transaction.model';

interface ListResponse<T> {
  data: T;
  total: number;
}

interface ApiResponse<T> {
  data: T;
}

interface TransactionApiResponse {
  id: number;
  amount: number | string | null;
  transferId: string | null;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  fromAccountId: number | null;
  fromAccountName: string | null;
  toAccountId: number | null;
  toAccountName: string | null;
  categoryId: number | null;
  categoryName: string | null;
  createdById: number;
  createdByUsername: string;
  transactionDate: string;
  createdAt: string;
  comment: string | null;
}

interface CategoryApiResponse {
  id: number;
  userId: number;
  name: string;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  parentCategoryId: number | null;
  parentCategoryName: string | null;
  group: 'FAMILY' | 'CHILD';
}

interface UserApiResponse {
  id: number;
  username: string;
  role: 'ADMIN' | 'PARENT' | 'CHILD';
}

@Injectable({
  providedIn: 'root'
})
export class TransactionsService {
  private readonly http = inject(HttpClient);

  getTransactions(query: TransactionQuery): Observable<TransactionListResult> {
    let params = new HttpParams()
      .set('page', query.page)
      .set('size', query.size)
      .set('sort', query.sort);

    if (query.userId !== null) {
      params = params.set('userId', query.userId);
    }
    if (query.type !== null) {
      params = params.set('type', query.type);
    }
    if (query.mainCategoryId !== null) {
      params = params.set('mainCategoryId', query.mainCategoryId);
    }
    if (query.subCategoryId !== null) {
      params = params.set('subcategoryId', query.subCategoryId);
    }
    if (query.categoryId !== null && query.categoryId !== undefined) {
      params = params.set('categoryId', query.categoryId);
    }
    if (query.from) {
      params = params.set('from', query.from);
    }
    if (query.to) {
      params = params.set('to', query.to);
    }

    return this.http.get<ListResponse<TransactionApiResponse[]>>(`${environment.apiUrl}/transactions`, { params }).pipe(
      map((response) => ({
        data: response.data.map((item) => this.mapTransaction(item)),
        total: response.total
      }))
    );
  }

  getCategories(size = 500): Observable<TransactionCategory[]> {
    const params = new HttpParams().set('size', size);
    return this.http.get<ListResponse<CategoryApiResponse[]>>(`${environment.apiUrl}/categories`, { params }).pipe(
      map((response) => response.data.map((category) => this.mapCategory(category)))
    );
  }

  getUsers(): Observable<TransactionUserOption[]> {
    return this.http.get<ApiResponse<UserApiResponse[]>>(`${environment.apiUrl}/filters/users`).pipe(
      map((response) => response.data.map((user) => ({
        id: user.id,
        username: user.username,
        role: user.role
      })))
    );
  }

  createTransaction(payload: CreateTransactionPayload): Observable<TransactionItem> {
    const isTransfer = payload.type === 'TRANSFER';
    const body = {
      amount: payload.amount,
      type: payload.type,
      fromAccountId: isTransfer
        ? (payload.transferFromAccountId ?? payload.accountId)
        : (payload.type === 'EXPENSE' ? payload.accountId : null),
      toAccountId: isTransfer
        ? (payload.transferToAccountId ?? payload.toAccountId ?? null)
        : (payload.type === 'INCOME' ? payload.accountId : null),
      categoryId: payload.categoryId,
      transactionDate: payload.transactionDate,
      comment: payload.comment || null,
      reminderId: payload.reminderId ?? null
    };

    return this.http.post<ApiResponse<TransactionApiResponse>>(`${environment.apiUrl}/transactions`, body).pipe(
      map((response) => this.mapTransaction(response.data))
    );
  }

  updateTransaction(id: number, payload: UpdateTransactionPayload): Observable<TransactionItem> {
    const body = {
      amount: payload.amount,
      fromAccountId: payload.fromAccountId ?? null,
      toAccountId: payload.toAccountId ?? null,
      targetUserId: payload.targetUserId ?? null,
      transactionDate: payload.transactionDate,
      comment: payload.comment || null
    };

    return this.http.put<ApiResponse<TransactionApiResponse>>(`${environment.apiUrl}/transactions/${id}`, body).pipe(
      map((response) => this.mapTransaction(response.data))
    );
  }

  deleteTransaction(id: number): Observable<void> {
    return this.http.delete<ApiResponse<string>>(`${environment.apiUrl}/transactions/${id}`).pipe(
      map(() => void 0)
    );
  }

  createCategory(payload: CreateTransactionCategoryPayload): Observable<TransactionCategory> {
    const body = {
      ...payload,
      name: payload.name.trim()
    };

    return this.http.post<ApiResponse<CategoryApiResponse>>(`${environment.apiUrl}/categories`, body).pipe(
      map((response) => this.mapCategory(response.data))
    );
  }

  updateCategory(id: number, payload: Partial<CreateTransactionCategoryPayload>): Observable<TransactionCategory> {
    const body = {
      ...payload,
      name: payload.name?.trim()
    };

    return this.http.put<ApiResponse<CategoryApiResponse>>(`${environment.apiUrl}/categories/${id}`, body).pipe(
      map((response) => this.mapCategory(response.data))
    );
  }

  deleteCategory(id: number): Observable<void> {
    return this.http.delete<ApiResponse<string>>(`${environment.apiUrl}/categories/${id}`).pipe(
      map(() => void 0)
    );
  }

  private mapCategory(category: CategoryApiResponse): TransactionCategory {
    return {
      id: category.id,
      userId: category.userId,
      name: category.name,
      type: category.type,
      parentCategoryId: category.parentCategoryId,
      parentCategoryName: category.parentCategoryName,
      group: category.group,
      isRecurring: false,
      dueDayOfMonth: null,
      recurringAmount: null
    };
  }

  private mapTransaction(item: TransactionApiResponse): TransactionItem {
    const amount = typeof item.amount === 'number' ? item.amount : Number(item.amount ?? 0);

    return {
      id: item.id,
      amount: Number.isNaN(amount) ? 0 : amount,
      transferId: item.transferId,
      type: item.type,
      fromAccountId: item.fromAccountId,
      fromAccountName: item.fromAccountName,
      toAccountId: item.toAccountId,
      toAccountName: item.toAccountName,
      categoryId: item.categoryId,
      categoryName: item.categoryName,
      createdById: item.createdById,
      createdByUsername: item.createdByUsername,
      transactionDate: item.transactionDate,
      createdAt: item.createdAt,
      comment: item.comment
    };
  }
}
