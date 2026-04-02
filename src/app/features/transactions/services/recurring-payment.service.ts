import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface RecurringPaymentStatus {
  id: number;
  year: number;
  month: number;
  paid: boolean;
}

export interface RecurringPaymentItem {
  id: number;
  name: string;
  amount: number;
  dueDay: number;
  categoryId: number;
  categoryName: string;
  ownerId: number;
  ownerUsername: string;
  active: boolean;
  currentMonthStatus: RecurringPaymentStatus;
}

interface ApiResponse<T> {
  data: T;
}

interface ListResponse<T> {
  data: T;
  total: number;
}

interface RecurringPaymentApiResponse {
  id: number;
  name: string;
  amount: number | string;
  dueDay: number;
  categoryId: number;
  categoryName: string;
  ownerId: number;
  ownerUsername: string;
  active: boolean;
  currentMonthStatus: RecurringPaymentStatus | null;
}

export interface RecurringPaymentPayload {
  name: string;
  categoryId: number;
  amount: number;
  dueDay: number;
  active?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class RecurringPaymentService {
  private readonly http = inject(HttpClient);

  getRecurringPayments(size = 200): Observable<{ data: RecurringPaymentItem[]; total: number }> {
    const params = new HttpParams().set('size', size);

    return this.http.get<ListResponse<RecurringPaymentApiResponse[]>>(`${environment.apiUrl}/recurring`, { params }).pipe(
      map((response) => ({
        data: response.data.map((item) => this.mapItem(item)),
        total: response.total
      }))
    );
  }

  createRecurringPayment(payload: RecurringPaymentPayload): Observable<RecurringPaymentItem> {
    const body = {
      name: payload.name.trim(),
      categoryId: payload.categoryId,
      amount: payload.amount,
      dueDay: payload.dueDay,
      active: payload.active ?? true
    };

    return this.http.post<ApiResponse<RecurringPaymentApiResponse>>(`${environment.apiUrl}/recurring`, body).pipe(
      map((response) => this.mapItem(response.data))
    );
  }

  updateRecurringPayment(id: number, payload: Partial<RecurringPaymentPayload>): Observable<RecurringPaymentItem> {
    const body: Partial<RecurringPaymentPayload> = {
      ...payload,
      name: payload.name?.trim()
    };

    return this.http.put<ApiResponse<RecurringPaymentApiResponse>>(`${environment.apiUrl}/recurring/${id}`, body).pipe(
      map((response) => this.mapItem(response.data))
    );
  }

  deleteRecurringPayment(id: number): Observable<void> {
    return this.http.delete<ApiResponse<string>>(`${environment.apiUrl}/recurring/${id}`).pipe(
      map(() => void 0)
    );
  }

  private mapItem(item: RecurringPaymentApiResponse): RecurringPaymentItem {
    return {
      id: item.id,
      name: item.name,
      amount: typeof item.amount === 'number' ? item.amount : Number(item.amount),
      dueDay: item.dueDay,
      categoryId: item.categoryId,
      categoryName: item.categoryName,
      ownerId: item.ownerId,
      ownerUsername: item.ownerUsername,
      active: item.active,
      currentMonthStatus: item.currentMonthStatus ?? {
        id: 0,
        year: new Date().getFullYear(),
        month: new Date().getMonth() + 1,
        paid: false
      }
    };
  }
}
