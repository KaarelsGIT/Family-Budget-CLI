import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface RecurringReminderItem {
  id: number;
  recurringTransactionId: number;
  transactionId: number | null;
  userId: number;
  username: string;
  categoryId: number;
  categoryName: string;
  accountId: number | null;
  accountName: string | null;
  amount: number | null;
  comment: string | null;
  dueDate: string;
  status: 'PENDING' | 'COMPLETED' | 'SKIPPED';
  transactionType: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  urgent: boolean;
}

export interface ReminderPayData {
  reminderId: number;
  recurringTransactionId: number;
  transactionType: 'INCOME' | 'EXPENSE';
  amount: number;
  categoryId: number;
  categoryName: string;
  accountId: number | null;
  accountName: string | null;
  description: string;
  transactionDate: string;
}

interface ApiResponse<T> {
  data: T;
}

interface ListResponse<T> {
  data: T;
  total: number;
}

@Injectable({
  providedIn: 'root'
})
export class RecurringReminderService {
  private readonly http = inject(HttpClient);

  getReminders(): Observable<RecurringReminderItem[]> {
    return this.http.get<ListResponse<RecurringReminderItem[]>>(`${environment.apiUrl}/recurring-reminders`).pipe(
      map((response) => response.data)
    );
  }

  getReminder(id: number): Observable<RecurringReminderItem> {
    return this.http.get<ApiResponse<RecurringReminderItem>>(`${environment.apiUrl}/recurring-reminders/${id}`).pipe(
      map((response) => response.data)
    );
  }

  getPayData(id: number): Observable<ReminderPayData> {
    return this.http.get<ApiResponse<ReminderPayData>>(`${environment.apiUrl}/reminders/${id}/pay-data`).pipe(
      map((response) => response.data)
    );
  }

  skipReminder(id: number): Observable<RecurringReminderItem> {
    return this.http.post<ApiResponse<RecurringReminderItem>>(`${environment.apiUrl}/recurring-reminders/${id}/skip`, {}).pipe(
      map((response) => response.data)
    );
  }

  completeReminder(id: number): Observable<void> {
    return this.http.post<ApiResponse<unknown>>(`${environment.apiUrl}/recurring-reminders/${id}/complete`, {}).pipe(
      map(() => void 0)
    );
  }

  findMatchingReminder(categoryId: number, transactionDate: string): Observable<RecurringReminderItem | null> {
    const params = new URLSearchParams({
      categoryId: String(categoryId),
      transactionDate
    });

    return this.http.get<ApiResponse<RecurringReminderItem | null>>(`${environment.apiUrl}/recurring-reminders/match?${params.toString()}`).pipe(
      map((response) => response.data)
    );
  }

  linkReminderToTransaction(reminderId: number, transactionId: number): Observable<RecurringReminderItem> {
    return this.http.post<ApiResponse<RecurringReminderItem>>(`${environment.apiUrl}/recurring-reminders/${reminderId}/link/${transactionId}`, {}).pipe(
      map((response) => response.data)
    );
  }
}
